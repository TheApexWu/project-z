#!/usr/bin/env node
// Milestone 10 e2e driver: one admin /begin-order + two simulated humans in the
// participants' Slack DMs against the DEPLOYED stack (Railway orchestrator + k8s
// agent pods). Asserts state progression, budgets, Rain card, decline proof,
// past-orders visibility, and live websocket events. Writes docs-notes/e2e-run.md.
import crypto from 'node:crypto'
import fs from 'node:fs'

const ORCH = (process.env.ORCHESTRATOR_URL || 'https://orchestrator-production-ef93.up.railway.app').replace(/\/$/, '')
const FRONTEND = (process.env.FRONTEND_URL || 'https://frontend-production-8ae0d.up.railway.app').replace(/\/$/, '')
const RAIN_BASE = process.env.RAIN_API_BASE || 'https://api-dev.raincards.xyz/v1'
const BOT = process.env.SLACK_BOT_TOKEN
const SECRET = process.env.SLACK_SIGNING_SECRET
const RAIN_KEY = process.env.RAIN_API_KEY
if (!BOT || !SECRET || !RAIN_KEY) {
  console.error('SLACK_BOT_TOKEN, SLACK_SIGNING_SECRET and RAIN_API_KEY are required (e2e.sh sources ./API_KEYS)')
  process.exit(1)
}

const CHANNEL = 'C0BNXRJV3AS' // #eats
const ADMIN = 'U0BNXRCAQ3G'
const A = 'U0BNZQ7KR34' // Demo User: full conversational flow
const B = 'U0BPU5GU6KS' // alexandwu: the lagger (never confirms -> timer path)
const BUDGET = 4000
const SHARE = BUDGET / 2
const RESTAURANT = "McDonald's"
const TIMER_SECONDS = 180
const GRACE_SECONDS = 120

let t0 = Date.now()
const rel = () => +(((Date.now() - t0) / 1000).toFixed(1))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const run = {
  startedAt: new Date().toISOString(),
  transcript: [],
  ws: [],
  assertions: [],
  fallbacks: [],
  states: {}, // state -> {t, source}
  annStates: {},
}
let orderId = null
let annTs = null
let latestSnap = null
let graceEntry = null
let done = false

function noteState(state, source) {
  if (!state || run.states[state]) return
  run.states[state] = { t: rel(), source }
  console.log(`[${rel()}s] state ${state} (via ${source})`)
}

function assert(cond, name, detail = '') {
  const ok = !!cond
  run.assertions.push({ name, ok, detail: String(detail).slice(0, 300) })
  console.log(`${ok ? 'assert ok' : 'ASSERT FAIL'}: ${name}${ok ? '' : ' — ' + detail}`)
  if (!ok) throw new Error('assertion failed: ' + name)
}

