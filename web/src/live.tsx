import { useEffect, useRef, useState } from 'react'
import { api, cents, wsUrl, OrderSummary, Snapshot, ACTIVE_STATES } from './api'

function useCountdown(deadline: string | null, offsetMs: number): string {
  const [, force] = useState(0)
  useEffect(() => {
    if (!deadline) return
    const timer = setInterval(() => force((n) => n + 1), 1000)
    return () => clearInterval(timer)
  }, [deadline])
  if (!deadline) return ''
  const remaining = new Date(deadline).getTime() - (Date.now() + offsetMs)
  if (remaining <= 0) return '0:00'
  const minutes = Math.floor(remaining / 60000)
  const seconds = Math.floor((remaining % 60000) / 1000)
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function LiveView({ orderId }: { orderId: string }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [connected, setConnected] = useState(false)
  const [offset, setOffset] = useState(0)
  const socketRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    setSnapshot(null)
    let closed = false
    let retry: ReturnType<typeof setTimeout>

    function connect() {
      const socket = new WebSocket(wsUrl(orderId))
      socketRef.current = socket
      socket.onopen = () => setConnected(true)
      socket.onmessage = (event) => {
        const data: Snapshot = JSON.parse(event.data)
        setOffset(new Date(data.server_time).getTime() - Date.now())
        setSnapshot(data)
      }
      socket.onclose = () => {
        setConnected(false)
        if (!closed) retry = setTimeout(connect, 2000)
      }
      socket.onerror = () => socket.close()
    }
    connect()
    return () => {
      closed = true
      clearTimeout(retry)
      socketRef.current?.close()
    }
  }, [orderId])

  const countdown = useCountdown(
    snapshot?.state === 'COLLECTING' ? snapshot.timer_deadline : snapshot?.state === 'GRACE' ? snapshot.grace_deadline : null,
    offset,
  )

  if (!snapshot) return <p className="muted">Connecting to live order…</p>

  const pool = snapshot.budget_cents - snapshot.participants.reduce((sum, p) => sum + p.share_cents, 0)
  const settled = snapshot.state === 'CLOSED' || snapshot.state === 'DECLINED_PROOF_CAPTURED'

  return (
    <section>
      <div className="sheettop">
        <span className={`state${snapshot.state === 'GRACE' ? ' grace' : ''}`}>{snapshot.state}</span>
        <span className={`dot ${connected ? 'dot-on' : 'dot-off'}`} title={connected ? 'live' : 'reconnecting…'} />
        <span className="rest">{snapshot.restaurant}</span>
        {countdown && (
          <>
            <span className="clocklbl">{snapshot.state === 'GRACE' ? 'grace left' : 'window closes in'}</span>
            <span className="clock num">{countdown}</span>
          </>
        )}
      </div>

      <h2 className="ours">Rain Check ledger enforces the amount</h2>
      <table>
        <thead>
          <tr><th className="l">account</th><th>sub-budget</th><th>spent</th><th>unspent</th></tr>
        </thead>
        <tbody>
          {snapshot.participants.map((p) => (
            <tr key={p.slack_user_id}>
              <td className="l">
                <span className="who">{p.slack_user_id}</span>
                <span className={`flag${p.confirmed ? ' confirmed' : ''}`}>{p.confirmed ? 'confirmed' : 'ordering'}</span>
                <span className="cart">
                  {p.cart.length === 0
                    ? 'cart is empty'
                    : p.cart.map((item) => `${item.quantity}× ${item.name} ${cents(item.price_cents * item.quantity)}`).join(' · ')}
                </span>
              </td>
              <td className="num">{cents(p.share_cents)}</td>
              <td className="num">{cents(p.cart_total_cents)}</td>
              <td className="num">{cents(p.share_cents - p.cart_total_cents)}</td>
            </tr>
          ))}
          {pool > 0 && (
            <tr className="sum">
              <td className="l">unallocated pool</td>
              <td className="num">{cents(pool)}</td>
              <td className="num">{cents(0)}</td>
              <td className="num">{cents(pool)}</td>
            </tr>
          )}
          <tr className="total">
            <td className="l">control total — admin cap</td>
            <td className="num">{cents(snapshot.budget_cents)}</td>
            <td className="num">{cents(snapshot.total_cents)}</td>
            <td className="num">{cents(snapshot.budget_cents - snapshot.total_cents)}</td>
          </tr>
        </tbody>
      </table>

      <div className="grand">
        <span className="big num">{cents(snapshot.total_cents)}</span>
        <span className="of">
          of a {cents(snapshot.budget_cents)} cap<br />
          {snapshot.participants.filter((p) => p.confirmed).length} of {snapshot.participants.length} confirmed
        </span>
      </div>

      {settled && (
        <p className="settled">Order received — card charged and delivery submitted.</p>
      )}
    </section>
  )
}

export default function CurrentOrder() {
  const [orders, setOrders] = useState<OrderSummary[]>([])
  const [orderId, setOrderId] = useState('')
  const [manual, setManual] = useState('')

  useEffect(() => {
    api('/api/orders').then(async (res) => {
      if (!res.ok) return
      const all: OrderSummary[] = (await res.json()).orders || []
      setOrders(all)
      const active = all.find((o) => ACTIVE_STATES.includes(o.state))
      if (active) setOrderId((current) => current || active.id)
    })
  }, [])

  const active = orders.filter((o) => ACTIVE_STATES.includes(o.state))

  return (
    <div>
      <div className="card row">
        <label>Live order
          <select value={orderId} onChange={(e) => setOrderId(e.target.value)}>
            {orderId === '' && <option value="">Select…</option>}
            {active.map((o) => <option key={o.id} value={o.id}>{o.restaurant} — {o.state} — {new Date(o.created_at).toLocaleTimeString()}</option>)}
            {orderId && !active.some((o) => o.id === orderId) && <option value={orderId}>{orderId}</option>}
          </select>
        </label>
        <form onSubmit={(e) => { e.preventDefault(); if (manual.trim()) setOrderId(manual.trim()) }} className="row">
          <input placeholder="or paste order id" value={manual} onChange={(e) => setManual(e.target.value)} />
          <button type="submit">Watch</button>
        </form>
      </div>
      {orderId
        ? <LiveView orderId={orderId} />
        : <p className="muted">No active order right now. Start one with <code>/begin-order</code> in Slack.</p>}
    </div>
  )
}
