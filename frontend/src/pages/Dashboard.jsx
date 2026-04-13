import { useEffect, useState } from 'react'
import { getModeles, getComptes } from '../api'
import { Users, TrendingUp, CheckCircle, Clock, Instagram } from 'lucide-react'

const STATUTS = {
  prospect: { label: 'Prospects',  color: '#3b82f6', bg: 'rgba(59,130,246,0.1)'  },
  contacté: { label: 'Contactés',  color: '#f59e0b', bg: 'rgba(245,158,11,0.1)'  },
  en_cours: { label: 'En cours',   color: '#8b5cf6', bg: 'rgba(139,92,246,0.1)'  },
  signé:    { label: 'Signés',     color: '#10b981', bg: 'rgba(16,185,129,0.1)'  },
  archivé:  { label: 'Archivés',   color: '#6b7280', bg: 'rgba(107,114,128,0.1)' },
}

function fmt(n) {
  if (!n) return '0'
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000)     return (n / 1_000).toFixed(0) + 'K'
  return String(n)
}

function StatCard({ label, value, icon: Icon, color, bg }) {
  return (
    <div style={{
      background: '#12121e',
      border: '1px solid #1a1a2e',
      borderRadius: 14,
      padding: '20px 22px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <span style={{ fontSize: 12, color: '#666688' }}>{label}</span>
        <div style={{ width: 36, height: 36, borderRadius: 10, background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon size={16} color={color} />
        </div>
      </div>
      <p style={{ fontSize: 30, fontWeight: 700, color: '#eeeef8', lineHeight: 1 }}>{value}</p>
    </div>
  )
}

export default function Dashboard() {
  const [modeles, setModeles] = useState([])
  const [comptes, setComptes] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([getModeles(), getComptes()])
      .then(([m, c]) => { setModeles(m); setComptes(c) })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  const count = (s) => modeles.filter(m => m.statut === s).length
  const total  = modeles.length
  const signés = count('signé')
  const taux   = total > 0 ? Math.round((signés / total) * 100) : 0

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#444466' }}>
      Chargement...
    </div>
  )

  return (
    <div style={{ height: '100%', overflowY: 'auto' }}>
      <div style={{ padding: '36px 40px', maxWidth: 1100 }}>

        {/* Header */}
        <div style={{ marginBottom: 32 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#eeeef8', marginBottom: 4 }}>Dashboard</h1>
          <p style={{ fontSize: 13, color: '#666688' }}>Vue d'ensemble de votre pipeline OFM</p>
        </div>

        {/* Stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 28 }}>
          <StatCard label="Total modèles"  value={total}           icon={Users}       color="#7c3aed" bg="rgba(124,58,237,0.12)" />
          <StatCard label="Prospects"      value={count('prospect')} icon={Clock}     color="#3b82f6" bg="rgba(59,130,246,0.12)" />
          <StatCard label="En cours"       value={count('en_cours')} icon={TrendingUp} color="#8b5cf6" bg="rgba(139,92,246,0.12)" />
          <StatCard label="Signés"         value={signés}           icon={CheckCircle} color="#10b981" bg="rgba(16,185,129,0.12)" />
        </div>

        {/* Main grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 20, marginBottom: 20 }}>

          {/* Pipeline bars */}
          <div style={{ background: '#12121e', border: '1px solid #1a1a2e', borderRadius: 14, padding: '22px 24px' }}>
            <p style={{ fontSize: 13, fontWeight: 600, color: '#eeeef8', marginBottom: 20 }}>Répartition du pipeline</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {Object.entries(STATUTS).map(([key, { label, color }]) => {
                const n   = count(key)
                const pct = total > 0 ? (n / total) * 100 : 0
                return (
                  <div key={key}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                      <span style={{ fontSize: 12, color: '#8888aa' }}>{label}</span>
                      <span style={{ fontSize: 12, fontWeight: 600, color }}>{n}</span>
                    </div>
                    <div style={{ height: 6, borderRadius: 3, background: '#1a1a2e' }}>
                      <div style={{
                        height: 6, borderRadius: 3,
                        width: `${pct}%`,
                        background: `linear-gradient(90deg, ${color}cc, ${color})`,
                        transition: 'width 0.6s ease',
                        boxShadow: pct > 0 ? `0 0 8px ${color}66` : 'none',
                      }} />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Right col */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Conversion */}
            <div style={{ background: '#12121e', border: '1px solid #1a1a2e', borderRadius: 14, padding: '22px 24px', flex: 1 }}>
              <p style={{ fontSize: 12, color: '#666688', marginBottom: 8 }}>Taux de conversion</p>
              <p style={{ fontSize: 42, fontWeight: 800, color: '#a78bfa', lineHeight: 1, marginBottom: 4 }}>{taux}%</p>
              <p style={{ fontSize: 11, color: '#444466' }}>{signés} signé{signés !== 1 ? 's' : ''} sur {total} modèles</p>
            </div>

            {/* Comptes */}
            <div style={{ background: '#12121e', border: '1px solid #1a1a2e', borderRadius: 14, padding: '22px 24px', flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <Instagram size={14} color="#666688" />
                <p style={{ fontSize: 12, color: '#666688' }}>Comptes Instagram</p>
              </div>
              <p style={{ fontSize: 30, fontWeight: 700, color: '#eeeef8', marginBottom: 10 }}>{comptes.length}</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {comptes.map(c => (
                  <span key={c.id} style={{
                    fontSize: 10, padding: '2px 8px', borderRadius: 4,
                    background: c.actif ? 'rgba(124,58,237,0.15)' : '#1a1a2e',
                    color: c.actif ? '#a78bfa' : '#444466',
                  }}>
                    @{c.username}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Recent models */}
        {modeles.length > 0 && (
          <div style={{ background: '#12121e', border: '1px solid #1a1a2e', borderRadius: 14, padding: '22px 24px' }}>
            <p style={{ fontSize: 13, fontWeight: 600, color: '#eeeef8', marginBottom: 16 }}>Modèles récents</p>
            <div>
              {modeles.slice(0, 6).map((m, i) => {
                const s = STATUTS[m.statut] || { label: m.statut, color: '#8888aa', bg: '#1a1a2e' }
                return (
                  <div key={m.id} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '10px 0',
                    borderTop: i > 0 ? '1px solid #1a1a2e' : 'none',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{
                        width: 34, height: 34, borderRadius: '50%',
                        background: 'linear-gradient(135deg, #1e1040, #2d1060)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 12, fontWeight: 700, color: '#a78bfa',
                        flexShrink: 0,
                      }}>
                        {m.username.replace('@', '').charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p style={{ fontSize: 13, fontWeight: 500, color: '#eeeef8' }}>{m.username}</p>
                        <p style={{ fontSize: 11, color: '#444466' }}>{fmt(m.followers)} followers · {m.date_ajout}</p>
                      </div>
                    </div>
                    <span style={{
                      fontSize: 11, padding: '3px 10px', borderRadius: 20,
                      background: s.bg, color: s.color, fontWeight: 500,
                    }}>
                      {s.label}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {modeles.length === 0 && (
          <div style={{
            border: '1px dashed #1e1e32', borderRadius: 14, padding: '48px 24px',
            textAlign: 'center', marginTop: 20,
          }}>
            <p style={{ fontSize: 14, color: '#555577', marginBottom: 6 }}>Aucun modèle pour l'instant</p>
            <p style={{ fontSize: 12, color: '#333355' }}>Ajoutez votre premier modèle depuis la page Pipeline</p>
          </div>
        )}
      </div>
    </div>
  )
}
