import { useState, useEffect, useRef } from 'react'
import { getModeles, addModele, updateStatut, deleteModele, getComptes } from '../api'
import { Plus, Trash2, ChevronDown, ExternalLink } from 'lucide-react'

const STATUTS = {
  prospect: { label: 'Prospect', color: '#3b82f6', bg: 'rgba(59,130,246,0.12)'  },
  contacté: { label: 'Contacté', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)'  },
  en_cours: { label: 'En cours', color: '#8b5cf6', bg: 'rgba(139,92,246,0.12)'  },
  signé:    { label: 'Signé',    color: '#10b981', bg: 'rgba(16,185,129,0.12)'  },
  archivé:  { label: 'Archivé',  color: '#6b7280', bg: 'rgba(107,114,128,0.12)' },
}

function fmt(n) {
  if (!n) return '—'
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000)     return (n / 1_000).toFixed(0) + 'K'
  return String(n)
}

// ---------- Dropdown statut ----------
function StatusDropdown({ modeleId, statut, onChange }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const s   = STATUTS[statut] || { label: statut, color: '#8888aa', bg: '#1a1a2e' }

  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 5,
          padding: '3px 10px', borderRadius: 20, border: 'none', cursor: 'pointer',
          background: s.bg, color: s.color, fontSize: 11, fontWeight: 500,
        }}
      >
        {s.label} <ChevronDown size={10} />
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: '110%', left: 0, zIndex: 100,
          background: '#17172a', border: '1px solid #1e1e32', borderRadius: 10,
          overflow: 'hidden', minWidth: 130, boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
        }}>
          {Object.entries(STATUTS).map(([key, { label, color }]) => (
            <button
              key={key}
              onClick={() => { onChange(modeleId, key); setOpen(false) }}
              style={{
                display: 'block', width: '100%', textAlign: 'left',
                padding: '8px 14px', background: 'transparent', border: 'none',
                cursor: 'pointer', fontSize: 12, color,
                borderLeft: key === statut ? `2px solid ${color}` : '2px solid transparent',
              }}
              onMouseEnter={e => e.currentTarget.style.background = '#1e1e32'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------- Modale ajout ----------
function AddModal({ comptes, onClose, onSave }) {
  const [form, setForm] = useState({
    username: '', followers: '', bio: '', lien: '', statut: 'prospect', compte_utilisé: '',
  })
  const [saving, setSaving] = useState(false)

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.username.trim()) return
    setSaving(true)
    await onSave({
      ...form,
      followers:      parseInt(form.followers) || 0,
      compte_utilisé: form.compte_utilisé ? parseInt(form.compte_utilisé) : null,
    })
    setSaving(false)
  }

  const inputStyle = {
    width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid #1e1e32',
    background: '#0d0d18', color: '#eeeef8', fontSize: 13, outline: 'none',
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)',
    }}>
      <div style={{
        background: '#12121e', border: '1px solid #1e1e32', borderRadius: 16,
        padding: '28px 28px', width: 440,
        boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
      }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, color: '#eeeef8', marginBottom: 22 }}>Nouveau modèle</h2>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input style={inputStyle} placeholder="@username Instagram *" value={form.username} onChange={set('username')} />
          <input style={inputStyle} type="number" placeholder="Nombre de followers" value={form.followers} onChange={set('followers')} />
          <input style={inputStyle} placeholder="Bio" value={form.bio} onChange={set('bio')} />
          <input style={inputStyle} placeholder="Lien Instagram (https://...)" value={form.lien} onChange={set('lien')} />

          <select style={inputStyle} value={form.statut} onChange={set('statut')}>
            {Object.entries(STATUTS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>

          {comptes.length > 0 && (
            <select style={inputStyle} value={form.compte_utilisé} onChange={set('compte_utilisé')}>
              <option value="">— Aucun compte assigné —</option>
              {comptes.map(c => <option key={c.id} value={c.id}>@{c.username}</option>)}
            </select>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button type="button" onClick={onClose} style={{
              flex: 1, padding: '10px', borderRadius: 8, border: '1px solid #1e1e32',
              background: 'transparent', color: '#8888aa', fontSize: 13, cursor: 'pointer',
            }}>
              Annuler
            </button>
            <button type="submit" disabled={saving || !form.username.trim()} style={{
              flex: 1, padding: '10px', borderRadius: 8, border: 'none',
              background: saving || !form.username.trim() ? '#3b1f6e' : '#7c3aed',
              color: 'white', fontSize: 13, fontWeight: 500, cursor: 'pointer',
            }}>
              {saving ? 'Enregistrement...' : 'Ajouter'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ---------- Page principale ----------
export default function Pipeline() {
  const [modeles, setModeles] = useState([])
  const [comptes, setComptes] = useState([])
  const [filter,  setFilter]  = useState('all')
  const [showAdd, setShowAdd] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    const [m, c] = await Promise.all([getModeles(), getComptes()])
    setModeles(m); setComptes(c); setLoading(false)
  }

  async function handleStatut(id, statut) {
    await updateStatut(id, statut)
    setModeles(ms => ms.map(m => m.id === id ? { ...m, statut } : m))
  }

  async function handleDelete(id) {
    if (!window.confirm('Supprimer ce modèle et tous ses messages ?')) return
    await deleteModele(id)
    setModeles(ms => ms.filter(m => m.id !== id))
  }

  async function handleAdd(data) {
    await addModele(data)
    await loadData()
    setShowAdd(false)
  }

  const filtered = filter === 'all' ? modeles : modeles.filter(m => m.statut === filter)

  const tabs = [
    { key: 'all', label: 'Tous', count: modeles.length },
    ...Object.entries(STATUTS).map(([k, v]) => ({ key: k, label: v.label, count: modeles.filter(m => m.statut === k).length, color: v.color })),
  ]

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#444466' }}>
      Chargement...
    </div>
  )

  return (
    <div style={{ height: '100%', overflowY: 'auto' }}>
      <div style={{ padding: '36px 40px' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 28 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: '#eeeef8', marginBottom: 4 }}>Pipeline</h1>
            <p style={{ fontSize: 13, color: '#666688' }}>
              {modeles.length} modèle{modeles.length !== 1 ? 's' : ''} · gérez vos prospects
            </p>
          </div>
          <button
            onClick={() => setShowAdd(true)}
            style={{
              display: 'flex', alignItems: 'center', gap: 7,
              padding: '9px 18px', borderRadius: 9, border: 'none', cursor: 'pointer',
              background: 'linear-gradient(135deg, #7c3aed, #5b21b6)',
              color: 'white', fontSize: 13, fontWeight: 500,
              boxShadow: '0 0 16px rgba(124,58,237,0.35)',
            }}
          >
            <Plus size={15} /> Nouveau modèle
          </button>
        </div>

        {/* Tabs */}
        <div style={{
          display: 'flex', gap: 4, padding: '5px',
          background: '#0d0d18', borderRadius: 10, width: 'fit-content',
          border: '1px solid #1a1a2e', marginBottom: 20,
        }}>
          {tabs.map(({ key, label, count, color }) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              style={{
                padding: '5px 14px', borderRadius: 7, border: 'none', cursor: 'pointer',
                background: filter === key ? '#1e1e32' : 'transparent',
                color: filter === key ? (color || '#eeeef8') : '#555577',
                fontSize: 12, fontWeight: filter === key ? 600 : 400,
              }}
            >
              {label} <span style={{ opacity: 0.6 }}>({count})</span>
            </button>
          ))}
        </div>

        {/* Table */}
        <div style={{ borderRadius: 14, border: '1px solid #1a1a2e', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#0d0d18' }}>
                {['Modèle', 'Followers', 'Statut', 'Compte utilisé', 'Date ajout', ''].map(h => (
                  <th key={h} style={{
                    textAlign: 'left', padding: '11px 16px',
                    fontSize: 10, fontWeight: 600, color: '#444466',
                    textTransform: 'uppercase', letterSpacing: '0.06em',
                    borderBottom: '1px solid #1a1a2e',
                  }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '48px 16px', fontSize: 13, color: '#444466' }}>
                    Aucun modèle dans cette catégorie
                  </td>
                </tr>
              ) : filtered.map((m) => {
                const compte = comptes.find(c => c.id === m.compte_utilisé)
                return (
                  <tr
                    key={m.id}
                    style={{ borderTop: '1px solid #1a1a2e', transition: 'background 0.1s' }}
                    onMouseEnter={e => e.currentTarget.style.background = '#0f0f1c'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    {/* Modèle */}
                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{
                          width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
                          background: 'linear-gradient(135deg, #1e1040, #2d1060)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 12, fontWeight: 700, color: '#a78bfa',
                        }}>
                          {m.username.replace('@', '').charAt(0).toUpperCase()}
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <p style={{ fontSize: 13, fontWeight: 500, color: '#eeeef8' }}>{m.username}</p>
                          {m.bio && (
                            <p style={{ fontSize: 11, color: '#444466', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 200 }}>
                              {m.bio}
                            </p>
                          )}
                        </div>
                        {m.lien && (
                          <a href={m.lien} target="_blank" rel="noreferrer"
                             style={{ color: '#444466', marginLeft: 2, flexShrink: 0 }}
                             onMouseEnter={e => e.currentTarget.style.color = '#7c3aed'}
                             onMouseLeave={e => e.currentTarget.style.color = '#444466'}>
                            <ExternalLink size={12} />
                          </a>
                        )}
                      </div>
                    </td>

                    {/* Followers */}
                    <td style={{ padding: '12px 16px', fontSize: 13, color: '#8888aa' }}>
                      {fmt(m.followers)}
                    </td>

                    {/* Statut */}
                    <td style={{ padding: '12px 16px' }}>
                      <StatusDropdown modeleId={m.id} statut={m.statut} onChange={handleStatut} />
                    </td>

                    {/* Compte */}
                    <td style={{ padding: '12px 16px', fontSize: 12, color: '#666688' }}>
                      {compte ? (
                        <span style={{
                          padding: '2px 8px', borderRadius: 4,
                          background: 'rgba(124,58,237,0.1)', color: '#a78bfa', fontSize: 11,
                        }}>
                          @{compte.username}
                        </span>
                      ) : (
                        <span style={{ color: '#2a2a40' }}>—</span>
                      )}
                    </td>

                    {/* Date */}
                    <td style={{ padding: '12px 16px', fontSize: 11, color: '#444466' }}>
                      {m.date_ajout}
                    </td>

                    {/* Actions */}
                    <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                      <button
                        onClick={() => handleDelete(m.id)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 6, borderRadius: 6, color: '#333355' }}
                        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(248,113,113,0.1)'; e.currentTarget.style.color = '#f87171' }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = '#333355' }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {showAdd && <AddModal comptes={comptes} onClose={() => setShowAdd(false)} onSave={handleAdd} />}
    </div>
  )
}