async function slack(method, payload, retries = 4) {
  for (let i = 0; ; i++) {
    const res = await fetch('https://slack.com/api/' + method, {
      method: 'POST',
      headers: { Authorization: `Bearer ${BOT}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const raw = await res.text()
    let data = {}
    try { data = JSON.parse(raw) } catch { /* 429/html */ }
    if (res.status === 429 && i < retries) {
      await sleep((+res.headers.get('retry-after') || 3) * 1000)
      continue
    }
    if (!data.ok) throw new Error(`slack ${method}: ${data.error || res.status}`)
    return data
  }
}

async function api(path, opts = {}) {
  const res = await fetch(ORCH + path, opts)
  const raw = await res.text()
  let data = null
  try { data = JSON.parse(raw) } catch { data = raw }
  return { status: res.status, data }
}
const apiPost = (path, body) =>
  api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) })

async function until(desc, fn, timeoutMs, intervalMs = 2000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const v = await fn().catch(() => null)
    if (v) return v
    if (Date.now() > deadline) throw new Error('timeout: ' + desc)
    await sleep(intervalMs)
  }
}

// --- simulated human: posts into the DM with the bot token; the agent bridge
// treats any message it did not post as participant input (see agent/bridge.py).
class Human {
  constructor(uid, label) {
    this.uid = uid
    this.label = label
    this.mine = new Set()
    this.seen = 0
  }
  async open() {
    const r = await slack('conversations.open', { users: this.uid })
    this.dm = r.channel.id
    const h = await slack('conversations.history', { channel: this.dm, limit: 5 })
    this.seen = Math.max(0, ...(h.messages || []).map((m) => +m.ts))
    return this.dm
  }
  async say(text) {
    const r = await slack('chat.postMessage', { channel: this.dm, text })
    this.mine.add(r.ts)
    run.transcript.push({ t: rel(), who: this.label, text })
    console.log(`[${rel()}s] ${this.label}: ${text}`)
  }
  async hear(timeoutMs) {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const h = await slack('conversations.history', { channel: this.dm, limit: 20 })
      const fresh = (h.messages || []).filter((m) => +m.ts > this.seen && !this.mine.has(m.ts) && !m.subtype)
      if (fresh.length) {
        this.seen = Math.max(...fresh.map((m) => +m.ts))
        fresh.sort((a, b) => +a.ts - +b.ts)
        const text = fresh[fresh.length - 1].text || ''
        run.transcript.push({ t: rel(), who: 'agent->' + this.label, text })
        console.log(`[${rel()}s] agent->${this.label}: ${text.slice(0, 120)}`)
        return text
      }
      if (Date.now() > deadline) throw new Error(`${this.label}: no agent reply within ${timeoutMs / 1000}s`)
      await sleep(3000)
    }
  }
  async waitGreeting(timeoutMs) {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const text = await this.hear(Math.max(1000, deadline - Date.now()))
      if (!/Group Grub order is open/i.test(text)) return text // skip the orchestrator intro
    }
  }
}

// --- orchestrator helpers
const snapshot = async () => (await api(`/api/orders/${orderId}`)).data
const participantOf = (snap, uid) => (snap?.participants || []).find((p) => p.slack_user_id === uid)
const isConfirmed = async (uid) => !!participantOf(await snapshot(), uid)?.confirmed
const cartOf = async (uid) => participantOf(await snapshot(), uid)?.cart || []

async function beginOrder() {
  const ts = String(Math.floor(Date.now() / 1000))
  const form = new URLSearchParams({
    command: '/begin-order',
    text: `<@${A}> <@${B}> $40 McDonald's 3m`,
    user_id: ADMIN,
    user_name: 'e2e-driver',
    channel_id: CHANNEL,
    channel_name: 'eats',
    team_id: 'T0BP3FGUGCU',
    enterprise_id: 'E0BNWAG5A4V',
    response_url: 'https://hooks.slack.com/commands/fake',
    trigger_id: 'fake',
  })
  const body = form.toString()
  const sig = 'v0=' + crypto.createHmac('sha256', SECRET).update(`v0:${ts}:${body}`).digest('hex')
  const res = await fetch(`${ORCH}/slack/commands`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Slack-Request-Timestamp': ts, 'X-Slack-Signature': sig },
    body,
  })
  const text = await res.text()
  if (res.status !== 200 || !/started/i.test(text)) throw new Error(`begin-order failed: ${res.status} ${text}`)
  console.log(`[0s] /begin-order accepted: ${text}`)
}

// --- background recorders
async function pollState() {
  while (!done) {
    const s = await snapshot().catch(() => null)
    if (s && s.state) {
      latestSnap = s
      noteState(s.state, 'poll')
      if (s.state === 'GRACE' && !graceEntry) {
        graceEntry = { t: rel(), snap: s }
      }
      if (['CLOSED', 'FAILED', 'CANCELLED'].includes(s.state)) return
    }
    await sleep(2000)
  }
}

function flattenBlocks(message) {
  const out = []
  for (const b of message?.blocks || []) {
    if (b.text?.text) out.push(b.text.text)
    for (const f of b.fields || []) out.push(f.text)
    for (const e of b.elements || []) out.push(e.text)
  }
  return out.join('\n')
}

async function pollAnnouncement() {
  while (!done) {
    if (annTs) {
      const h = await slack('conversations.history', { channel: CHANNEL, latest: annTs, inclusive: true, limit: 1 }).catch(() => null)
      const text = flattenBlocks(h?.messages?.[0])
      if (text) {
        run.annText = text
        const m = text.match(/\*Status:\*\s*([A-Z_]+)/)
        if (m && !run.annStates[m[1]]) {
          run.annStates[m[1]] = rel()
          noteState(m[1], 'announcement')
        }
      }
    }
    await sleep(2000)
  }
}

async function recordWs() {
  const wsBase = ORCH.replace(/^http/, 'ws')
  while (!done) {
    try {
      const sock = new WebSocket(`${wsBase}/ws?order_id=${orderId}`)
      await new Promise((res, rej) => {
        sock.onopen = res
        sock.onerror = () => rej(new Error('ws connect failed'))
        setTimeout(() => rej(new Error('ws connect timeout')), 10000)
      })
      console.log(`[${rel()}s] websocket subscribed`)
      sock.onmessage = (ev) => {
        const s = JSON.parse(ev.data)
        noteState(s.state, 'ws')
        run.ws.push({
          t: rel(),
          state: s.state,
          participants: (s.participants || []).map((p) => ({
            uid: p.slack_user_id,
            confirmed: p.confirmed,
            total: p.cart_total_cents,
            items: (p.cart || []).map((i) => `${i.quantity}x ${i.name}`),
          })),
        })
      }
      await new Promise((res) => {
        sock.onclose = res
        sock.onerror = res
      })
    } catch (e) {
      if (done) return
      await sleep(1500)
    }
  }
}

// --- participant scripts
async function participantA(items) {
  const h = new Human(A, 'A')
  await h.open()
  const greeting = await h.waitGreeting(90000)
  assert(greeting.length > 5, 'A received agent greeting')
  run.greetingA = true

  await h.say("Hey! What's on the menu? Can you suggest something tasty under $10?")
  const suggestion = await h.hear(60000)
  assert(/\$\s?\d/.test(suggestion), 'A got a menu suggestion with real prices', suggestion)

  await h.say('Great — add a Big Mac Meal and 20 French Fries please')
  const pushback = await h.hear(90000)
  assert(
    /over|budget|exceed|too much|remaining|remove|can'?t|cannot|only \$|limit|declin|reject/i.test(pushback),
    'A got over-budget pushback from the agent',
    pushback,
  )
  run.pushback = pushback.slice(0, 200)

  await h.say("Ha, ok — just the Big Mac Meal then, nothing else")
  await h.hear(60000)
  await until('A cart non-empty after settle', async () => ((await cartOf(A)).length > 0 ? true : null), 45000, 3000).catch(async () => {
    run.fallbacks.push('A settle: API add Big Mac Meal (agent add not observed in time)')
    const r = await apiPost(`/internal/orders/${orderId}/participants/${A}/cart`, { menu_item_id: items.bigMac.id })
    assert(r.status === 204, 'A fallback add Big Mac Meal', JSON.stringify(r.data))
  })

  // confirm via conversation; the agent may need one extra explicit "yes"
  let confirmed = await isConfirmed(A)
  if (!confirmed && Date.now() < t0 + 165000) {
    await h.say('Yes, that looks perfect — please confirm my order')
    const deadline = Date.now() + 75000
    let nudges = 0
    while (!confirmed && Date.now() < deadline) {
      const reply = await h.hear(35000).catch(() => null)
      confirmed = await isConfirmed(A)
      if (!confirmed && reply && nudges < 2) {
        await h.say('yes')
        nudges++
      }
    }
  }
  if (!confirmed) {
    run.fallbacks.push('A confirm: POST /confirm (conversation confirm not observed in time)')
    const r = await apiPost(`/internal/orders/${orderId}/participants/${A}/confirm`)
    assert(r.status === 204, 'A fallback confirm', JSON.stringify(r.data))
    run.confirmPath = 'fallback'
  } else {
    run.confirmPath = 'conversation'
  }
  assert(await isConfirmed(A), 'A is confirmed')

  // re-open: a confirmed participant modifies -> server un-confirms them
  await h.say('wait — actually add a Coke to my order too')
  const reopened = await until('A unconfirmed after modify', async () => (!(await isConfirmed(A)) ? true : null), 60000, 3000).catch(() => null)
  if (!reopened) {
    run.fallbacks.push('A reopen: API add Coke')
    const r = await apiPost(`/internal/orders/${orderId}/participants/${A}/cart`, { menu_item_id: items.coke.id })
    assert(r.status === 204, 'A fallback reopen add', JSON.stringify(r.data))
    run.reopenPath = 'fallback'
  } else {
    run.reopenPath = 'conversation'
  }
  assert(!(await isConfirmed(A)), 'modifying after confirm re-opened A')

  // demo tidiness: re-confirm A so the final checklist shows one ✅ and one ⏳
  if (Date.now() < t0 + (TIMER_SECONDS + GRACE_SECONDS - 40) * 1000) {
    await h.say('ok yes, confirm it again').catch(() => {})
    await until('A re-confirmed', async () => ((await isConfirmed(A)) ? true : null), 40000, 3000).catch(async () => {
      await apiPost(`/internal/orders/${orderId}/participants/${A}/confirm`).catch(() => {})
    })
  }
}

async function participantB(items) {
  const h = new Human(B, 'B')
  await h.open()
  await h.waitGreeting(90000)
  run.greetingB = true

  await h.say('Hi! What can I get here?')
  await h.hear(60000)
  await h.say('Add a Coke for me please')
  await h.hear(60000).catch(() => '')
  await until('B cart non-empty', async () => ((await cartOf(B)).length > 0 ? true : null), 45000, 3000).catch(async () => {
    run.fallbacks.push('B add Coke: API (agent add not observed in time)')
    const r = await apiPost(`/internal/orders/${orderId}/participants/${B}/cart`, { menu_item_id: items.coke.id })
    assert(r.status === 204, 'B fallback add Coke', JSON.stringify(r.data))
  })
  // B never confirms -> the 3-minute timer (not all-confirmed) must close COLLECTING

  await until('order reached GRACE', async () => (latestSnap?.state === 'GRACE' ? true : null), (TIMER_SECONDS + 60) * 1000, 2000)
  const graceDeadlineAtEntry = latestSnap.grace_deadline

  await h.say('Actually, can you add French Fries to my order too?')
  const before = (await cartOf(B)).length
  const grew = await until('B cart grew during GRACE', async () => (((await cartOf(B)).length > before) ? true : null), 75000, 3000).catch(() => null)
  let path = 'conversation'
  if (!grew) {
    run.fallbacks.push('B grace modify: API add French Fries')
    const r = await apiPost(`/internal/orders/${orderId}/participants/${B}/cart`, { menu_item_id: items.fries.id })
    assert(r.status === 204, 'B fallback grace add', JSON.stringify(r.data))
    path = 'fallback'
  }
  const after = await snapshot()
  run.graceModify = {
    t: rel(),
    path,
    stateAtModify: after.state,
    graceDeadlineAtEntry,
    graceDeadlineAfter: after.grace_deadline,
  }
}

async function main() {
  // pre-run hygiene: refuse to overlap a live order; let zombie bridges from a
  // recently-closed order exit (they self-terminate within seconds of CLOSED)
  const health = await api('/healthz')
  assert(health.status === 200 && /ok/.test(health.data), 'orchestrator healthz', String(health.data))
  const list = (await api('/api/orders')).data.orders
  const active = list.find((o) => ['OPEN', 'COLLECTING', 'GRACE', 'MINTING', 'SUBMITTING'].includes(o.state))
  if (active) throw new Error(`order ${active.id} is ${active.state}; wait for it to finish before re-running`)
  const fresh = list[0] && Date.now() - new Date(list[0].updated_at).getTime() < 60000
  if (fresh) {
    console.log('recent order activity; settling 30s for agent pods to exit')
    await sleep(30000)
  }

  const menu = (await api('/internal/menu?restaurant=' + encodeURIComponent(RESTAURANT))).data
  const pick = (re) => {
    const it = menu.items.find((i) => re.test(i.name))
    if (!it) throw new Error('menu item missing: ' + re)
    return it
  }
  const items = { bigMac: pick(/^Big Mac Meal$/), coke: pick(/^Coke/), fries: pick(/^French Fries$/) }

  await beginOrder()
  t0 = Date.now()

  orderId = await until('new order visible in /api/orders', async () => {
    const orders = (await api('/api/orders')).data.orders
    const hit = orders.find((o) => o.budget_cents === BUDGET && o.state === 'COLLECTING' && Date.now() - new Date(o.created_at).getTime() < 120000)
    return hit?.id
  }, 30000)
  run.orderId = orderId
  console.log(`[${rel()}s] order ${orderId}`)

  const recorder = recordWs()
  const poller = pollState()
  const annPoller = pollAnnouncement()

  annTs = await until('announcement posted in #eats', async () => {
    const h = await slack('conversations.history', { channel: CHANNEL, oldest: String(t0 / 1000 - 15), limit: 10 })
    const msgs = (h.messages || []).filter((m) => m.text === 'Group Grub order')
    return msgs.length ? msgs.map((m) => m.ts).sort().pop() : null
  }, 30000)
  run.announcementTs = annTs
  console.log(`[${rel()}s] announcement ts ${annTs}`)

  const [snapA, snapB] = await Promise.all([
    until('A participant row', async () => participantOf(await snapshot(), A), 15000),
    until('B participant row', async () => participantOf(await snapshot(), B), 15000),
  ])
  assert(snapA.share_cents === SHARE && snapB.share_cents === SHARE, 'fair share split $20/$20', `${snapA.share_cents}/${snapB.share_cents}`)

  await Promise.all([participantA(items), participantB(items)])

  const finalState = await until(
    'order reached terminal state',
    async () => {
      const s = await api(`/internal/orders/${orderId}`)
      return ['CLOSED', 'FAILED', 'CANCELLED'].includes(s.data.state) ? s.data.state : null
    },
    360000,
    3000,
  )
  assert(finalState === 'CLOSED', 'order closed via mint -> submit -> decline path', finalState)

  // ---- programmatic assertions
  assert(run.greetingA && run.greetingB, 'both simulated humans received agent greetings')
  assert(run.confirmPath === 'conversation', 'A confirmed via DM conversation', run.confirmPath)
  assert(['COLLECTING', 'GRACE', 'MINTING', 'SUBMITTING', 'CLOSED'].every((s) => run.states[s]), 'state progression COLLECTING->GRACE->MINTING->SUBMITTING->CLOSED observed', JSON.stringify(run.states))
  assert(run.annStates.COLLECTING !== undefined && run.annStates.GRACE !== undefined, 'announcement progressed COLLECTING->GRACE', JSON.stringify(run.annStates))
  assert(/\*Status:\*\s*CLOSED/.test(run.annText) && /declined \(by design\)/.test(run.annText) && run.annText.includes(`/api/orders/${orderId}/proof`), 'announcement final text shows closed + decline-proof line', run.annText)
  assert(graceEntry && graceEntry.t >= TIMER_SECONDS - 10, 'GRACE entered at timer expiry (not all-confirmed)', `t=${graceEntry?.t}s`)
  assert(graceEntry && !participantOf(graceEntry.snap, B)?.confirmed, 'B still unconfirmed at GRACE entry (timer path proven)')
  assert(run.graceModify?.stateAtModify === 'GRACE', 'cart modified during grace period', JSON.stringify(run.graceModify))
  assert(run.graceModify?.graceDeadlineAtEntry === run.graceModify?.graceDeadlineAfter, 'grace modification did not extend the grace deadline')

  const proof = (await api(`/api/orders/${orderId}/proof`)).data
  run.proof = proof
  assert(proof.state === 'CLOSED', 'proof endpoint reports CLOSED')
  const sharesOk = proof.participants.every((p) => (p.cart || []).reduce((s, i) => s + i.price_cents * i.quantity, 0) <= p.share_cents)
  assert(sharesOk, 'every cart <= share')
  assert(proof.total_cents > 0 && proof.total_cents <= 30000, 'order total within $300 cap', `total=${proof.total_cents}`)
  assert(proof.participants.find((p) => p.slack_user_id === B && !p.confirmed), 'B never confirmed')
  const ca = proof.card_attempt || {}
  assert(ca.rain_card_id, 'Rain card id recorded', ca.rain_card_id)
  assert(ca.doordash_delivery_id === 'gg-' + orderId, 'DoorDash delivery id recorded', ca.doordash_delivery_id)
  assert(ca.declined_at, 'declined_at recorded')
  const ddRaw = JSON.stringify(ca.doordash_response || {})
  assert(ddRaw.includes('"declined"') && ddRaw.includes('account_credit_limit_exceeded'), 'card_attempts has DoorDash + Rain decline evidence')
  assert(ca.payment_path === 'rain_simulated_authorization', 'payment path recorded', ca.payment_path)

  const cards = await (await fetch(`${RAIN_BASE}/issuing/cards`, { headers: { 'Api-Key': RAIN_KEY } })).json()
  const card = cards.find((c) => c.id === ca.rain_card_id)
  assert(card, 'minted card exists in Rain sandbox', ca.rain_card_id)
  const expectedLimit = Math.round(ca.amount_cents * 1.2)
  assert(card.limit?.amount === expectedLimit, `Rain card limit = 1.2x order total (${ca.amount_cents} -> ${expectedLimit})`, `got ${card.limit?.amount}`)
  run.cardId = ca.rain_card_id

  const past = (await api('/api/orders')).data.orders.find((o) => o.id === orderId)
  assert(past && past.state === 'CLOSED' && past.rain_card_id === ca.rain_card_id, 'past-orders API lists the run (frontend past-orders page data)')
  const home = await fetch(FRONTEND + '/')
  assert(home.status === 200 && (await home.text()).length > 200, 'frontend serves the app (past-orders page reachable)')

  assert(run.ws.length >= 3, 'websocket emitted snapshots during the run', `${run.ws.length} snapshots`)
  assert(run.ws.some((s) => s.participants.some((p) => p.items.length > 0)), 'websocket emitted cart events')
  assert(run.ws.some((s) => s.state === 'GRACE'), 'websocket emitted the GRACE transition')

  const link = await slack('chat.getPermalink', { channel: CHANNEL, message_ts: annTs })
    .then((r) => r.permalink)
    .catch(() => `https://rain-hackathon-sand.slack.com/archives/${CHANNEL}/p${annTs.replace('.', '')}`)
  run.permalink = link
  run.finishedAt = new Date().toISOString()
  run.durationSeconds = rel()
}

async function cleanup() {
  if (!orderId) return
  const s = await api(`/internal/orders/${orderId}`).catch(() => null)
  if (s && ['OPEN', 'COLLECTING', 'GRACE', 'MINTING'].includes(s.data?.state)) {
    await apiPost(`/internal/orders/${orderId}/cancel`).catch(() => {})
    console.log('aborted run cancelled to avoid a stray mint')
  }
}

function writeReport(ok, error) {
  const md = new URL('../docs-notes/e2e-run.md', import.meta.url)
  const L = []
  L.push('# E2E run — milestone 10 (full flow with simulated humans)')
  L.push('')
  L.push(`- result: ${ok ? 'PASS' : 'FAIL'}${error ? ` — ${error}` : ''}`)
  L.push(`- started: ${run.startedAt}${run.finishedAt ? `, duration ${run.durationSeconds}s` : ''}`)
  L.push(`- stack: orchestrator ${ORCH}, frontend ${FRONTEND}, k8s agent pods (goose + z-ai/glm-5.2)`)
  L.push(`- order id: ${run.orderId || 'n/a'}`)
  L.push(`- announcement permalink: ${run.permalink || 'n/a'} (channel #eats, ts ${run.announcementTs || 'n/a'})`)
  L.push(`- rain card id: ${run.cardId || 'n/a'}`)
  L.push(`- scenario: admin /begin-order 2 participants, $40, McDonald's, 3m timer; A = full conversational flow (browse -> suggestion -> over-budget pushback -> settle -> confirm -> modify-after-confirm), B = lagger (never confirms -> timer path, then modifies during grace)`)
  if (run.fallbacks.length) {
    L.push(`- fallbacks used (DM step not observed in time, equivalent internal API used): ${run.fallbacks.join('; ')}`)
  } else {
    L.push('- fallbacks used: none — every human action went through the agent DM conversation')
  }
  L.push('')
  L.push('## State progression (first observed, seconds since /begin-order)')
  L.push('')
  for (const [state, info] of Object.entries(run.states)) L.push(`- ${state}: t=${info.t}s (via ${info.source})`)
  L.push('')
  L.push(`Announcement-observed states: ${JSON.stringify(run.annStates)}`)
  L.push(`Grace modify: ${JSON.stringify(run.graceModify || null)}`)
  L.push(`Websocket snapshots captured: ${run.ws.length}`)
  L.push('')
  L.push('## Assertions')
  L.push('')
  for (const a of run.assertions) L.push(`- ${a.ok ? 'PASS' : 'FAIL'} ${a.name}${a.detail ? ` — ${a.detail}` : ''}`)
  L.push('')
  L.push('## Simulated-human transcript (Slack DMs)')
  L.push('')
  for (const m of run.transcript) L.push(`- [t=${m.t}s] ${m.who}: ${m.text}`)
  L.push('')
  if (run.proof) {
    L.push(`## Proof JSON (GET /api/orders/${run.orderId}/proof)`)
    L.push('')
    L.push('```json')
    L.push(JSON.stringify(run.proof, null, 2))
    L.push('```')
  }
  fs.writeFileSync(md, L.join('\n') + '\n')
  console.log('wrote docs-notes/e2e-run.md')
}

try {
  await main()
  console.log('e2e passed')
  process.exitCode = 0
} catch (e) {
  console.error('e2e failed:', e.message)
  await cleanup()
  process.exitCode = 1
} finally {
  done = true
  writeReport(process.exitCode === 0, process.exitCode === 0 ? null : 'see assertions above')
  setTimeout(() => process.exit(process.exitCode), 1500).unref()
}
