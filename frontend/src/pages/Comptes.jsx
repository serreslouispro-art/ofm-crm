import { useState, useEffect } from 'react'
import { getComptes, addCompte, toggleCompte, deleteCompte, getModeles, startCampaignAuto, getCampaignStatus, stopCampaign } from '../api'
import { Plus, Trash2, Power, Instagram, Eye, EyeOff, ShieldAlert, Zap, Loader } from 'lucide-react'

function fmtDate(dt) {
  if (!dt) return '—'
  return new Date(dt.replace(' ', 'T')).toLocaleDateString('fr-FR', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
}

function StatPill({ label, value, color = '#a78bfa' }) {
  return (
    <div style={{
      background: '#12121e', border: '1px solid #1a1a2e',
      borderRadius: 10, padding: '12px 18px', minWidth: 110,
    }}>
      <p style={{ fontSize: 22, fontWeight: 700, color, lineHeight: 1 }}>{value}</p>
      <p style={{ fontSize: 11, color: '#444466', marginTop: 4 }}>{label}</p>
    </div>
  )
}

function AddModal({ onClose, onAdded }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPw,   setShowPw]   = useState(false)
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    if (!username.trim() || !password.trim()) {
      setError('Username et mot de passe requis.')
      return
    }
    setLoading(true)
    setError('')
    try {
      await addCompte(username.trim().replace('@', ''), password.trim())
      onAdded()
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div style={{
        background: '#0d0d18', border: '1px solid #1a1a2e', borderRadius: 16,
        padding: 28, width: 380,
        boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 22 }}>
          <div style={{
            width: 34, height: 34, borderRadius: 10,
            background: 'linear-gradient(135deg, #7c3aed, #5b21b6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Instagram size={16} color="white" />
          </div>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: '#eeeef8' }}>
            Ajouter un compte Instagram
          </h2>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={{ display: 'block', fontSize: 11, color: '#555577', marginBottom: 6, fontWeight: 500 }}>
              Nom d'utilisateur
            </label>
            <div style={{ position: 'relative' }}>
              <span style={{
                position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
                fontSize: 13, color: '#444466',
              }}>@</span>
              <input
                autoFocus
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="mon_compte_ig"
                style={{
                  width: '100%', padding: '10px 12px 10px 26px',
                  borderRadius: 10, border: '1px solid #1a1a2e',
                  background: '#12121e', color: '#eeeef8', fontSize: 13,
                  outline: 'none', boxSizing: 'border-box',
                }}
              />
            </div>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 11, color: '#555577', marginBottom: 6, fontWeight: 500 }}>
              Mot de passe
            </label>
            <div style={{ position: 'relative' }}>
              <input
                type={showPw ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••••"
                style={{
                  width: '100%', padding: '10px 40px 10px 12px',
                  borderRadius: 10, border: '1px solid #1a1a2e',
                  background: '#12121e', color: '#eeeef8', fontSize: 13,
                  outline: 'none', boxSizing: 'border-box',
                }}
              />
              <button
                type="button"
                onClick={() => setShowPw(v => !v)}
                style={{
                  position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', cursor: 'pointer', padding: 2,
                  color: '#444466',
                }}
              >
                {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>

          <div style={{
            padding: '10px 12px', borderRadius: 8,
            background: 'rgba(251,191,36,0.05)', border: '1px solid rgba(251,191,36,0.15)',
            display: 'flex', gap: 8, alignItems: 'flex-start',
          }}>
            <ShieldAlert size={13} color="#f59e0b" style={{ flexShrink: 0, marginTop: 1 }} />
            <p style={{ fontSize: 11, color: '#7a6520', lineHeight: 1.5 }}>
              Les identifiants sont stockés localement en clair. Utilise un compte dédié au CRM, pas ton compte personnel.
            </p>
          </div>

          {error && (
            <p style={{ fontSize: 12, color: '#ef4444', background: 'rgba(239,68,68,0.08)', padding: '8px 12px', borderRadius: 8 }}>
              {error}
            </p>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                flex: 1, padding: '10px 0', borderRadius: 10,
                background: '#12121e', border: '1px solid #1a1a2e',
                color: '#555577', fontSize: 13, cursor: 'pointer',
              }}
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={loading}
              style={{
                flex: 2, padding: '10px 0', borderRadius: 10,
                background: loading ? '#1a1a2e' : 'linear-gradient(135deg, #7c3aed, #5b21b6)',
                border: 'none', color: 'white', fontSize: 13, fontWeight: 600,
                cursor: loading ? 'not-allowed' : 'pointer',
                boxShadow: loading ? 'none' : '0 0 16px rgba(124,58,237,0.3)',
              }}
            >
              {loading ? 'Ajout…' : 'Ajouter'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function ConfirmModal({ message, onConfirm, onClose }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 300,
      background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div style={{
        background: '#0d0d18', border: '1px solid #1a1a2e', borderRadius: 14,
        padding: 24, width: 320,
        boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
      }}>
        <p style={{ fontSize: 14, color: '#eeeef8', marginBottom: 20, lineHeight: 1.5 }}>{message}</p>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={onClose}
            style={{
              flex: 1, padding: '9px 0', borderRadius: 9,
              background: '#12121e', border: '1px solid #1a1a2e',
              color: '#555577', fontSize: 13, cursor: 'pointer',
            }}
          >
            Annuler
          </button>
          <button
            onClick={onConfirm}
            style={{
              flex: 1, padding: '9px 0', borderRadius: 9,
              background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.25)',
              color: '#ef4444', fontSize: 13, fontWeight: 600, cursor: 'pointer',
            }}
          >
            Supprimer
          </button>
        </div>
      </div>
    </div>
  )
}

export default function Comptes() {
  const [comptes,   setComptes]   = useState([])
  const [modeles,   setModeles]   = useState([])
  const [loading,   setLoading]   = useState(true)
  const [showAdd,   setShowAdd]   = useState(false)
  const [confirmId, setConfirmId] = useState(null)
  const [cibles,    setCibles]    = useState({})
  const [autoState, setAutoState] = useState({})
  const [delais,    setDelais]       = useState({})
  const [filtres,   setFiltres]      = useState({})
  const [showFiltres, setShowFiltres] = useState({})

  function getF(id, key, def) { return filtres[id]?.[key] ?? def }
  function setF(id, key, val) { setFiltres(p => ({ ...p, [id]: { ...p[id], [key]: val } })) }

  async function handleAuto(compteId) {
    const target = (cibles[compteId] || '').trim().replace('@', '')
    if (!target) { alert('Renseigne un compte cible'); return }
    setAutoState(prev => ({ ...prev, [compteId]: { running: true, log: [], result: null } }))
    try {
      const delai = delais[compteId] || 45
      await startCampaignAuto({
        account_id: compteId, target,
        scrape_limit: parseInt(getF(compteId, 'scrape_limit', 200)),
        limit: parseInt(getF(compteId, 'limit', 50)),
        dms_per_day: parseInt(getF(compteId, 'dms', 40)),
        delay_session_min: delai,
        delay_session_max: Math.round(delai * 2.5),
        min_followers: parseInt(getF(compteId, 'minF', 0)) || 0,
        max_followers: parseInt(getF(compteId, 'maxF', '')) || null,
        bio_keywords: (getF(compteId, 'keywords', '')).split(',').map(k => k.trim()).filter(Boolean),
        require_external_link: getF(compteId, 'lien', false),
        genre: getF(compteId, 'genre', 'tous'),
      })
      const poll = async () => {
        const s = await getCampaignStatus()
        setAutoState(prev => ({ ...prev, [compteId]: { ...prev[compteId], running: s.running, log: s.log || [] } }))
        if (s.running) setTimeout(poll, 2500)
        else setAutoState(prev => ({ ...prev, [compteId]: { running: false, log: s.log || [], result: s.result } }))
      }
      poll()
    } catch(e) {
      setAutoState(prev => ({ ...prev, [compteId]: { running: false, log: [], result: { error: e.message } } }))
    }
  }

  async function load() {
    const [c, m] = await Promise.all([getComptes(), getModeles()])
    setComptes(c)
    setModeles(m)
  }

  useEffect(() => {
    load().finally(() => setLoading(false))
  }, [])

  async function handleToggle(id, current) {
    await toggleCompte(id, !current)
    setComptes(prev => prev.map(c => c.id === id ? { ...c, actif: current ? 0 : 1 } : c))
  }

  async function handleDelete(id) {
    await deleteCompte(id)
    setComptes(prev => prev.filter(c => c.id !== id))
    setConfirmId(null)
  }

  // Nombre de modèles par compte (via compte_utilisé)
  function modelesForCompte(compteId) {
    return modeles.filter(m => m.compte_utilisé === compteId).length
  }

  const totalActifs  = comptes.filter(c => c.actif).length
  const totalInactifs = comptes.length - totalActifs
  const totalModeles = modeles.length

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '28px 32px' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: '#eeeef8', marginBottom: 4 }}>
            Comptes Instagram
          </h1>
          <p style={{ fontSize: 13, color: '#444466' }}>
            Comptes utilisés pour le scraping et l'envoi de DMs
          </p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          style={{
            display: 'flex', alignItems: 'center', gap: 7,
            padding: '9px 16px', borderRadius: 10, border: 'none',
            background: 'linear-gradient(135deg, #7c3aed, #5b21b6)',
            color: 'white', fontSize: 13, fontWeight: 600, cursor: 'pointer',
            boxShadow: '0 0 16px rgba(124,58,237,0.35)',
          }}
        >
          <Plus size={15} />
          Ajouter un compte
        </button>
      </div>

      {/* Stats */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 28 }}>
        <StatPill label="Comptes total"   value={comptes.length} color="#a78bfa" />
        <StatPill label="Actifs"          value={totalActifs}    color="#10b981" />
        <StatPill label="Désactivés"      value={totalInactifs}  color="#6b7280" />
        <StatPill label="Modèles gérés"   value={totalModeles}   color="#f59e0b" />
      </div>

      {/* Table */}
      {loading ? (
        <p style={{ fontSize: 13, color: '#444466', marginTop: 40, textAlign: 'center' }}>Chargement…</p>
      ) : comptes.length === 0 ? (
        <div style={{
          textAlign: 'center', padding: '60px 0',
          border: '1px dashed #1a1a2e', borderRadius: 16,
        }}>
          <div style={{
            width: 48, height: 48, borderRadius: '50%',
            background: '#12121e', display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 14px',
          }}>
            <Instagram size={20} color="#333355" />
          </div>
          <p style={{ fontSize: 14, color: '#555577', fontWeight: 500, marginBottom: 6 }}>Aucun compte</p>
          <p style={{ fontSize: 12, color: '#333355' }}>Ajoutez un compte Instagram pour commencer</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {comptes.map(compte => {
            const isActif  = Boolean(compte.actif)
            const nbModeles = modelesForCompte(compte.id)
            return (
              <div
                key={compte.id}
                style={{
                  background: '#0d0d18',
                  border: `1px solid ${isActif ? '#1e1e36' : '#14141e'}`,
                  borderRadius: 14,
                  padding: '16px 20px',
                  display: 'flex', alignItems: 'center', gap: 16,
                  opacity: isActif ? 1 : 0.6,
                  transition: 'opacity 0.2s',
                }}
              >
                {/* Avatar */}
                <div style={{
                  width: 44, height: 44, borderRadius: 12, flexShrink: 0,
                  background: isActif
                    ? 'linear-gradient(135deg, #7c3aed22, #5b21b622)'
                    : '#111122',
                  border: `1px solid ${isActif ? '#7c3aed44' : '#1a1a2e'}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <Instagram size={18} color={isActif ? '#a78bfa' : '#333355'} />
                </div>

                {/* Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <p style={{ fontSize: 14, fontWeight: 600, color: '#eeeef8' }}>
                      @{compte.username}
                    </p>
                    <span style={{
                      padding: '2px 8px', borderRadius: 20, fontSize: 10, fontWeight: 600,
                      background: isActif ? 'rgba(16,185,129,0.12)' : 'rgba(107,114,128,0.12)',
                      color: isActif ? '#10b981' : '#6b7280',
                    }}>
                      {isActif ? 'Actif' : 'Désactivé'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 16 }}>
                    <span style={{ fontSize: 11, color: '#444466' }}>
                      ID #{compte.id}
                    </span>
                    <span style={{ fontSize: 11, color: '#444466' }}>
                      {nbModeles} modèle{nbModeles !== 1 ? 's' : ''} associé{nbModeles !== 1 ? 's' : ''}
                    </span>
                  </div>
                </div>

                {/* Password (masked) */}
                <div style={{
                  padding: '6px 14px', borderRadius: 8,
                  background: '#12121e', border: '1px solid #1a1a2e',
                  minWidth: 120,
                }}>
                  <p style={{ fontSize: 10, color: '#333355', marginBottom: 2 }}>Mot de passe</p>
                  <p style={{ fontSize: 12, color: '#555577', letterSpacing: '0.15em' }}>
                    {'•'.repeat(Math.min(compte.password?.length || 8, 10))}
                  </p>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 260 }}>
                  <div style={{ position: 'relative', flex: 1 }}>
                    <span style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', fontSize: 12, color: '#444466' }}>@</span>
                    <input
                      value={cibles[compte.id] || ''}
                      onChange={e => setCibles(prev => ({ ...prev, [compte.id]: e.target.value }))}
                      placeholder="compte a scraper"
                      style={{ width: '100%', padding: '7px 10px 7px 22px', borderRadius: 8, border: '1px solid #1a1a2e', background: '#12121e', color: '#eeeef8', fontSize: 12, outline: 'none', boxSizing: 'border-box' }}
                    />
                  </div>
                  <button
                    onClick={() => handleAuto(compte.id)}
                    disabled={autoState[compte.id]?.running}
                    style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '7px 12px', borderRadius: 8, border: 'none', background: autoState[compte.id]?.running ? '#1a1a2e' : 'linear-gradient(135deg, #7c3aed, #5b21b6)', color: 'white', fontSize: 11, fontWeight: 600, cursor: autoState[compte.id]?.running ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap' }}
                  >
                    {autoState[compte.id]?.running
                      ? <><Loader size={11} style={{ display: 'inline-block' }} /> En cours…</>
                      : <><Zap size={11} /> Lancer auto</>}
                  </button>
                  {autoState[compte.id]?.running && (
                    <button
                      onClick={async () => { await stopCampaign(); setAutoState(prev => ({ ...prev, [compte.id]: { running: false, log: [], result: null } })) }}
                      style={{ padding: '7px 10px', borderRadius: 8, border: 'none', background: 'rgba(239,68,68,0.15)', color: '#ef4444', fontSize: 11, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}
                    >
                      ✕ Stop
                    </button>
                  )}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 140 }}>
                    <span style={{ fontSize: 10, color: '#444466', whiteSpace: 'nowrap' }}>⏱ {delais[compte.id] || 45}min</span>
                    <input
                      type="range" min={1} max={90} step={1}
                      value={delais[compte.id] || 45}
                      onChange={e => setDelais(prev => ({ ...prev, [compte.id]: parseInt(e.target.value) }))}
                      style={{ width: 80, accentColor: '#7c3aed' }}
                    />
                  </div>
                  <button
                    onClick={() => setShowFiltres(p => ({ ...p, [compte.id]: !p[compte.id] }))}
                    style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid #1a1a2e', background: showFiltres[compte.id] ? 'rgba(124,58,237,0.15)' : '#12121e', color: showFiltres[compte.id] ? '#a78bfa' : '#666688', fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap' }}
                  >⚙ Filtres</button>
                </div>

                {showFiltres[compte.id] && (
                  <div style={{ marginTop: 10, padding: '14px 16px', borderRadius: 10, background: '#0a0a14', border: '1px solid #1a1a2e', display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <span style={{ fontSize: 10, color: '#444466' }}>Followers min</span>
                      <input type="number" placeholder="0" value={getF(compte.id,'minF','')} onChange={e => setF(compte.id,'minF',e.target.value)} style={{ padding: '5px 8px', borderRadius: 6, border: '1px solid #1a1a2e', background: '#12121e', color: '#eeeef8', fontSize: 12, width: 80, outline: 'none' }} />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <span style={{ fontSize: 10, color: '#444466' }}>Followers max</span>
                      <input type="number" placeholder="∞" value={getF(compte.id,'maxF','')} onChange={e => setF(compte.id,'maxF',e.target.value)} style={{ padding: '5px 8px', borderRadius: 6, border: '1px solid #1a1a2e', background: '#12121e', color: '#eeeef8', fontSize: 12, width: 80, outline: 'none' }} />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <span style={{ fontSize: 10, color: '#444466' }}>Mots-clés bio (virgule)</span>
                      <input placeholder="onlyfans, model..." value={getF(compte.id,'keywords','')} onChange={e => setF(compte.id,'keywords',e.target.value)} style={{ padding: '5px 8px', borderRadius: 6, border: '1px solid #1a1a2e', background: '#12121e', color: '#eeeef8', fontSize: 12, width: 160, outline: 'none' }} />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <span style={{ fontSize: 10, color: '#444466' }}>Profils à scraper</span>
                      <input type="number" placeholder="50" value={getF(compte.id,'limit',50)} onChange={e => setF(compte.id,'limit',e.target.value)} style={{ padding: '5px 8px', borderRadius: 6, border: '1px solid #1a1a2e', background: '#12121e', color: '#eeeef8', fontSize: 12, width: 70, outline: 'none' }} />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <span style={{ fontSize: 10, color: '#444466' }}>Scraper bruts</span>
                      <input type="number" placeholder="200" value={getF(compte.id,'scrape_limit',200)} onChange={e => setF(compte.id,'scrape_limit',e.target.value)} style={{ padding: '5px 8px', borderRadius: 6, border: '1px solid #1a1a2e', background: '#12121e', color: '#eeeef8', fontSize: 12, width: 70, outline: 'none' }} />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <span style={{ fontSize: 10, color: '#444466' }}>DMs/jour</span>
                      <input type="number" value={getF(compte.id,'dms',40)} onChange={e => setF(compte.id,'dms',e.target.value)} style={{ padding: '5px 8px', borderRadius: 6, border: '1px solid #1a1a2e', background: '#12121e', color: '#eeeef8', fontSize: 12, width: 60, outline: 'none' }} />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <span style={{ fontSize: 10, color: '#444466' }}>Genre cible (IA)</span>
                      <select value={getF(compte.id,'genre','tous')} onChange={e => setF(compte.id,'genre',e.target.value)} style={{ padding: '5px 8px', borderRadius: 6, border: '1px solid #1a1a2e', background: '#12121e', color: '#eeeef8', fontSize: 12, outline: 'none' }}>
                        <option value="tous">Tous</option>
                        <option value="femme">Femmes uniquement</option>
                        <option value="homme">Hommes uniquement</option>
                      </select>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <span style={{ fontSize: 10, color: '#444466' }}>Source</span>
                      <select value={getF(compte.id,'source','following')} onChange={e => setF(compte.id,'source',e.target.value)} style={{ padding: '5px 8px', borderRadius: 6, border: '1px solid #1a1a2e', background: '#12121e', color: '#eeeef8', fontSize: 12, outline: 'none' }}>
                        <option value="following">Abonnements</option>
                        <option value="followers">Abonnés</option>
                      </select>
                    </div>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', marginBottom: 2 }}>
                      <input type="checkbox" checked={getF(compte.id,'lien',false)} onChange={e => setF(compte.id,'lien',e.target.checked)} style={{ accentColor: '#7c3aed' }} />
                      <span style={{ fontSize: 11, color: '#666688' }}>Lien externe requis</span>
                    </label>
                  </div>
                )}

                {/* Actions */}
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    onClick={() => handleToggle(compte.id, isActif)}
                    title={isActif ? 'Désactiver' : 'Activer'}
                    style={{
                      width: 36, height: 36, borderRadius: 9,
                      border: '1px solid #1a1a2e',
                      background: isActif ? 'rgba(16,185,129,0.1)' : '#12121e',
                      cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      transition: 'all 0.15s',
                    }}
                  >
                    <Power size={14} color={isActif ? '#10b981' : '#444466'} />
                  </button>
                  <button
                    onClick={() => setConfirmId(compte.id)}
                    title="Supprimer"
                    style={{
                      width: 36, height: 36, borderRadius: 9,
                      border: '1px solid #1a1a2e',
                      background: '#12121e',
                      cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      transition: 'all 0.15s',
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.background = 'rgba(239,68,68,0.1)'
                      e.currentTarget.style.borderColor = 'rgba(239,68,68,0.2)'
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.background = '#12121e'
                      e.currentTarget.style.borderColor = '#1a1a2e'
                    }}
                  >
                    <Trash2 size={14} color="#444466" />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Modals */}
      {showAdd && (
        <AddModal
          onClose={() => setShowAdd(false)}
          onAdded={load}
        />
      )}
      {confirmId !== null && (
        <ConfirmModal
          message={`Supprimer le compte @${comptes.find(c => c.id === confirmId)?.username} ? Cette action est irréversible.`}
          onConfirm={() => handleDelete(confirmId)}
          onClose={() => setConfirmId(null)}
        />
      )}
    </div>
  )



}