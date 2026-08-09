export const base: string = import.meta.env.VITE_ORCHESTRATOR_URL || ''

const AUTH_KEY = 'gg_basic_auth'

export function getAuth(): string | null {
  return sessionStorage.getItem(AUTH_KEY)
}

export function setAuth(username: string, password: string) {
  sessionStorage.setItem(AUTH_KEY, btoa(`${username}:${password}`))
}

export function clearAuth() {
  sessionStorage.removeItem(AUTH_KEY)
}

export async function api(path: string, options: RequestInit = {}): Promise<Response> {
  const headers: Record<string, string> = { ...(options.headers as Record<string, string>) }
  const auth = getAuth()
  if (auth) headers['Authorization'] = `Basic ${auth}`
  if (options.body) headers['Content-Type'] = 'application/json'
  return fetch(`${base}${path}`, { ...options, headers })
}

export function wsUrl(orderId: string): string {
  return `${base.replace(/^http/, 'ws')}/ws?order_id=${encodeURIComponent(orderId)}`
}

export function cents(value: number): string {
  return `$${(value / 100).toFixed(2)}`
}

export interface OrderSummary {
  id: string
  state: string
  restaurant: string
  budget_cents: number
  total_cents: number
  participant_count: number
  confirmed_count: number
  rain_card_id: string
  declined_at: string | null
  created_at: string
  updated_at: string
}

export interface CartItem {
  name: string
  price_cents: number
  quantity: number
}

export interface Participant {
  slack_user_id: string
  share_cents: number
  confirmed: boolean
  cart: CartItem[]
  cart_total_cents: number
}

export interface Snapshot {
  id: string
  state: string
  restaurant: string
  budget_cents: number
  total_cents: number
  timer_deadline: string | null
  grace_deadline: string | null
  created_at: string
  updated_at: string
  server_time: string
  participants: Participant[]
}

export const ACTIVE_STATES = ['OPEN', 'COLLECTING', 'GRACE', 'MINTING', 'SUBMITTING', 'DECLINED_PROOF_CAPTURED']
export const TERMINAL_STATES = ['CLOSED', 'CANCELLED', 'FAILED']
