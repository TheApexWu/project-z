// Asha — the reference gate. A commodity static policy (Rain-ACL style).
// Purely quantitative: it sees amounts, recipients, and rates, never intent.
// This is the BASELINE we measure against, not the contribution.
export function makeAsha(policy) {
  const history = [];
  const deny = (reason) => ({ allow: false, reason });

  const check = (p, now) => {
    if (p.amount > policy.cap) return deny("cap");
    if (!policy.allowlist.includes(p.payTo)) return deny("allowlist");
    if (policy.priceRef && p.amount > policy.priceRef * policy.priceBand)
      return deny("price-band");
    const recent = history.filter((h) => now - h.now < policy.windowMs);
    if (recent.length >= policy.velocity) return deny("velocity");
    return { allow: true, reason: "in-policy" };
  };

  return { check, record: (p, now) => history.push({ ...p, now }) };
}
