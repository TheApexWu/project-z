import { useEffect, useState } from 'react'
import { api, cents, OrderSummary, TERMINAL_STATES } from './api'

interface Proof {
  order_id: string
  state: string
  restaurant: string
  budget_cents: number
  total_cents: number
  collateral_contract_id: string
  collateral_chain: string
  created_at: string
  updated_at: string
  participants: { slack_user_id: string; share_cents: number; confirmed: boolean; cart: { name: string; price_cents: number; quantity: number }[] }[]
  card_attempt?: {
    id: number
    rain_card_id: string
    amount_cents: number
    rain_request: unknown
    rain_response: unknown
    doordash_request: unknown
    doordash_response: unknown
    doordash_delivery_id: string
    payment_path: string
    declined_at: string | null
    created_at: string
  }
}

function JsonBlock({ title, value }: { title: string; value: unknown }) {
  return (
    <details className="json-block">
      <summary>{title}</summary>
      <pre>{JSON.stringify(value, null, 2)}</pre>
    </details>
  )
}

function OrderDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const [proof, setProof] = useState<Proof | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api(`/api/orders/${id}/proof`).then(async (res) => {
      if (!res.ok) {
        setError(`Failed to load proof: ${res.status}`)
        return
      }
      setProof(await res.json())
    })
  }, [id])

  if (error) return <p className="error">{error}</p>
  if (!proof) return <p>Loading…</p>

  const attempt = proof.card_attempt
  return (
    <section>
      <button className="link" onClick={onBack}>← all orders</button>
      <div className="card">
        <h2>{proof.restaurant} <span className={`badge state-${proof.state}`}>{proof.state}</span></h2>
        <p className="muted">Order <code>{proof.order_id}</code></p>
        <div className="stats">
          <div><strong>{cents(proof.total_cents)}</strong><span>total</span></div>
          <div><strong>{cents(proof.budget_cents)}</strong><span>budget</span></div>
          <div><strong>{proof.participants?.length ?? 0}</strong><span>participants</span></div>
          {attempt && <div><strong>{cents(attempt.amount_cents)}</strong><span>card amount</span></div>}
        </div>
        {proof.collateral_contract_id && (
          <p className="muted">Rain collateral contract: <code>{proof.collateral_contract_id}</code>{proof.collateral_chain ? ` (${proof.collateral_chain})` : ''}</p>
        )}
      </div>

      {attempt && (
        <div className="card decline-proof">
          <h2>Decline proof</h2>
          <p>
            Rain card <code>{attempt.rain_card_id}</code> was charged {cents(attempt.amount_cents)} via{' '}
            <code>{attempt.payment_path || 'unknown'}</code> and the payment was{' '}
            <strong className="error">declined by design</strong>
            {attempt.declined_at && <> at {new Date(attempt.declined_at).toLocaleString()}</>}.
          </p>
          {attempt.doordash_delivery_id && <p className="muted">DoorDash sandbox delivery: <code>{attempt.doordash_delivery_id}</code></p>}
          <JsonBlock title="Rain card creation request" value={attempt.rain_request} />
          <JsonBlock title="Rain card creation response" value={attempt.rain_response} />
          <JsonBlock title="DoorDash submission request" value={attempt.doordash_request} />
          <JsonBlock title="DoorDash submission response (incl. decline)" value={attempt.doordash_response} />
        </div>
      )}

      <div className="card">
        <h2>Participants</h2>
        <table>
          <thead><tr><th>User</th><th>Share</th><th>Confirmed</th><th>Cart</th></tr></thead>
          <tbody>
            {proof.participants?.map((p) => (
              <tr key={p.slack_user_id}>
                <td><code>{p.slack_user_id}</code></td>
                <td>{cents(p.share_cents)}</td>
                <td>{p.confirmed ? '✅' : '—'}</td>
                <td>{p.cart?.map((item, i) => <div key={i}>{item.quantity}× {item.name} ({cents(item.price_cents)})</div>)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export default function PastOrders() {
  const [orders, setOrders] = useState<OrderSummary[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api('/api/orders').then(async (res) => {
      if (!res.ok) {
        setError(`Failed to load orders: ${res.status}`)
        return
      }
      setOrders((await res.json()).orders || [])
    })
  }, [])

  if (selected) return <OrderDetail id={selected} onBack={() => setSelected(null)} />
  if (error) return <p className="error">{error}</p>

  const past = orders.filter((o) => TERMINAL_STATES.includes(o.state))
  return (
    <section className="card">
      <h2>Past orders</h2>
      {past.length === 0 && <p>No finished orders yet.</p>}
      <table>
        <thead><tr><th>When</th><th>Restaurant</th><th>State</th><th>Total</th><th>Participants</th><th>Card</th><th></th></tr></thead>
        <tbody>
          {past.map((order) => (
            <tr key={order.id}>
              <td>{new Date(order.created_at).toLocaleString()}</td>
              <td>{order.restaurant}</td>
              <td><span className={`badge state-${order.state}`}>{order.state}</span></td>
              <td>{cents(order.total_cents)}</td>
              <td>{order.confirmed_count}/{order.participant_count}</td>
              <td>{order.rain_card_id ? <code>{order.rain_card_id.slice(0, 8)}…</code> : '—'}</td>
              <td><button className="link" onClick={() => setSelected(order.id)}>proof →</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
