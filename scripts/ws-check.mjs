#!/usr/bin/env node
// Milestone 9 verification: create a test order, subscribe over /ws, add a cart
// item via the API, and assert an updated snapshot arrives within 5s.
// Usage: node scripts/ws-check.mjs [orchestrator_base_url]
const base = process.argv[2] || 'https://orchestrator-production-ef93.up.railway.app'
const wsBase = base.replace(/^http/, 'ws')
const user = 'U0BNXRCAQ3G'

function fail(msg) {
  console.error(`FAIL: ${msg}`)
  process.exit(1)
}

const createRes = await fetch(`${base}/internal/orders`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ budget_cents: 2000, restaurant: "McDonald's", participants: [user], timer_seconds: 3600 }),
})
if (!createRes.ok) fail(`create order: ${createRes.status} ${await createRes.text()}`)
const { id: orderId } = await createRes.json()
console.log(`order ${orderId} created`)

try {
  const snapshots = []
  const socket = new WebSocket(`${wsBase}/ws?order_id=${orderId}`)
  await new Promise((resolve, reject) => {
    socket.onopen = resolve
    socket.onerror = () => reject(new Error('websocket connect failed'))
    setTimeout(() => reject(new Error('websocket connect timeout')), 10000)
  })
  socket.onmessage = (event) => snapshots.push(JSON.parse(event.data))

  await new Promise((resolve) => {
    const started = Date.now()
    const poll = () => (snapshots.length > 0 ? resolve() : Date.now() > started + 5000 ? fail('no initial snapshot within 5s') : setTimeout(poll, 50))
    poll()
  })
  console.log(`initial snapshot: state=${snapshots[0].state} participants=${snapshots[0].participants.length}`)

  const before = snapshots.length
  const addRes = await fetch(`${base}/internal/orders/${orderId}/participants/${user}/cart`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'French Fries', price_cents: 219, quantity: 1 }),
  })
  if (!addRes.ok) fail(`add cart item: ${addRes.status} ${await addRes.text()}`)

  const addedAt = Date.now()
  await new Promise((resolve) => {
    const poll = () => {
      const hit = snapshots.find((s) => s.participants?.[0]?.cart?.some((item) => item.name === 'French Fries'))
      if (hit) return resolve()
      if (Date.now() - addedAt > 5000) return fail(`cart update not pushed within 5s (got ${snapshots.length - before} new snapshots)`)
      setTimeout(poll, 50)
    }
    poll()
  })
  console.log(`websocket pushed cart update in ${Date.now() - addedAt}ms`)
  socket.close()
} finally {
  const cancelRes = await fetch(`${base}/internal/orders/${orderId}/cancel`, { method: 'POST' })
  console.log(`cleanup cancel: ${cancelRes.status}`)
}
console.log('ws-check passed')
