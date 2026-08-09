// src/rain.mjs — Rain card-issuing sandbox client.
//
// EVERY fact encoded here was verified live against api-dev.raincards.xyz/v1 on 2026-08-08
// with the Team 31 credentials. Field names are NOT guessed. Where behaviour surprised us it
// is written down in the comment above the call, because the surprises are load-bearing for
// the demo narration.
//
// The two facts that decide what you may claim on stage:
//   1. A SCOPED card enforces its MCC allowlist. Rain declines an off-allowlist merchant with
//      declinedReason "scoped_card_mcc_not_allowed" and we pass no declineReason to get it.
//   2. A SCOPED card does NOT enforce its amount at authorization. A card requested at 7340
//      reads back limit {amount: 8808 (=1.2x), frequency: "allTime"} and still authorizes 8809.
//      So never narrate the dollar figure as "Rain is enforcing this". The MCC is the rule.
//
// If you need an amount that Rain actually enforces, use issuePlainCard(cents,
// "perAuthorization"): that declines cents+1 with "card_spending_limit_exceeded". It has no
// MCC binding. No single card gives you both.
//
// Zero dependencies (native fetch + node:crypto). Never logs the Api-Key. Sandbox hosts only.

import { generateSessionId } from "./rainsession.mjs";

const SANDBOX_HOSTS = ["api-dev.raincards.xyz", "rain-sandbox", "sandbox"];

