import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

// Pure HTML report generator. Consumes the single runData object assembled in
// run.mjs from real run values (never literals). Self-contained: inline CSS/SVG,
// NO external URLs. Every agent-derived string is escaped.
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const money = (n) => "$" + Number(n).toFixed(2);

function sparkline(trace) {
  const vals = trace.map((t) => t.bestFitness);
  const max = Math.max(1, ...vals);
  const w = 320;
  const h = 46;
  const pts = vals
    .map((v, i) => `${((i / (vals.length - 1 || 1)) * w).toFixed(1)},${(h - (v / max) * h).toFixed(1)}`)
    .join(" ");
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><polyline fill="none" stroke="#F0197A" stroke-width="2" points="${pts}"/></svg>`;
}

function rankTable(rows, hotName) {
  const body = rows
    .map(
      (r, i) =>
        `<tr${r.name === hotName ? ' class="hot"' : ""}><td>${i + 1}</td><td>${esc(r.name)}</td><td>${r.asr.toFixed(2)}</td><td>${money(r.dollars)}</td><td>${r.risk.toFixed(2)}</td></tr>`
    )
    .join("");
  return `<table><thead><tr><th>#</th><th>attack</th><th>success</th><th>$</th><th>risk</th></tr></thead><tbody>${body}</tbody></table>`;
}

function profileBars(perProfile) {
  const max = Math.max(0.01, ...perProfile.map((p) => p.dollarsSlipped));
  return perProfile
    .map(
      (p) =>
        `<div class="bar"><span class="lab">${esc(p.profile)}</span><span class="track"><span class="fill" style="width:${((p.dollarsSlipped / max) * 100).toFixed(1)}%"></span></span><span class="val">${money(p.dollarsSlipped)}/trial</span></div>`
    )
    .join("");
}

export function renderReport(d) {
  const badge = d.ledger.verified
    ? `<span class="badge ok">AVESTA chain VERIFIED · ${d.ledger.count} entries · head ${esc(d.ledger.head.slice(0, 12))}…</span>`
    : `<span class="badge bad">AVESTA chain BROKEN</span>`;
  const baseline = d.baseline
    .map((b) => `<tr><td>${esc(b.name)}</td><td>${esc(b.detail)}</td><td class="${b.pass ? "g" : "r"}">${esc(b.verdict)}</td></tr>`)
    .join("");
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(d.meta.title)}</title><style>
  body{font-family:-apple-system,Segoe UI,sans-serif;background:#0e0b1a;color:#e9e3ff;margin:0;padding:32px}
  .wrap{max-width:900px;margin:0 auto}h1{font-size:26px;margin:0 0 2px;background:linear-gradient(90deg,#c9bcff,#ff86c2);-webkit-background-clip:text;background-clip:text;color:transparent}
  .sub{color:#9f95c4;font-style:italic;margin:0 0 6px}.banner{color:#c79a12;font-size:12px;margin:0 0 20px}
  .headline{font-size:22px;font-weight:700;background:#160f2b;border:1px solid #3a2f66;border-radius:12px;padding:16px 20px;margin:14px 0}
  .headline .big{color:#ff86c2}.badge{display:inline-block;font-size:11px;padding:4px 10px;border-radius:20px;margin-left:8px;vertical-align:middle}
  .badge.ok{background:#123a24;color:#7cf2b0;border:1px solid #1f6b47}.badge.bad{background:#3a1220;color:#ff8ba0}
  h2{font-size:13px;text-transform:uppercase;letter-spacing:1px;color:#b6a7ff;margin:26px 0 8px}
  table{border-collapse:collapse;width:100%;font-size:13px}th,td{border-bottom:1px solid #2a2148;padding:6px 8px;text-align:left}
  th{color:#9f95c4;font-size:11px;text-transform:uppercase}.g{color:#7cf2b0}.r{color:#ff8ba0}
  .cols{display:flex;gap:20px}.cols>div{flex:1}tr.hot td{background:#2a1030;color:#ff9dcb;font-weight:600}
  .bar{display:flex;align-items:center;gap:10px;margin:5px 0;font-size:12px}.bar .lab{width:70px;color:#c9bcff}
  .bar .track{flex:1;height:12px;background:#221a3d;border-radius:6px;overflow:hidden}.bar .fill{display:block;height:100%;background:linear-gradient(90deg,#836EF9,#F0197A)}
  .bar .val{width:110px;text-align:right;color:#9f95c4}.foot{color:#6b6483;font-size:11px;margin-top:28px}
  .druj{background:#160f2b;border:1px solid #3a2f66;border-radius:10px;padding:12px 16px}</style></head><body><div class="wrap">
  <h1>${esc(d.meta.title)}</h1><p class="sub">${esc(d.meta.subtitle)}</p>
  <p class="banner">${esc(d.meta.banner)}</p>
  <div class="headline"><span class="big">${money(d.headlineMoved)}</span> moved past a ${money(d.cap)} static cap in one in-policy bypass. ${badge}</div>
  <h2>Baseline — the gap is structural</h2><table><thead><tr><th>attempt</th><th>detail</th><th>gate</th></tr></thead><tbody>${baseline}</tbody></table>
  <h2>Druj — evolving the in-policy bypass</h2><div class="druj">${sparkline(d.drujTrace)}<div>discovered <b>${money(d.drujBest.moved)}</b> to ${esc(d.drujBest.payTo)} · passed the gate · <b>L${d.drujBest.level}</b> ${esc(d.drujBest.label)}</div></div>
  <h2>Rashnu — the re-rank is the product</h2><div class="cols">
    <div><div class="sub">by binary success-rate (today)</div>${rankTable(d.ranking.byASR, d.rankingHotName)}</div>
    <div><div class="sub">by $-at-risk (Rashnu)</div>${rankTable(d.ranking.byRisk, d.rankingHotName)}</div></div>
  <p class="sub">${d.rerankMoved ? "Ranked by success-rate the rare-but-costly attacks sink; ranked by $-at-risk they rise (the highlighted row is the biggest climb)." : "No re-rank this run."} reversibility weights are <b>assumed</b>, not measured.</p>
  <h2>$ slipped per profile (the caps are the knob)</h2>${profileBars(d.perProfile)}
  <p class="foot">seed ${esc(d.meta.seed)} · ${esc(d.meta.generatedAt)} · zero-dep · reproducible · mock x402/Monad rails — draft. Not on-chain; not a Monad measurement.</p>
  </div></body></html>`;
}

export function writeReport(d, { path }) {
  mkdirSync(dirname(path), { recursive: true });
  const html = renderReport(d);
  writeFileSync(path, html);
  return path;
}
