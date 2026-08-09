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
        <span className="brand">Group Grub</span>
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
