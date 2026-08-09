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

  if (!snapshot) return <p>Connecting to live order…</p>

  return (
    <section>
      <div className="card">
        <h2>
          {snapshot.restaurant} <span className={`badge state-${snapshot.state}`}>{snapshot.state}</span>
          <span className={`dot ${connected ? 'dot-on' : 'dot-off'}`} title={connected ? 'live' : 'reconnecting…'} />
        </h2>
        <p className="muted">Order <code>{snapshot.id}</code></p>
        <div className="stats">
          <div><strong>{cents(snapshot.total_cents)}</strong><span>of {cents(snapshot.budget_cents)} budget</span></div>
          <div><strong>{snapshot.participants.filter((p) => p.confirmed).length}/{snapshot.participants.length}</strong><span>confirmed</span></div>
          {countdown && <div><strong>{countdown}</strong><span>{snapshot.state === 'GRACE' ? 'grace left' : 'time left'}</span></div>}
        </div>
        <div className="bar">
          <div className="bar-fill" style={{ width: `${Math.min(100, (snapshot.total_cents / Math.max(1, snapshot.budget_cents)) * 100)}%` }} />
        </div>
      </div>

      <div className="participants">
        {snapshot.participants.map((p) => (
          <div className="card participant" key={p.slack_user_id}>
            <h3>
              <code>{p.slack_user_id}</code> {p.confirmed ? '✅' : '⏳'}
            </h3>
            <p className="muted">{cents(p.cart_total_cents)} of {cents(p.share_cents)} share</p>
            <ul>
              {p.cart.map((item, i) => (
                <li key={i}>{item.quantity}× {item.name} — {cents(item.price_cents * item.quantity)}</li>
              ))}
              {p.cart.length === 0 && <li className="muted">cart is empty</li>}
            </ul>
          </div>
        ))}
      </div>
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
        <label>Live order{' '}
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
      {orderId ? <LiveView orderId={orderId} /> : <p>No active order right now. Start one with <code>/begin-order</code> in Slack.</p>}
    </div>
  )
}
