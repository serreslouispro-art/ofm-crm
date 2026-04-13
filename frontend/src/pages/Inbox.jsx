import { useState, useEffect, useRef } from 'react'
import { getModeles, getMessages, sendMessage, getInboxStatus, startInboxListener, stopInboxListener, getComptes } from '../api'
import { Send, ArrowUpRight, ArrowDownLeft, Search, Radio, Square, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react'

const STATUS_COLOR = {
  prospect: '#3b82f6',
  contacté: '#f59e0b',
  en_cours: '#8b5cf6',
  signé:    '#10b981',
  archivé:  '#6b7280',
}

function fmt(n) {
  if (!n) return '0'
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000)     return (n / 1_000).toFixed(0) + 'K'
  return String(n)
}

function fmtTime(dt) {
  if (!dt) return ''
  const d = new Date(dt.replace(' ', 'T'))
  return d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function Avatar({ username, size = 36, fontSize = 13 }) {
  const letter = username.replace('@', '').charAt(0).toUpperCase()
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      background: 'linear-gradient(135deg, #1e1040, #2d1060)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize, fontWeight: 700, color: '#a78bfa',
    }}>
      {letter}
    </div>
  )
}

// Listener status badge
function ListenerBadge({ status, onStart, onStop, comptes }) {
  const [open, setOpen]         = useState(false)
  const [accountId, setAccountId] = useState('')
  const [headless, setHeadless]  = useState(true)
  const [starting, setStarting]  = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    function onClick(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  const isRunning  = status?.running
  const isStopping = status?.stopping
  const lastCheck  = status?.last_check
    ? new Date(status.last_check).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
    : null

  async function handleStart() {
    setStarting(true)
    try { await onStart({ account_id: accountId ? Number(accountId) : undefined, headless }) }
    catch { /* handled by parent */ }
    setStarting(false)
    setOpen(false)
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        title="Contrôle du listener DM"
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '5px 10px', borderRadius: 8, border: '1px solid #1a1a2e',
          background: isRunning ? 'rgba(16,185,129,0.1)' : '#12121e',
          color: isRunning ? '#10b981' : '#555577',
          fontSize: 11, fontWeight: 500, cursor: 'pointer',
        }}
      >
        <Radio size={11} />
        {isStopping ? 'Arrêt…' : isRunning ? 'Listener actif' : 'Listener'}
        {lastCheck && isRunning && <span style={{ color: '#333355' }}>· {lastCheck}</span>}
        {open ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 100,
          background: '#12121e', border: '1px solid #1a1a2e', borderRadius: 10,
          padding: 14, width: 240,
          boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
        }}>
          {isRunning ? (
            <>
              <p style={{ fontSize: 12, color: '#a78bfa', fontWeight: 600, marginBottom: 8 }}>
                Listener en cours
              </p>
              {status?.stats && (
                <p style={{ fontSize: 11, color: '#555577', marginBottom: 10 }}>
                  Dernière passe : {status.stats.checked} conv. vérifiées,{' '}
                  {status.stats.new_messages} nouveau(x) msg
                </p>
              )}
              <button
                onClick={onStop}
                style={{
                  width: '100%', padding: '7px 0', borderRadius: 8,
                  background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.2)',
                  color: '#ef4444', fontSize: 12, fontWeight: 500, cursor: 'pointer',
                }}
              >
                Arrêter
              </button>
            </>
          ) : (
            <>
              <p style={{ fontSize: 12, color: '#eeeef8', fontWeight: 600, marginBottom: 10 }}>
                Démarrer le listener
              </p>

              <label style={{ display: 'block', fontSize: 11, color: '#555577', marginBottom: 4 }}>
                Compte Instagram
              </label>
              <select
                value={accountId}
                onChange={e => setAccountId(e.target.value)}
                style={{
                  width: '100%', padding: '6px 8px', borderRadius: 6,
                  border: '1px solid #1a1a2e', background: '#0d0d18',
                  color: '#eeeef8', fontSize: 12, marginBottom: 10, outline: 'none',
                }}
              >
                <option value="">Premier compte disponible</option>
                {(comptes || []).map(c => (
                  <option key={c.id} value={c.id}>@{c.username}</option>
                ))}
              </select>

              <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={headless}
                  onChange={e => setHeadless(e.target.checked)}
                  style={{ accentColor: '#7c3aed' }}
                />
                <span style={{ fontSize: 11, color: '#555577' }}>Mode headless</span>
              </label>

              <button
                onClick={handleStart}
                disabled={starting}
                style={{
                  width: '100%', padding: '7px 0', borderRadius: 8,
                  background: starting ? '#1a1a2e' : 'linear-gradient(135deg, #7c3aed, #5b21b6)',
                  border: 'none', color: 'white', fontSize: 12, fontWeight: 500,
                  cursor: starting ? 'not-allowed' : 'pointer',
                }}
              >
                {starting ? 'Démarrage…' : 'Démarrer (toutes les 5 min)'}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// Mini log panel
function ListenerLog({ log }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (open && ref.current) {
      ref.current.scrollTop = ref.current.scrollHeight
    }
  }, [log, open])

  if (!log?.length) return null

  return (
    <div style={{ marginTop: 8 }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          background: 'none', border: 'none', cursor: 'pointer',
          fontSize: 11, color: '#444466', display: 'flex', alignItems: 'center', gap: 4,
        }}
      >
        {open ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
        {open ? 'Masquer les logs' : `Voir les logs (${log.length})`}
      </button>
      {open && (
        <div
          ref={ref}
          style={{
            marginTop: 6, maxHeight: 160, overflowY: 'auto',
            background: '#08080f', borderRadius: 6, padding: '8px 10px',
            fontFamily: 'monospace', fontSize: 10, color: '#555577',
            lineHeight: 1.6,
          }}
        >
          {log.map((l, i) => <div key={i}>{l}</div>)}
        </div>
      )}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────────

export default function Inbox() {
  const [modeles,        setModeles]        = useState([])
  const [selected,       setSelected]       = useState(null)
  const [messages,       setMessages]       = useState([])
  const [text,           setText]           = useState('')
  const [direction,      setDirection]      = useState('sortant')
  const [sending,        setSending]        = useState(false)
  const [igError,        setIgError]        = useState(null)
  const [search,         setSearch]         = useState('')
  const [loading,        setLoading]        = useState(true)
  const [comptes,        setComptes]        = useState([])
  const [listenerStatus, setListenerStatus] = useState(null)
  const [unread,         setUnread]         = useState({})   // { modeleId: count }
  const bottomRef  = useRef(null)
  const selectedRef = useRef(null)

  // Keep selectedRef in sync so polling closure stays fresh
  selectedRef.current = selected

  // ── Initial load ────────────────────────────────────────────────────────────
  useEffect(() => {
    Promise.all([getModeles(), getComptes()])
      .then(([mods, comps]) => {
        setModeles(mods)
        setComptes(comps)
      })
      .finally(() => setLoading(false))
  }, [])

  // ── Poll listener status every 10s ──────────────────────────────────────────
  useEffect(() => {
    let live = true
    async function poll() {
      try {
        const s = await getInboxStatus()
        if (live) setListenerStatus(s)
      } catch { /* backend peut ne pas être lancé */ }
      if (live) setTimeout(poll, 10_000)
    }
    poll()
    return () => { live = false }
  }, [])

  // ── Load messages when selecting a conversation ──────────────────────────────
  useEffect(() => {
    if (!selected) return
    setIgError(null)
    getMessages(selected.id).then(msgs => {
      setMessages(msgs)
      setUnread(u => ({ ...u, [selected.id]: 0 }))
    })
  }, [selected])

  // ── Real-time polling of open conversation (every 4s) ───────────────────────
  useEffect(() => {
    if (!selected) return
    let live = true
    async function poll() {
      if (!live) return
      try {
        const msgs = await getMessages(selectedRef.current.id)
        if (live) {
          setMessages(prev => {
            // Only update if something changed (avoid unnecessary re-renders)
            if (msgs.length !== prev.length) return msgs
            return prev
          })
        }
      } catch { /* ignore */ }
      if (live) setTimeout(poll, 4_000)
    }
    const t = setTimeout(poll, 4_000)
    return () => { live = false; clearTimeout(t) }
  }, [selected?.id])

  // ── Poll all conversations for unread badges (every 30s) ────────────────────
  useEffect(() => {
    if (!modeles.length) return
    let live = true

    async function pollUnread() {
      if (!live) return
      const counts = {}
      for (const m of modeles) {
        try {
          const msgs = await getMessages(m.id)
          const entrant = msgs.filter(x => x.direction === 'entrant').length
          counts[m.id] = entrant
        } catch { /* ignore */ }
      }
      if (live) {
        setUnread(prev => {
          // Compute new badges: show difference vs last known
          // Simple approach: show total entrant count as badge
          const next = {}
          for (const id in counts) {
            next[id] = counts[id]
          }
          return next
        })
      }
      if (live) setTimeout(pollUnread, 30_000)
    }
    pollUnread()
    return () => { live = false }
  }, [modeles.length])

  // ── Auto-scroll ──────────────────────────────────────────────────────────────
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // ── Send ────────────────────────────────────────────────────────────────────
  async function handleSend() {
    if (!text.trim() || !selected || sending) return
    setSending(true)
    setIgError(null)
    try {
      const result = await sendMessage(selected.id, text.trim(), direction)
      const msgs = await getMessages(selected.id)
      setMessages(msgs)
      setText('')
      if (direction === 'sortant' && result?.ig_sent === false) {
        setIgError(result.ig_error || 'DM non envoyé sur Instagram')
      }
    } finally {
      setSending(false)
    }
  }

  // ── Listener controls ───────────────────────────────────────────────────────
  async function handleStartListener(opts) {
    await startInboxListener(opts)
    const s = await getInboxStatus()
    setListenerStatus(s)
  }

  async function handleStopListener() {
    await stopInboxListener()
    const s = await getInboxStatus()
    setListenerStatus(s)
  }

  const filteredModeles = modeles.filter(m =>
    m.username.toLowerCase().includes(search.toLowerCase())
  )

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>

      {/* ===== Left panel ===== */}
      <div style={{
        width: 290, flexShrink: 0,
        background: '#0d0d18',
        borderRight: '1px solid #1a1a2e',
        display: 'flex', flexDirection: 'column',
        height: '100%',
      }}>
        {/* Header */}
        <div style={{ padding: '24px 18px 14px', borderBottom: '1px solid #1a1a2e' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <h1 style={{ fontSize: 16, fontWeight: 700, color: '#eeeef8' }}>Inbox</h1>
            <ListenerBadge
              status={listenerStatus}
              onStart={handleStartListener}
              onStop={handleStopListener}
              comptes={comptes}
            />
          </div>

          <div style={{ position: 'relative' }}>
            <Search size={13} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#444466', pointerEvents: 'none' }} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Rechercher un modèle..."
              style={{
                width: '100%', padding: '8px 10px 8px 30px',
                borderRadius: 8, border: '1px solid #1a1a2e',
                background: '#12121e', color: '#eeeef8', fontSize: 12, outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>

          {/* Listener log (collapsible) */}
          {listenerStatus && (
            <ListenerLog log={listenerStatus.log} />
          )}
        </div>

        {/* List */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loading ? (
            <p style={{ textAlign: 'center', marginTop: 32, fontSize: 12, color: '#444466' }}>Chargement...</p>
          ) : filteredModeles.length === 0 ? (
            <p style={{ textAlign: 'center', marginTop: 32, fontSize: 12, color: '#444466' }}>Aucun modèle</p>
          ) : filteredModeles.map(m => {
            const isActive  = selected?.id === m.id
            const entrantCount = unread[m.id] || 0
            return (
              <button
                key={m.id}
                onClick={() => setSelected(m)}
                style={{
                  width: '100%', textAlign: 'left',
                  padding: '12px 18px',
                  background: isActive ? 'rgba(124,58,237,0.1)' : 'transparent',
                  border: 'none',
                  borderLeft: isActive ? '2px solid #7c3aed' : '2px solid transparent',
                  borderBottom: '1px solid #1a1a2e',
                  cursor: 'pointer',
                  transition: 'all 0.1s',
                }}
                onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = '#0f0f1c' }}
                onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ position: 'relative' }}>
                    <Avatar username={m.username} />
                    {entrantCount > 0 && !isActive && (
                      <div style={{
                        position: 'absolute', top: -2, right: -2,
                        width: 14, height: 14, borderRadius: '50%',
                        background: '#7c3aed', border: '2px solid #0d0d18',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 8, fontWeight: 700, color: 'white',
                      }}>
                        {entrantCount > 9 ? '9+' : entrantCount}
                      </div>
                    )}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 }}>
                      <p style={{
                        fontSize: 13, fontWeight: entrantCount > 0 && !isActive ? 600 : 500,
                        color: isActive ? '#a78bfa' : entrantCount > 0 ? '#eeeef8' : '#ccccdd',
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 140,
                      }}>
                        {m.username}
                      </p>
                      <div style={{
                        width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                        background: STATUS_COLOR[m.statut] || '#444466',
                        boxShadow: `0 0 6px ${STATUS_COLOR[m.statut] || '#444466'}88`,
                      }} />
                    </div>
                    <p style={{ fontSize: 11, color: '#444466' }}>{fmt(m.followers)} followers</p>
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* ===== Right panel ===== */}
      {!selected ? (
        <div style={{
          flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexDirection: 'column', gap: 8,
        }}>
          <div style={{
            width: 52, height: 52, borderRadius: '50%',
            background: '#12121e', display: 'flex', alignItems: 'center', justifyContent: 'center',
            marginBottom: 8, border: '1px solid #1a1a2e',
          }}>
            <Send size={20} color="#333355" />
          </div>
          <p style={{ fontSize: 14, color: '#555577', fontWeight: 500 }}>Sélectionnez un modèle</p>
          <p style={{ fontSize: 12, color: '#333355' }}>pour accéder à la conversation</p>
          {listenerStatus?.running && (
            <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#10b981', animation: 'pulse 2s infinite' }} />
              <span style={{ fontSize: 11, color: '#10b981' }}>Listener actif — vérification des DMs toutes les 5 min</span>
            </div>
          )}
        </div>
      ) : (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

          {/* Conversation header */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '16px 24px', borderBottom: '1px solid #1a1a2e', flexShrink: 0,
          }}>
            <Avatar username={selected.username} size={38} />
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: 14, fontWeight: 600, color: '#eeeef8' }}>{selected.username}</p>
              <p style={{ fontSize: 11, color: '#555577' }}>
                {fmt(selected.followers)} followers
                {selected.lien && (
                  <> · <a href={selected.lien} target="_blank" rel="noreferrer" style={{ color: '#7c3aed' }}>Voir profil</a></>
                )}
              </p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{
                padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 500,
                background: `${STATUS_COLOR[selected.statut]}18`,
                color: STATUS_COLOR[selected.statut] || '#8888aa',
              }}>
                {selected.statut}
              </div>
              {/* Refresh button */}
              <button
                onClick={() => getMessages(selected.id).then(setMessages)}
                title="Rafraîchir les messages"
                style={{
                  width: 30, height: 30, borderRadius: 8,
                  background: '#12121e', border: '1px solid #1a1a2e',
                  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                <RefreshCw size={12} color="#444466" />
              </button>
            </div>
          </div>

          {/* Messages */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            {messages.length === 0 ? (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <p style={{ fontSize: 13, color: '#444466' }}>Aucun message — commencez la conversation</p>
              </div>
            ) : messages.map(msg => {
              const isSortant = msg.direction === 'sortant'
              return (
                <div key={msg.id} style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: isSortant ? 'flex-end' : 'flex-start',
                }}>
                  {!isSortant && (
                    <p style={{ fontSize: 10, color: '#333355', marginBottom: 4, marginLeft: 4 }}>
                      {selected.username}
                    </p>
                  )}
                  <div style={{
                    maxWidth: '65%',
                    padding: '10px 14px',
                    borderRadius: isSortant ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                    background: isSortant
                      ? 'linear-gradient(135deg, #5b21b6, #4c1d95)'
                      : '#17172a',
                    color: '#eeeef8',
                    fontSize: 13,
                    lineHeight: 1.5,
                    border: isSortant ? 'none' : '1px solid #1e1e32',
                    boxShadow: isSortant ? '0 2px 12px rgba(92,33,182,0.3)' : 'none',
                  }}>
                    {msg.contenu}
                  </div>
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 4,
                    marginTop: 4,
                  }}>
                    {isSortant
                      ? <ArrowUpRight size={10} color="#333355" />
                      : <ArrowDownLeft size={10} color="#333355" />}
                    <span style={{ fontSize: 10, color: '#333355' }}>{fmtTime(msg.date_envoi)}</span>
                  </div>
                </div>
              )
            })}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div style={{
            padding: '14px 24px 18px',
            borderTop: '1px solid #1a1a2e',
            flexShrink: 0,
          }}>
            {/* Direction toggle */}
            <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
              {[['sortant', 'Sortant (nous)', ArrowUpRight], ['entrant', 'Entrant (modèle)', ArrowDownLeft]].map(([val, label, Icon]) => (
                <button
                  key={val}
                  onClick={() => setDirection(val)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 5,
                    padding: '4px 12px', borderRadius: 6, border: 'none', cursor: 'pointer',
                    background: direction === val ? '#1e1e32' : 'transparent',
                    color: direction === val ? '#eeeef8' : '#444466',
                    fontSize: 11, fontWeight: direction === val ? 500 : 400,
                  }}
                >
                  <Icon size={11} />
                  {label}
                </button>
              ))}
            </div>

            {/* IG send error */}
            {igError && direction === 'sortant' && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '6px 10px', borderRadius: 6, marginBottom: 8,
                background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)',
              }}>
                <span style={{ fontSize: 11, color: '#f87171' }}>⚠ {igError}</span>
              </div>
            )}

            <div style={{ display: 'flex', gap: 8 }}>
              <input
                value={text}
                onChange={e => setText(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
                placeholder={direction === 'sortant' ? 'Écrire un message...' : 'Enregistrer la réponse reçue...'}
                style={{
                  flex: 1, padding: '11px 16px',
                  borderRadius: 12, border: '1px solid #1e1e32',
                  background: '#12121e', color: '#eeeef8', fontSize: 13, outline: 'none',
                }}
              />
              <button
                onClick={handleSend}
                disabled={!text.trim() || sending}
                style={{
                  width: 44, height: 44, borderRadius: 12, border: 'none', cursor: 'pointer',
                  background: text.trim() && !sending
                    ? 'linear-gradient(135deg, #7c3aed, #5b21b6)'
                    : '#1a1a2e',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                  boxShadow: text.trim() ? '0 0 12px rgba(124,58,237,0.4)' : 'none',
                  transition: 'all 0.2s',
                }}
              >
                <Send size={16} color={text.trim() && !sending ? 'white' : '#333355'} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
