import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import AdminPanel from './admin'
import PastOrders from './orders'
import CurrentOrder from './live'

function useHashRoute(): string {
  const [hash, setHash] = useState(window.location.hash)
  useEffect(() => {
    const onChange = () => setHash(window.location.hash)
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return hash
}

function App() {
  const hash = useHashRoute()
  let page = <CurrentOrder />
  let active = 'live'
  if (hash.startsWith('#/orders')) {
    page = <PastOrders />
    active = 'orders'
  } else if (hash.startsWith('#/admin')) {
    page = <AdminPanel />
    active = 'admin'
  }

  return (
    <>
      <header className="topbar">
        <svg className="mark" width="22" height="24" viewBox="0 0 112 120" aria-hidden="true">
          <path d="M56 6 C56 6 18 52 18 78 a38 38 0 0 0 76 0 C94 52 56 6 56 6 Z"
            fill="none" stroke="#16202B" strokeWidth="9" strokeLinejoin="round" />
          <path d="M35 78 L51 95 L85 55" fill="none" stroke="#B23A2E" strokeWidth="11" strokeLinecap="square" />
        </svg>
        <a className="brand" href="#/">RAIN CHECK</a>
        <nav>
          <a href="#/" className={active === 'live' ? 'active' : ''}>Live order</a>
          <a href="#/orders" className={active === 'orders' ? 'active' : ''}>Past orders</a>
          <a href="#/admin" className={active === 'admin' ? 'active' : ''}>Admin</a>
        </nav>
      </header>
      <main>{page}</main>
    </>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
