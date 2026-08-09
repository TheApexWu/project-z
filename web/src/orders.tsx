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

function orderIdFromHash(): string | null {
  const m = window.location.hash.match(/^#\/orders\/([0-9a-fA-F-]{36})$/)
  return m ? m[1] : null
}

function JsonBlock({ title, value }: { title: string; value: unknown }) {
  return (
    <details className="json-block">
      <summary>{title}</summary>
      <pre>{JSON.stringify(value, null, 2)}</pre>
    </details>
  )
}

function cartTotal(cart: { price_cents: number; quantity: number }[] = []): number {
  return cart.reduce((sum, item) => sum + item.price_cents * item.quantity, 0)
}

function OrderDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const [proof, setProof] = useState<Proof | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api(`/api/orders/${id}/proof`).then(async (res) => {
      if (!res.ok) {
        setError(`Failed to load receipt: ${res.status}`)
        return
      }
      setProof(await res.json())
    })
  }, [id])

  if (error) return <p className="error">{error}</p>
  if (!proof) return <p className="muted">Loading…</p>

  const attempt = proof.card_attempt
  const settled = proof.state === 'CLOSED' || proof.state === 'DECLINED_PROOF_CAPTURED'
  const pool = proof.budget_cents - (proof.participants || []).reduce((sum, p) => sum + p.share_cents, 0)

  return (
    <section>
      <div className="sheettop">
        <span className={`badge state-${proof.state}`}>{proof.state}</span>
        <span className="rest">{proof.restaurant}</span>
        <span className="clocklbl">{new Date(proof.created_at).toLocaleString()}</span>
      </div>

      <button className="link" onClick={onBack}>← all orders</button>

      <div className="cols">
        <div className="left">
          {settled && <p className="settled">Order received — card charged and delivery submitted.</p>}

          <h2 className="ours">Rain Check ledger enforces the amount</h2>
          <table>
            <thead>
              <tr><th className="l">account</th><th>sub-budget</th><th>spent</th><th>unspent</th></tr>
            </thead>
            <tbody>
              {(proof.participants || []).map((p) => {
                const spent = cartTotal(p.cart)
                return (
                  <tr key={p.slack_user_id}>
                    <td className="l">
                      <span className="who">{p.slack_user_id}</span>
                      <span className={`flag${p.confirmed ? ' confirmed' : ''}`}>{p.confirmed ? 'confirmed' : 'never confirmed'}</span>
                      <span className="cart">
                        {!p.cart || p.cart.length === 0
                          ? 'cart is empty'
                          : p.cart.map((item) => `${item.quantity}× ${item.name} ${cents(item.price_cents * item.quantity)}`).join(' · ')}
                      </span>
                    </td>
                    <td className="num">{cents(p.share_cents)}</td>
                    <td className="num">{cents(spent)}</td>
                    <td className="num">{cents(p.share_cents - spent)}</td>
                  </tr>
                )
              })}
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
                <td className="num">{cents(proof.budget_cents)}</td>
                <td className="num">{cents(proof.total_cents)}</td>
                <td className="num">{cents(proof.budget_cents - proof.total_cents)}</td>
              </tr>
            </tbody>
          </table>

          <div className="grand">
            <span className="big num">{cents(proof.total_cents)}</span>
            <span className="of">
              of a {cents(proof.budget_cents)} cap<br />
              order <span className="num">{proof.order_id.slice(0, 8)}</span>
            </span>
          </div>

          {attempt && (
            <div className="tape">
              <h3>authorization tape · Rain&rsquo;s record</h3>
              <JsonBlock title="Rain card creation response" value={attempt.rain_response} />
              <JsonBlock title="DoorDash submission response" value={attempt.doordash_response} />
            </div>
          )}
        </div>

        <div className="right">
          {attempt ? (
            <>
              <h2 className="rain">Rain credential</h2>
              <div className="credential">
                <div className="hd"><span>SCOPED CARD · SINGLE USE</span><span>{attempt.declined_at ? 'charged' : 'open'}</span></div>
                <div className="amt">{cents(attempt.amount_cents)}</div>
                <div className="uuid">{attempt.rain_card_id || '—'}</div>
                <div className="grid">
                  <div>
                    <div className="k">AMOUNT</div>
                    <div className="v">{cents(attempt.amount_cents)}</div>
                    <div className="by ours">our ledger</div>
                  </div>
                  <div>
                    <div className="k">PAYMENT PATH</div>
                    <div className="v">{attempt.payment_path || '—'}</div>
                    <div className="by rain">Rain enforces</div>
                  </div>
                </div>
              </div>

              <table style={{ marginTop: 20 }}>
                <tbody>
                  {attempt.declined_at && (
                    <tr><td className="l">charged</td><td className="num">{new Date(attempt.declined_at).toLocaleTimeString()}</td></tr>
                  )}
                  {attempt.doordash_delivery_id && (
                    <tr><td className="l">delivery</td><td className="num">{attempt.doordash_delivery_id.slice(0, 20)}</td></tr>
                  )}
                  {proof.collateral_contract_id && (
                    <tr><td className="l">collateral</td><td className="num">{proof.collateral_contract_id.slice(0, 8)}{proof.collateral_chain ? ` · ${proof.collateral_chain}` : ''}</td></tr>
                  )}
                </tbody>
              </table>
            </>
          ) : (
            <>
              <h2 className="rain">Rain credential</h2>
              <p className="muted">No card was minted for this order.</p>
            </>
          )}
        </div>
      </div>
    </section>
  )
}

export default function PastOrders() {
  const [orders, setOrders] = useState<OrderSummary[]>([])
  const [selected, setSelected] = useState<string | null>(orderIdFromHash)
  const [error, setError] = useState('')

  useEffect(() => {
    const onHash = () => setSelected(orderIdFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    api('/api/orders').then(async (res) => {
      if (!res.ok) {
        setError(`Failed to load orders: ${res.status}`)
        return
      }
      setOrders((await res.json()).orders || [])
    })
  }, [])

  const open = (id: string) => {
    window.location.hash = `#/orders/${id}`
    setSelected(id)
  }
  const back = () => {
    window.location.hash = '#/orders'
    setSelected(null)
  }

  if (selected) return <OrderDetail id={selected} onBack={back} />
  if (error) return <p className="error">{error}</p>

  const past = orders.filter((o) => TERMINAL_STATES.includes(o.state))
  return (
    <section>
      <h2 className="ours">Past orders</h2>
      {past.length === 0 && <p className="muted">No finished orders yet.</p>}
      <table>
        <thead>
          <tr>
            <th className="l">when</th><th className="l">restaurant</th><th className="l">state</th>
            <th>total</th><th>cap</th><th>confirmed</th><th className="l">card</th><th></th>
          </tr>
        </thead>
        <tbody>
          {past.map((order) => (
            <tr key={order.id}>
              <td className="l"><span className="num">{new Date(order.created_at).toLocaleString()}</span></td>
              <td className="l"><span className="who">{order.restaurant}</span></td>
              <td className="l"><span className={`badge state-${order.state}`}>{order.state}</span></td>
              <td className="num">{cents(order.total_cents)}</td>
              <td className="num">{cents(order.budget_cents)}</td>
              <td className="num">{order.confirmed_count}/{order.participant_count}</td>
              <td className="l"><span className="num">{order.rain_card_id ? order.rain_card_id.slice(0, 8) : '—'}</span></td>
              <td><button className="link" onClick={() => open(order.id)}>receipt →</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
