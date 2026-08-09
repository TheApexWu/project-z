import { useEffect, useState } from 'react'
import { api, getAuth, setAuth, clearAuth, cents } from './api'

interface Settings {
  rain_client_rules: {
    allowedMccs?: string[]
    expiresInDays?: number
    amountCapCents?: number
  }
  delivery_address: string
}

interface Admin {
  slack_user_id: string
  can_create_orders: boolean
}

interface SlackUser {
  id: string
  name: string
  real_name: string
}

export default function AdminPanel() {
  const [authed, setAuthed] = useState(!!getAuth())
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [settings, setSettings] = useState<Settings | null>(null)
  const [address, setAddress] = useState('')
  const [mccs, setMccs] = useState('')
  const [expiresInDays, setExpiresInDays] = useState(0)
  const [amountCapCents, setAmountCapCents] = useState(0)
  const [saved, setSaved] = useState('')
  const [admins, setAdmins] = useState<Admin[]>([])
  const [users, setUsers] = useState<SlackUser[]>([])
  const [pick, setPick] = useState('')

  async function load() {
    const [settingsRes, adminsRes, usersRes] = await Promise.all([
      api('/api/settings'),
      api('/api/admins'),
      api('/api/slack/users'),
    ])
    if (settingsRes.status === 401) {
      setAuthed(false)
      return
    }
    const s = await settingsRes.json()
    setSettings(s)
    setAddress(s.delivery_address || '')
    setMccs((s.rain_client_rules?.allowedMccs || []).join(', '))
    setExpiresInDays(s.rain_client_rules?.expiresInDays || 0)
    setAmountCapCents(s.rain_client_rules?.amountCapCents || 0)
    if (adminsRes.ok) setAdmins((await adminsRes.json()).admins || [])
    if (usersRes.ok) setUsers((await usersRes.json()).users || [])
  }

  useEffect(() => {
    if (authed) load().catch((e) => setError(String(e)))
  }, [authed])

  async function login(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setAuth(username, password)
    const res = await api('/api/settings')
    if (res.status === 401) {
      clearAuth()
      setError('Invalid credentials')
      return
    }
    setAuthed(true)
  }

  async function saveSettings(e: React.FormEvent) {
    e.preventDefault()
    setSaved('')
    const rules: Record<string, unknown> = {
      allowedMccs: mccs.split(',').map((m) => m.trim()).filter(Boolean),
      expiresInDays: Number(expiresInDays) || 0,
      amountCapCents: Number(amountCapCents) || 0,
    }
    const res = await api('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({ rain_client_rules: rules, delivery_address: address }),
    })
    setSaved(res.ok ? 'Saved.' : `Save failed: ${res.status}`)
  }

  async function addAdmin(e: React.FormEvent) {
    e.preventDefault()
    if (!pick) return
    await api('/api/admins', { method: 'POST', body: JSON.stringify({ slack_user_id: pick, can_create_orders: true }) })
    setPick('')
    load()
  }

  async function toggleAdmin(admin: Admin) {
    await api('/api/admins', {
      method: 'POST',
      body: JSON.stringify({ slack_user_id: admin.slack_user_id, can_create_orders: !admin.can_create_orders }),
    })
    load()
  }

  async function removeAdmin(admin: Admin) {
    await api(`/api/admins/${admin.slack_user_id}`, { method: 'DELETE' })
    load()
  }

  if (!authed) {
    return (
      <section className="card narrow">
        <h2>Admin login</h2>
        <form onSubmit={login}>
          <label>Username <input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus /></label>
          <label>Password <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
          <button type="submit">Log in</button>
          {error && <p className="error">{error}</p>}
        </form>
      </section>
    )
  }

  if (!settings) return <p>Loading…</p>

  const knownIds = new Set(admins.map((a) => a.slack_user_id))
  const candidates = users.filter((u) => !knownIds.has(u.id))

  return (
    <section>
      <div className="card">
        <h2>Order settings</h2>
        <form onSubmit={saveSettings}>
          <label>Delivery address
            <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="1 Hackathon Way, San Francisco, CA 94105" />
          </label>
          <fieldset>
            <legend>Rain card client rules</legend>
            <label>Allowed MCCs (comma-separated)
              <input value={mccs} onChange={(e) => setMccs(e.target.value)} placeholder="5411, 5812, 5814" />
            </label>
            <label>Card expiry (days, 0 = Rain default)
              <input type="number" min={0} value={expiresInDays} onChange={(e) => setExpiresInDays(Number(e.target.value))} />
            </label>
            <label>Spend cap per card (cents, 0 = order total)
              <input type="number" min={0} value={amountCapCents} onChange={(e) => setAmountCapCents(Number(e.target.value))} />
            </label>
          </fieldset>
          <button type="submit">Save settings</button>
          {saved && <span className="ok"> {saved}</span>}
        </form>
      </div>

      <div className="card">
        <h2>Admins &amp; order creators</h2>
        <table>
          <thead><tr><th>Slack user</th><th>Can create orders</th><th></th></tr></thead>
          <tbody>
            {admins.map((admin) => (
              <tr key={admin.slack_user_id}>
                <td><code>{admin.slack_user_id}</code>{users.find((u) => u.id === admin.slack_user_id)?.real_name ? ` — ${users.find((u) => u.id === admin.slack_user_id)?.real_name}` : ''}</td>
                <td><input type="checkbox" checked={admin.can_create_orders} onChange={() => toggleAdmin(admin)} /></td>
                <td><button className="link" onClick={() => removeAdmin(admin)}>remove</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <form onSubmit={addAdmin} className="row">
          <select value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">Pick a Slack user…</option>
            {candidates.map((u) => <option key={u.id} value={u.id}>{u.real_name || u.name} ({u.id})</option>)}
          </select>
          <button type="submit" disabled={!pick}>Add admin</button>
        </form>
      </div>
    </section>
  )
}
