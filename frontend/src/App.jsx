import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Sidebar from './components/Sidebar'
import Dashboard from './pages/Dashboard'
import Prospection from './pages/Prospection'
import Pipeline from './pages/Pipeline'
import Inbox from './pages/Inbox'
import Comptes from './pages/Comptes'
import Templates from './pages/Templates'

export default function App() {
  return (
    <BrowserRouter>
      <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
        <Sidebar />
        <main style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <Routes>
            <Route path="/"            element={<Dashboard />} />
            <Route path="/prospection" element={<Prospection />} />
            <Route path="/pipeline"    element={<Pipeline />} />
            <Route path="/inbox"       element={<Inbox />} />
            <Route path="/comptes"     element={<Comptes />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}