export function makeRain(cfg = {}) {
  const {
    apiBase = process.env.RAIN_API_BASE,
    apiKey = process.env.RAIN_API_KEY,
    userId = process.env.RAIN_USER_ID,
    contractId = process.env.RAIN_CONTRACT_ID,
  } = cfg;

  if (!apiBase) throw new Error("RAIN_API_BASE unset");
  if (!apiKey) throw new Error("RAIN_API_KEY unset");
  const host = new URL(apiBase).host;
  if (!SANDBOX_HOSTS.some((h) => host.includes(h)))
    throw new Error(`refusing ${host}: sandbox only, never a production key in an agent`);

  const root = apiBase.replace(/\/$/, "");

  async function call(method, path, body, extraHeaders = {}) {
    const res = await fetch(root + path, {
      method,
      headers: { "content-type": "application/json", "Api-Key": apiKey, ...extraHeaders },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json;
    try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
    if (!res.ok) {
      const err = new Error(`Rain ${method} ${path} -> ${res.status} ${JSON.stringify(json).slice(0, 240)}`);
      err.status = res.status; err.body = json;
      throw err;
    }
    return json;
  }

  // ---- collateral -----------------------------------------------------------------------
  // POST /simulate/collateral/fund -> 202 {"success": true}. Note 202, not 200, and the body
  // carries no id, so there is nothing to read back. GET /issuing/contracts is 403 on this
  // tenant, so do NOT build a "read the contract balance" step. Use balances() instead.
  const fundCollateral = (amountCents) =>
    call("POST", "/simulate/collateral/fund", { contractId, currency: "rusd", amount: amountCents });

  // ---- the scoped card: the keynote primitive -------------------------------------------
  // POST /issuing/users/{userId}/cards/scoped
  // REQUIRES a `sessionid` header. It is NOT issued at the workshop desk — it is generated
  // client-side (see rainsession.mjs) and a fresh one per call is fine.
  //
  // Response: { id, encryptedPan:{iv,data}, encryptedCvc:{iv,data}, last4,
  //             expirationMonth, expirationYear, status:"active" }
  //
  // LIFECYCLE, verified: the card flips to status "canceled" after ONE SUCCESSFUL
  // authorization. A DECLINED authorization leaves it "active", so you can show a decline
  // beat and still make the real purchase on the same card afterwards. Order your demo
  // beats accordingly: declines first, the real charge last.
  const issueScopedCard = async (amountInUSDCents, allowedMccs = []) => {
    const { sessionId, secretKey } = generateSessionId();
    const body = { amountInUSDCents };
    if (allowedMccs.length) body.allowedMccs = allowedMccs;
    const card = await call("POST", `/issuing/users/${userId}/cards/scoped`, body, { sessionid: sessionId });
    // secretKey is what decrypts encryptedPan/encryptedCvc — keep it with the card or the
    // PAN is unrecoverable. Never log it.
    return { ...card, secretKey };
  };

  // ---- the plain card: use when you need an ENFORCED amount ------------------------------
  // POST /issuing/users/{userId}/cards — no sessionid required.
  // frequency is an enum; the ONLY accepted values are these three (everything else 400s
  // with "body/limit/frequency must be equal to one of the allowed values"):
  //   perAuthorization  -> enforced exactly. cents approves, cents+1 declines.
  //   per24HourPeriod   -> accepted (velocity control exists, contrary to earlier notes)
  //   allTime           -> accepted but NOT enforced at authorization
  // allowedMccs / expiresAt are silently DROPPED here: accepted with 200, absent from the
  // read-back, and not enforced. MCC binding exists only on scoped cards.
  const issuePlainCard = (amountCents, frequency = "perAuthorization") =>
    call("POST", `/issuing/users/${userId}/cards`, {
      limit: { amount: amountCents, frequency }, status: "active", type: "virtual",
    });

  // ---- authorize / settle / reverse / refund --------------------------------------------
  // currency is "USD" (rusd is the collateral currency, not the transaction currency).
  // Returns { transactionId, status: "authorized" | "declined", declinedReason? }.
  // Do NOT pass declineReason unless you are deliberately forcing a decline — a forced
  // decline is indistinguishable from a real one in the response and is not honest evidence.
  const authorize = (cardId, { amount, merchantName, merchantCategoryCode, currency = "USD" }) =>
    call("POST", "/simulate/transactions/authorize", {
      cardId, amount, currency, merchantName, merchantCategoryCode,
    });

  // settle REQUIRES an amount in the body — an empty body 400s with
  // "body must have required property 'amount'". The settle amount overrides the authorized
  // amount on the posted transaction (authorizedAmount is rewritten), so a capture larger
  // than the authorization posts without complaint on the simulator. That is a property of
  // /simulate, not evidence about Rain's production clearing path. Do not claim otherwise.
  const settle = (transactionId, amountCents) =>
    call("POST", `/simulate/transactions/${transactionId}/settle`, { amount: amountCents });

  // -> { status: "settled", completionReason: "authorization_reversal" }; releases the hold,
  // to the cent, visible as pendingCharges falling and spendingPower rising in balances().
  const reverse = (transactionId, amountCents) =>
    call("POST", `/simulate/transactions/${transactionId}/reverse`, { amount: amountCents });

  // -> { status: "settled", completionReason: "refund" }
  const refund = (transactionId, amountCents) =>
    call("POST", `/simulate/transactions/${transactionId}/refund`, { amount: amountCents });

  // ---- read side -------------------------------------------------------------------------
  // Rain-authoritative money truth. { creditLimit, pendingCharges, postedCharges, balanceDue,
  // spendingPower, currency }. This is the number to put on screen when you claim money moved,
  // because it is Rain's arithmetic and not ours.
  const balances = () => call("GET", "/issuing/balances");

  // Transactions come back nested: { id, type:"spend", spend:{ amount, merchantName (space
  // padded!), merchantCategoryCode, cardId, status, authorizedAt, postedAt, authorizedAmount } }
  // NOTE: this is a SHARED team account. Other people's probe rows are in here. Always filter
  // by your own cardIds before showing it, or you will put a stranger's "Shady Casino" row on
  // the projector.
  const transactions = async (limit = 25) => {
    const rows = await call("GET", `/issuing/transactions?limit=${limit}`);
    return (Array.isArray(rows) ? rows : []).map((r) => ({
      id: r.id,
      amount: r.spend?.amount ?? 0,
      merchantName: (r.spend?.merchantName ?? "").trim(),
      mcc: r.spend?.merchantCategoryCode ?? "",
      cardId: r.spend?.cardId ?? "",
      status: r.spend?.status ?? "",
      authorizedAt: r.spend?.authorizedAt ?? null,
      postedAt: r.spend?.postedAt ?? null,
      raw: r,
    }));
  };

  const getCard = (cardId) => call("GET", `/issuing/cards/${cardId}`);
  const listCards = () => call("GET", "/issuing/cards");

  return {
    fundCollateral, issueScopedCard, issuePlainCard,
    authorize, settle, reverse, refund,
    balances, transactions, getCard, listCards,
    _call: call,
  };
}

// Documented account ceilings (from the openapi description of createIssuingScopedCard).
// These are per USER per rolling 24h. Budget your demo runs against them — do exploratory
// work on plain cards and save scoped issuance for real runs.
export const RAIN_LIMITS = {
  maxActiveScopedCardsPerUser: 10,
  maxScopedCardsCreatedPer24h: 10,
  maxApprovedSpendPer24hCents: 500000,
  scopedLifetimeCeilingMultiplier: 1.2,
};
