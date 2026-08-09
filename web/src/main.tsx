import { createRoot } from 'react-dom/client'
import './styles.css'

function App() {
  const orchestratorUrl = import.meta.env.VITE_ORCHESTRATOR_URL

  return (
    <main>
      <p className="eyebrow">Group Grub</p>
      <h1>Group food ordering, coordinated in Slack.</h1>
      <p className="summary">
        The ordering dashboard is being prepared. Live group orders, participant carts,
        and decline-proof receipts will appear here.
      </p>
      <p className="status">
        Orchestrator: {orchestratorUrl ? 'connected' : 'not configured'}
      </p>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
