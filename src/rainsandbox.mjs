// src/rainsandbox.mjs — Rain card-issuing SANDBOX adapter (the Rain-track "agents move money" path).
// docs: rain-sandbox-trial.mintlify.site · api-dev.raincards.xyz/v1 · SANDBOX ONLY, no real money.
//
// Maps our thesis onto Rain's REAL API: a SCOPED CARD is the Gate — the Agent Control Layer
// scopes it to "merchant, amount and task." An agent AUTHORIZES transactions. The in-policy flip
// is an authorize that stays UNDER the card's amount cap but goes to the WRONG merchant/MCC.
// "Agents move money" = authorize -> settle actually moves sandbox rusd.
//
// Zero-dep (native fetch). NEVER logs the Api-Key. Refuses any non-sandbox host.
// Paths + fields CONFIRMED against the sandbox openapi.json (rain-sandbox-trial.mintlify.site),
// Aug 2026: authorize currency enum is "USD" (rusd is collateral-only); approved status value is
// "authorized"; ids come back as transactionId / id; decline field is "declinedReason". Rain
// AUTO-ENFORCES a card's non-empty allowedMccs (declines off-allowlist merchants) — so the
// negative control below genuinely tests scope; the same-MCC/wrong-merchant flip genuinely passes.

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

  // 2) issue a scoped card — the Gate. amountInUSDCents is the cap; allowedMccs binds the
  // merchant CATEGORY (Rain's API has NO exact-merchant field — category is the tightest bind);
  // expiresAt is optional. A non-empty allowedMccs makes Rain auto-decline off-category merchants.
  const issueScopedCard = async (amountInUSDCents, allowedMccs) => {
    const body = { amountInUSDCents };
    if (allowedMccs && allowedMccs.length) body.allowedMccs = allowedMccs;
    const r = await call("POST", `/issuing/users/${userId}/cards/scoped`, body, { sessionid: sessionId });
    return r.id || r.cardId || r.card?.id || r.data?.id;
  };

  // 3) authorize -> settle. purchase p = { amount(cents), merchantName, merchantCategoryCode, currency?, declineReason? }
  // currency enum is "USD" (the card settles in USD; rusd is the collateral currency). declineReason
  // is an optional passthrough to FORCE a decline in the sim — omit it and Rain enforces allowedMccs itself.
  const authorize = (cardId, p) => call("POST", "/simulate/transactions/authorize", {
    cardId, amount: p.amount, currency: p.currency || "USD", merchantName: p.merchantName, merchantCategoryCode: p.merchantCategoryCode,
    ...(p.declineReason ? { declineReason: p.declineReason } : {}),
  });
  // settle body carries the merchant-capture amount (optional; defaults to the full authorized amount).
  const settleTx = (txId, amountCents) => call("POST", `/simulate/transactions/${txId}/settle`, amountCents ? { amount: amountCents } : {});

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
      const txId = auth.transactionId || auth.id || auth.transaction?.id || auth.data?.id;
      const status = auth.status || "";
      // Rain's approved status is "authorized" (also accept "approved"/"settled"); "declined" is the miss.
      const approved = auth.approved ?? (status ? ["authorized", "approved", "settled"].includes(status) : !!txId);
      if (!approved || !txId)
        return { settled: false, approved: false, moved: 0, txId: null, reason: auth.declinedReason || auth.declineReason || status || "declined" };
      await settleTx(txId, p.amount);
      return { settled: true, approved: true, moved: p.amount, txId };
    },
  });

  return { kind: "rain-sandbox", fundCollateral, issueScopedCard, authorize, settleTx, transactions, createPaymentRoute, runPaymentRoute, facilitatorFor };
}
