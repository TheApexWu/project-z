// src/rainsandbox.mjs — Rain card-issuing SANDBOX adapter (the Rain-track "agents move money" path).
// docs: rain-sandbox-trial.mintlify.site · api-dev.raincards.xyz/v1 · SANDBOX ONLY, no real money.
//
// Maps our thesis onto Rain's REAL API: a SCOPED CARD is the Gate — the Agent Control Layer
// scopes it to "merchant, amount and task." An agent AUTHORIZES transactions. The in-policy flip
// is an authorize that stays UNDER the card's amount cap but goes to the WRONG merchant/MCC.
// "Agents move money" = authorize -> settle actually moves sandbox rusd.
//
// Zero-dep (native fetch). NEVER logs the Api-Key. Refuses any non-sandbox host. Response field
// names are inferred from the starter kit — confirm against the docs/playground and adjust.

const SANDBOX_HOSTS = ["api-dev.raincards.xyz", "rain-sandbox", "sandbox"];

export function makeRainSandbox(cfg = {}) {
  const { apiBase, apiKey, userId, teamId, contractId, sessionId } = cfg;

  function assertSandbox() {
    if (!apiBase) throw new Error("RAIN_API_BASE unset");
    const host = new URL(apiBase).host;
    if (!SANDBOX_HOSTS.some((h) => host.includes(h)))
      throw new Error(`refusing: ${host} is not a Rain sandbox host — sandbox only, never a prod key in an agent`);
  }

  async function call(method, path, body, extraHeaders = {}) {
    assertSandbox();
    if (!apiKey) throw new Error("RAIN_API_KEY unset");
    const res = await fetch(apiBase.replace(/\/$/, "") + path, {
      method,
      headers: { "content-type": "application/json", "Api-Key": apiKey, ...extraHeaders },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json;
    try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
    if (!res.ok) throw new Error(`Rain ${method} ${path} -> ${res.status} ${JSON.stringify(json).slice(0, 200)}`);
    return json;
  }

  // 1) fund collateral (rusd, cents)
  const fundCollateral = (amountCents) => call("POST", "/simulate/collateral/fund", { contractId, currency: "rusd", amount: amountCents });

  // 2) issue a scoped card — the Gate. amountInUSDCents is the card's spend cap.
  const issueScopedCard = async (amountInUSDCents) => {
    const r = await call("POST", `/issuing/users/${userId}/cards/scoped`, { amountInUSDCents }, { sessionid: sessionId });
    return r.id || r.cardId || r.card?.id || r.data?.id;
  };

  // 3) authorize -> settle. purchase p = { amount(cents), merchantName, merchantCategoryCode, currency? }
  const authorize = (cardId, p) => call("POST", "/simulate/transactions/authorize", {
    cardId, amount: p.amount, currency: p.currency || "rusd", merchantName: p.merchantName, merchantCategoryCode: p.merchantCategoryCode,
  });
  const settleTx = (txId) => call("POST", `/simulate/transactions/${txId}/settle`, {});

  // 4) read back
  const transactions = (limit = 20) => call("GET", `/issuing/transactions?limit=${limit}`);

  // 5) move money across rails
  const createPaymentRoute = (source, destination) => call("POST", "/payment-routes", { userId, source, destination });
  const runPaymentRoute = (paymentRouteId, amount) => call("POST", "/simulate/payment-routes", { paymentRouteId, amount });

  // seam-shaped facilitator for a given scoped card: settle(p) = authorize + settle.
  // Returns { settled, approved, moved, txId } so the fuzzer/gauge can drive real Rain transactions.
  const facilitatorFor = (cardId) => ({
    kind: "rain-sandbox",
    verify: async (p) => p.amount > 0 && !!p.merchantName,
    settle: async (p) => {
      const auth = await authorize(cardId, p);
      const txId = auth.id || auth.transactionId || auth.transaction?.id || auth.data?.id;
      const approved = auth.approved ?? (auth.status ? auth.status === "approved" : !!txId);
      if (!approved || !txId) return { settled: false, approved: false, moved: 0, txId: null, reason: auth.declineReason || auth.status || "declined" };
      await settleTx(txId);
      return { settled: true, approved: true, moved: p.amount, txId };
    },
  });

  return { kind: "rain-sandbox", fundCollateral, issueScopedCard, authorize, settleTx, transactions, createPaymentRoute, runPaymentRoute, facilitatorFor };
}
