import { NavLink } from 'react-router-dom'
import { LayoutDashboard, GitFork, MessageSquare, Zap, Crosshair, Users } from 'lucide-react'

const NAV = [
  { to: '/',            label: 'Dashboard',   icon: LayoutDashboard },
  { to: '/prospection', label: 'Prospection', icon: Crosshair },
  { to: '/pipeline',    label: 'Pipeline',    icon: GitFork },
  { to: '/inbox',       label: 'Inbox',       icon: MessageSquare },
  { to: '/comptes',     label: 'Comptes',     icon: Users },
]

export default function Sidebar() {
  return (
    <aside
      style={{
        width: 220,
        flexShrink: 0,
        background: '#0d0d18',
        borderRight: '1px solid #1a1a2e',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
      }}
    >
      {/* Brand */}
      <div style={{ padding: '20px 20px 16px', borderBottom: '1px solid #1a1a2e' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8,
            background: 'linear-gradient(135deg, #7c3aed, #5b21b6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 0 16px rgba(124,58,237,0.4)',
          }}>
            <Zap size={15} color="white" fill="white" />
          </div>
          <div>
            <p style={{ color: '#eeeef8', fontSize: 13, fontWeight: 600, lineHeight: 1.2 }}>OFM CRM</p>
            <p style={{ color: '#555577', fontSize: 10, lineHeight: 1.2 }}>Instagram Manager</p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: '12px 10px', display: 'flex', flexDirection: 'column', gap: 2 }}>
        <p style={{ color: '#333355', fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', padding: '4px 10px 8px', textTransform: 'uppercase' }}>
          Navigation
        </p>
        {NAV.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            style={({ isActive }) => ({
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '8px 10px',
              borderRadius: 8,
              textDecoration: 'none',
              fontSize: 13,
              fontWeight: isActive ? 500 : 400,
              background: isActive ? 'rgba(124,58,237,0.15)' : 'transparent',
              color: isActive ? '#a78bfa' : '#666688',
              transition: 'all 0.15s',
              borderLeft: isActive ? '2px solid #7c3aed' : '2px solid transparent',
            })}
          >
            <Icon size={15} />
            {label}
          </NavLink>
        ))}
      </nav>

      {/* Footer */}
      <div style={{ padding: '12px 20px', borderTop: '1px solid #1a1a2e' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 28, height: 28, borderRadius: '50%',
            background: '#1e1040', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: '#a78bfa' }}>OF</span>
          </div>
          <div>
            <p style={{ fontSize: 11, color: '#8888aa', fontWeight: 500 }}>Admin</p>
            <p style={{ fontSize: 10, color: '#333355' }}>OFM Manager</p>
          </div>
        </div>
      </div>
    </aside>
  )
}
