import { useState, useEffect, useRef } from 'react'
import {
  Search, X, Link, Link2Off, ChevronRight,
  Send, Loader, CheckSquare, Square, AlertTriangle,
  Crosshair, Users, Filter, Zap,
} from 'lucide-react'
import {
  getModeles, getComptes,
  startScrape, getScrapeStatus,
  startCampaign, getCampaignStatus,
} from '../api'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_TEMPLATE =
  `Bonjour {username} ! Notre agence OFM a repéré ton profil et on pense vraiment pouvoir t'aider à développer ton activité. On gère tout le côté business pour toi. Tu seras intéressée pour qu'on en discute ?`

function fmt(n) {
  if (!n && n !== 0) return '—'
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000)     return (n / 1_000).toFixed(0) + 'K'
  return String(n)
}

const STATUS_COLOR = {
  prospect: '#3b82f6',
  contacté: '#f59e0b',
  en_cours: '#8b5cf6',
  signé:    '#10b981',
  archivé:  '#6b7280',
}

const C = {
  bg:      '#08080e',
  surf:    '#0d0d18',
  card:    '#12121e',
  card2:   '#161622',
  border:  '#1a1a2e',
  accent:  '#7c3aed',
  accentL: '#a78bfa',
  accentD: '#4c1d95',
  text:    '#eeeef8',
  muted:   '#666688',
  dim:     '#333355',
  green:   '#10b981',
  amber:   '#f59e0b',
  red:     '#f87171',
}

const inputStyle = {
  width: '100%', padding: '8px 11px', borderRadius: 8,
  border: `1px solid ${C.border}`, background: C.surf,
  color: C.text, fontSize: 13, outline: 'none',
}

const labelStyle = { fontSize: 11, color: C.muted, marginBottom: 5, display: 'block', fontWeight: 500 }

// ---------------------------------------------------------------------------
// TagInput
// ---------------------------------------------------------------------------

function TagInput({ tags, onChange }) {
  const [val, setVal] = useState('')

  function add() {
    const t = val.trim().toLowerCase()
    if (t && !tags.includes(t)) onChange([...tags, t])
    setVal('')
  }

  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, background: C.surf, padding: '6px 8px' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: tags.length ? 6 : 0 }}>
        {tags.map(t => (
          <span key={t} style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 500,
            background: 'rgba(124,58,237,0.15)', color: C.accentL,
          }}>
            {t}
            <button onClick={() => onChange(tags.filter(x => x !== t))}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.dim, padding: 0, lineHeight: 1 }}>
              <X size={10} />
            </button>
          </span>
        ))}
      </div>
      <input
        value={val}
        onChange={e => setVal(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
        placeholder="Taper un mot-clé + Entrée"
        style={{ ...inputStyle, padding: '4px 6px', border: 'none', background: 'transparent', fontSize: 12 }}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// LiveLog
// ---------------------------------------------------------------------------

function LiveLog({ lines, empty, accent }) {
  const ref = useRef(null)
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight
  }, [lines])

  return (
    <div ref={ref} style={{
      height: 160, overflowY: 'auto', borderRadius: 8,
      background: '#07070d', border: `1px solid ${C.border}`,
      padding: '10px 12px', fontFamily: 'monospace', fontSize: 11,
    }}>
      {lines.length === 0
        ? <p style={{ color: C.dim, fontStyle: 'italic' }}>{empty || 'En attente…'}</p>
        : lines.map((l, i) => (
          <p key={i} style={{
            color: l.includes('AJOUTÉ') || l.includes('envoyé') ? C.green
              : l.includes('ARRÊT') || l.includes('SUSPECTE') || l.includes('error') ? C.red
              : l.includes('filtré') || l.includes('ignoré') ? C.dim
              : accent || '#8888bb',
            marginBottom: 2,
          }}>
            {l}
          </p>
        ))
      }
    </div>
  )
}

// ---------------------------------------------------------------------------
// StatPill
// ---------------------------------------------------------------------------

function StatPill({ label, value, color }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      padding: '10px 16px', borderRadius: 10,
      background: `${color}12`, border: `1px solid ${color}33`,
      minWidth: 70,
    }}>
      <p style={{ fontSize: 20, fontWeight: 700, color, lineHeight: 1 }}>{value}</p>
      <p style={{ fontSize: 10, color: C.muted, marginTop: 3 }}>{label}</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// DM Modal
// ---------------------------------------------------------------------------

function DMModal({ selected, prospects, onClose, onLaunch, running, log, result, dryRun, setDryRun }) {
  const [template, setTemplate] = useState(DEFAULT_TEMPLATE)
  const preview = template.replace(/{username}/g, prospects.find(p => selected.has(p.id))?.username?.replace('@', '') || 'Sophie')

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 300,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(6px)',
    }}>
      <div style={{
        width: 560, borderRadius: 18,
        background: C.card, border: `1px solid ${C.border}`,
        boxShadow: '0 32px 80px rgba(0,0,0,0.7)',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          padding: '20px 24px 18px',
          borderBottom: `1px solid ${C.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 32, height: 32, borderRadius: 8,
              background: 'rgba(124,58,237,0.2)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Send size={15} color={C.accentL} />
            </div>
            <div>
              <p style={{ fontSize: 14, fontWeight: 600, color: C.text }}>Envoyer des DMs</p>
              <p style={{ fontSize: 11, color: C.muted }}>{selected.size} profil{selected.size > 1 ? 's' : ''} sélectionné{selected.size > 1 ? 's' : ''}</p>
            </div>
          </div>
          {!running && (
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.dim }}>
              <X size={16} />
            </button>
          )}
        </div>

        <div style={{ padding: '20px 24px' }}>
          {/* Template */}
          <label style={labelStyle}>
            Template du message
            <span style={{ color: C.dim, fontWeight: 400, marginLeft: 6 }}>variables : {'{username}'}, {'{date}'}</span>
          </label>
          <textarea
            value={template}
            onChange={e => setTemplate(e.target.value)}
            disabled={running}
            rows={4}
            style={{
              ...inputStyle, resize: 'vertical', marginBottom: 12,
              opacity: running ? 0.6 : 1,
              lineHeight: 1.6,
            }}
          />

          {/* Preview */}
          <div style={{
            padding: '10px 14px', borderRadius: 8, marginBottom: 16,
            background: '#0d0d18', border: `1px solid ${C.border}`,
          }}>
            <p style={{ fontSize: 10, color: C.dim, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Aperçu
            </p>
            <p style={{ fontSize: 12, color: C.muted, lineHeight: 1.6 }}>{preview}</p>
          </div>

          {/* Dry-run toggle */}
          <label style={{
            display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
            padding: '10px 14px', borderRadius: 8,
            background: dryRun ? 'rgba(245,158,11,0.08)' : 'transparent',
            border: `1px solid ${dryRun ? C.amber + '44' : C.border}`,
            marginBottom: 16,
            opacity: running ? 0.5 : 1,
          }}>
            <input type="checkbox" checked={dryRun} onChange={e => setDryRun(e.target.checked)} disabled={running}
              style={{ accentColor: C.amber }} />
            <div>
              <p style={{ fontSize: 12, fontWeight: 500, color: dryRun ? C.amber : C.muted }}>
                Mode simulation (dry-run)
              </p>
              <p style={{ fontSize: 11, color: C.dim }}>Teste sans envoyer les DMs réellement</p>
            </div>
          </label>

          {/* Progress (while running) */}
          {running && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <Loader size={13} color={C.accentL} style={{ animation: 'spin 1s linear infinite' }} />
                <span style={{ fontSize: 12, color: C.accentL }}>Envoi en cours…</span>
              </div>
              <LiveLog lines={log} empty="Connexion Instagram…" accent={C.accentL} />
            </div>
          )}

          {/* Result */}
          {result && !running && (
            <div style={{
              display: 'flex', gap: 10, marginBottom: 16,
              padding: '12px 14px', borderRadius: 10,
              background: result.aborted ? 'rgba(248,113,113,0.06)' : 'rgba(16,185,129,0.06)',
              border: `1px solid ${result.aborted ? C.red + '33' : C.green + '33'}`,
            }}>
              {result.aborted
                ? <AlertTriangle size={16} color={C.red} style={{ flexShrink: 0, marginTop: 1 }} />
                : <Zap size={16} color={C.green} style={{ flexShrink: 0, marginTop: 1 }} />
              }
              <div>
                <p style={{ fontSize: 12, fontWeight: 600, color: result.aborted ? C.red : C.green, marginBottom: 3 }}>
                  {result.aborted ? `Campagne interrompue : ${result.abort_reason}` : 'Campagne terminée'}
                </p>
                <p style={{ fontSize: 11, color: C.muted }}>
                  {result.total_sent} envoyés · {result.total_failed} échecs
                </p>
              </div>
            </div>
          )}

          {/* Buttons */}
          <div style={{ display: 'flex', gap: 8 }}>
            {!running && !result && (
              <>
                <button onClick={onClose} style={{
                  flex: 1, padding: '10px', borderRadius: 9,
                  border: `1px solid ${C.border}`, background: 'transparent',
                  color: C.muted, fontSize: 13, cursor: 'pointer',
                }}>
                  Annuler
                </button>
                <button
                  onClick={() => onLaunch(template)}
                  disabled={!template.trim()}
                  style={{
                    flex: 2, padding: '10px', borderRadius: 9, border: 'none',
                    background: template.trim()
                      ? `linear-gradient(135deg, ${C.accent}, #5b21b6)`
                      : C.border,
                    color: 'white', fontSize: 13, fontWeight: 600,
                    cursor: template.trim() ? 'pointer' : 'default',
                    boxShadow: template.trim() ? '0 0 18px rgba(124,58,237,0.35)' : 'none',
                  }}
                >
                  {dryRun ? 'Simuler' : `Envoyer ${selected.size} DM${selected.size > 1 ? 's' : ''}`}
                </button>
              </>
            )}
            {result && (
              <button onClick={onClose} style={{
                flex: 1, padding: '10px', borderRadius: 9, border: 'none',
                background: C.border, color: C.text, fontSize: 13, cursor: 'pointer',
              }}>
                Fermer
              </button>
            )}
          </div>
        </div>
      </div>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function Prospection() {
  const [form, setForm] = useState({
    target:                '',
    account_id:            '',
    min_followers:         '',
    max_followers:         '',
    bio_keywords:          [],
    require_external_link: false,
    limit:                 100,
    genre:                 'femme',
    source:                'following',
  })

  const [scrape,    setScrape]    = useState({ running: false, log: [], result: null })
  const [campaign,  setCampaign]  = useState({ running: false, log: [], result: null })
  const [prospects, setProspects] = useState([])
  const [comptes,   setComptes]   = useState([])
  const [selected,  setSelected]  = useState(new Set())
  const [showModal, setShowModal] = useState(false)
  const [dryRun,    setDryRun]    = useState(false)
  const [dateFilter, setDateFilter] = useState('')

  // ── Load initial data ────────────────────────────────────────────────────
  useEffect(() => {
    Promise.all([getModeles(), getComptes()]).then(([m, c]) => {
      setProspects(m)
      setComptes(c)
      if (c.length > 0) setForm(f => ({ ...f, account_id: c[0].id }))
    })
  }, [])

  // ── Poll scrape status ───────────────────────────────────────────────────
  useEffect(() => {
    if (!scrape.running) return
    let live = true
    const poll = async () => {
      if (!live) return
      try {
        const s = await getScrapeStatus()
        setScrape(prev => ({ ...prev, log: s.log || [] }))
        if (!s.running) {
          setScrape({ running: false, log: s.log || [], result: s.result })
          getModeles().then(setProspects)
          return
        }
      } catch { /* ignore */ }
      setTimeout(poll, 2000)
    }
    poll()
    return () => { live = false }
  }, [scrape.running])

  // ── Poll campaign status ─────────────────────────────────────────────────
  useEffect(() => {
    if (!campaign.running) return
    let live = true
    const poll = async () => {
      if (!live) return
      try {
        const s = await getCampaignStatus()
        if (!live) return   // re-check après l'await : évite d'écraser la sélection en cours
        setCampaign(prev => ({ ...prev, log: s.log || [] }))
        if (!s.running) {
          setCampaign({ running: false, log: s.log || [], result: s.result })
          getModeles().then(setProspects)
          return
        }
      } catch { /* ignore */ }
      setTimeout(poll, 2500)
    }
    poll()
    return () => { live = false }
  }, [campaign.running])

  // ── Handlers ─────────────────────────────────────────────────────────────

  async function handleLaunchScrape() {
    if (!form.target.trim()) return
    setScrape({ running: true, log: [], result: null })
    try {
      await startScrape({
        account_id:            form.account_id || null,
        target:                form.target.trim().replace('@', ''),
        min_followers:         parseInt(form.min_followers) || 0,
        max_followers:         parseInt(form.max_followers) || null,
        bio_keywords:          form.bio_keywords,
        require_external_link: form.require_external_link,
        limit:                 form.limit,
        scrape_limit:          form.limit,
        headless:              true,
        genre:                 form.genre,
        source:                form.source,
      })
    } catch (e) {
      setScrape({ running: false, log: [`Erreur : ${e.message}`], result: { error: e.message } })
    }
  }

  async function handleLaunchCampaign(template) {
    setCampaign(prev => ({ ...prev, running: true, log: [], result: null }))
    try {
      await startCampaign({
        account_id:  form.account_id || null,
        modele_ids:  Array.from(selected),
        templates:   [template],
        dry_run:     dryRun,
        headless:    true,
      })
    } catch (e) {
      setCampaign({ running: false, log: [`Erreur : ${e.message}`], result: { error: e.message } })
    }
  }

  function toggleSelect(id) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleAll() {
    if (selected.size === prospects.length) setSelected(new Set())
    else setSelected(new Set(prospects.map(p => p.id)))
  }

  const setF = key => val => setForm(f => ({ ...f, [key]: val }))
  const setFE = key => e  => setForm(f => ({ ...f, [key]: e.target.value }))

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>

      {/* ═══════════════ LEFT PANEL ═══════════════ */}
      <div style={{
        width: 300, flexShrink: 0,
        background: C.surf,
        borderRight: `1px solid ${C.border}`,
        overflowY: 'auto',
        display: 'flex', flexDirection: 'column',
      }}>

        {/* Header */}
        <div style={{ padding: '22px 20px 16px', borderBottom: `1px solid ${C.border}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <Crosshair size={16} color={C.accentL} />
            <p style={{ fontSize: 15, fontWeight: 700, color: C.text }}>Prospection</p>
          </div>
          <p style={{ fontSize: 11, color: C.muted }}>Scraper + envoyer des DMs</p>
        </div>

        <div style={{ padding: '18px 18px', flex: 1, display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Compte cible */}
          <div>
            <label style={labelStyle}>Compte cible Instagram *</label>
            <div style={{ position: 'relative' }}>
              <span style={{
                position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)',
                color: C.muted, fontSize: 13, pointerEvents: 'none',
              }}>@</span>
              <input
                value={form.target}
                onChange={setFE('target')}
                placeholder="nike"
                disabled={scrape.running}
                style={{ ...inputStyle, paddingLeft: 24 }}
              />
            </div>
          </div>

          {/* Compte Instagram à utiliser */}
          {comptes.length > 0 && (
            <div>
              <label style={labelStyle}>Compte à utiliser</label>
              <select
                value={form.account_id}
                onChange={setFE('account_id')}
                disabled={scrape.running}
                style={inputStyle}
              >
                {comptes.map(c => (
                  <option key={c.id} value={c.id}>@{c.username}</option>
                ))}
              </select>
            </div>
          )}

          {/* Followers min/max */}
          <div>
            <label style={labelStyle}>Followers</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div style={{ position: 'relative' }}>
                <input
                  type="number"
                  value={form.min_followers}
                  onChange={setFE('min_followers')}
                  placeholder="Min"
                  disabled={scrape.running}
                  style={inputStyle}
                  min={0}
                />
                <span style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', fontSize: 9, color: C.dim }}>min</span>
              </div>
              <div style={{ position: 'relative' }}>
                <input
                  type="number"
                  value={form.max_followers}
                  onChange={setFE('max_followers')}
                  placeholder="Max"
                  disabled={scrape.running}
                  style={inputStyle}
                  min={0}
                />
                <span style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', fontSize: 9, color: C.dim }}>max</span>
              </div>
            </div>
            {(form.min_followers || form.max_followers) && (
              <p style={{ fontSize: 10, color: C.dim, marginTop: 4 }}>
                {form.min_followers ? fmt(parseInt(form.min_followers)) : '0'}
                {' → '}
                {form.max_followers ? fmt(parseInt(form.max_followers)) : '∞'}
              </p>
            )}
          </div>

          {/* Bio keywords */}
          <div>
            <label style={labelStyle}>
              Mots-clés dans la bio
              <span style={{ color: C.dim, fontWeight: 400, marginLeft: 4 }}>(logique OU)</span>
            </label>
            <TagInput tags={form.bio_keywords} onChange={setF('bio_keywords')} />
          </div>



          {/* Source */}
          <div>
            <label style={labelStyle}>Source des profils</label>
            <div style={{ display: 'flex', gap: 6 }}>
              {[['following', 'Abonnements'], ['followers', 'Abonnés']].map(([val, label]) => (
                <button key={val} onClick={() => setF('source')(val)}
                  disabled={scrape.running}
                  style={{
                    flex: 1, padding: '7px 0', borderRadius: 8,
                    cursor: scrape.running ? 'default' : 'pointer',
                    background: form.source === val ? `linear-gradient(135deg, ${C.accent}, #5b21b6)` : C.surf,
                    color: form.source === val ? 'white' : C.muted,
                    fontSize: 12, fontWeight: form.source === val ? 600 : 400,
                    border: `1px solid ${form.source === val ? C.accent : C.border}`,
                    transition: 'all 0.15s',
                  }}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          {/* Genre cible */}
          <div>
            <label style={labelStyle}>Genre cible (IA)</label>
            <div style={{ display: 'flex', gap: 6 }}>
              {[['tous', 'Tous'], ['femme', 'Femmes'], ['homme', 'Hommes']].map(([val, label]) => (
                <button key={val} onClick={() => setF('genre')(val)}
                  disabled={scrape.running}
                  style={{
                    flex: 1, padding: '7px 0', borderRadius: 8, border: 'none',
                    cursor: scrape.running ? 'default' : 'pointer',
                    background: form.genre === val ? `linear-gradient(135deg, ${C.accent}, #5b21b6)` : C.surf,
                    color: form.genre === val ? 'white' : C.muted,
                    fontSize: 12, fontWeight: form.genre === val ? 600 : 400,
                    border: `1px solid ${form.genre === val ? C.accent : C.border}`,
                    transition: 'all 0.15s',
                  }}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          {/* Lien externe */}
          <label style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '10px 12px', borderRadius: 8, cursor: 'pointer',
            background: form.require_external_link ? 'rgba(124,58,237,0.08)' : 'transparent',
            border: `1px solid ${form.require_external_link ? C.accent + '44' : C.border}`,
            transition: 'all 0.15s',
          }}>
            {form.require_external_link
              ? <Link size={14} color={C.accentL} />
              : <Link2Off size={14} color={C.dim} />
            }
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: 12, fontWeight: 500, color: form.require_external_link ? C.accentL : C.muted }}>
                Lien externe requis
              </p>
              <p style={{ fontSize: 10, color: C.dim }}>Linktree, bio.link, etc.</p>
            </div>
            <input
              type="checkbox"
              checked={form.require_external_link}
              onChange={e => setF('require_external_link')(e.target.checked)}
              disabled={scrape.running}
              style={{ accentColor: C.accent }}
            />
          </label>

          {/* Limite */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
              <label style={{ ...labelStyle, marginBottom: 0 }}>Profils à analyser</label>
              <span style={{ fontSize: 12, fontWeight: 600, color: C.accentL }}>{form.limit}</span>
            </div>
            <input
              type="range"
              min={10} max={500} step={10}
              value={form.limit}
              onChange={e => setF('limit')(parseInt(e.target.value))}
              disabled={scrape.running}
              style={{ width: '100%', accentColor: C.accent }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 10, color: C.dim }}>10</span>
              <span style={{ fontSize: 10, color: C.dim }}>500</span>
            </div>
          </div>

          {/* Launch button */}
          <button
            onClick={handleLaunchScrape}
            disabled={scrape.running || !form.target.trim()}
            style={{
              width: '100%', padding: '11px', borderRadius: 10, border: 'none',
              cursor: scrape.running || !form.target.trim() ? 'default' : 'pointer',
              background: scrape.running || !form.target.trim()
                ? C.border
                : `linear-gradient(135deg, ${C.accent}, #5b21b6)`,
              color: 'white', fontSize: 13, fontWeight: 600,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              boxShadow: !scrape.running && form.target.trim() ? '0 0 18px rgba(124,58,237,0.3)' : 'none',
              transition: 'all 0.2s',
            }}
          >
            {scrape.running
              ? <><Loader size={14} style={{ animation: 'spin 1s linear infinite' }} /> Scraping en cours…</>
              : <><Search size={14} /> Lancer le scraping</>
            }
          </button>

          {/* Scrape stats */}
          {scrape.result && !scrape.running && (
            <div style={{
              display: 'flex', gap: 8, flexWrap: 'wrap',
              padding: '12px', borderRadius: 10,
              background: scrape.result.error ? 'rgba(248,113,113,0.06)' : 'rgba(16,185,129,0.06)',
              border: `1px solid ${scrape.result.error ? C.red + '33' : C.green + '33'}`,
            }}>
              {scrape.result.error
                ? <p style={{ fontSize: 11, color: C.red }}>{scrape.result.error}</p>
                : <>
                  <StatPill label="Ajoutés"  value={scrape.result.added        ?? 0} color={C.green} />
                  <StatPill label="Filtrés"  value={scrape.result.filtered_out ?? 0} color={C.amber} />
                  <StatPill label="Erreurs"  value={scrape.result.errors       ?? 0} color={C.red}   />
                </>
              }
            </div>
          )}

          {/* Live scrape log */}
          {(scrape.running || scrape.log.length > 0) && (
            <div>
              <p style={{ ...labelStyle, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                {scrape.running && <Loader size={11} color={C.accentL} style={{ animation: 'spin 1s linear infinite' }} />}
                Log scraper
              </p>
              <LiveLog lines={scrape.log} empty="Démarrage du scraper…" />
            </div>
          )}
        </div>

        <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      </div>

      {/* ═══════════════ RIGHT PANEL ═══════════════ */}
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>

        {/* Prospects header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '22px 32px 16px',
          borderBottom: `1px solid ${C.border}`,
          background: C.bg,
          position: 'sticky', top: 0, zIndex: 10,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Users size={15} color={C.muted} />
            <div>
              <p style={{ fontSize: 15, fontWeight: 700, color: C.text }}>
                Profils
                {prospects.length > 0 && (
                  <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 400, color: C.muted }}>
                    {prospects.length} profil{prospects.length > 1 ? 's' : ''}
                  </span>
                )}
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>

          {/* Filtre date */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              type="date"
              value={dateFilter}
              onChange={e => setDateFilter(e.target.value)}
              style={{
                padding: '5px 10px', borderRadius: 7, fontSize: 12,
                border: `1px solid ${dateFilter ? C.accent : C.border}`,
                background: C.surf, color: dateFilter ? C.accentL : C.muted,
                outline: 'none', cursor: 'pointer',
              }}
            />
            {dateFilter && (
              <button onClick={() => setDateFilter('')} style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: C.dim, padding: 2, display: 'flex', alignItems: 'center',
              }}>
                <X size={13} />
              </button>
            )}
          </div>

            {prospects.length > 0 && (
              <button onClick={toggleAll} style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '6px 12px', borderRadius: 7, border: `1px solid ${C.border}`,
                background: 'transparent', color: C.muted, fontSize: 12, cursor: 'pointer',
              }}>
                {selected.size === prospects.length && prospects.length > 0
                  ? <CheckSquare size={13} color={C.accentL} />
                  : <Square size={13} />
                }
                {selected.size === prospects.length && prospects.length > 0 ? 'Tout désélectionner' : 'Tout sélectionner'}
              </button>
            )}

            {selected.size > 0 && (
              <button
                onClick={async () => {
                  if (!window.confirm(`Supprimer ${selected.size} profil(s) ?`)) return
                  await Promise.all(Array.from(selected).map(id =>
                    fetch(`http://178.104.155.64:5000/modeles/${id}`, { method: 'DELETE' }).then(r => { if (!r.ok) throw new Error(r.status) })
                  ))
                  setProspects(prev => prev.filter(p => !selected.has(p.id)))
                  setSelected(new Set())
                }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 7,
                  padding: '7px 16px', borderRadius: 8, border: 'none',
                  background: 'rgba(248,113,113,0.15)',
                  color: '#f87171', fontSize: 12, fontWeight: 600,
                  cursor: 'pointer',
                  border: '1px solid rgba(248,113,113,0.3)',
                }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/>
                </svg>
                Supprimer ({selected.size})
              </button>
            )}
            {selected.size > 0 && (
              <button
                onClick={() => {
                  // Réinitialise le résultat d'une campagne précédente pour afficher
                  // le formulaire d'envoi (et non l'écran de résultat de la dernière campagne)
                  setCampaign(prev => ({ ...prev, result: null, log: [] }))
                  setShowModal(true)
                }}
                disabled={campaign.running}
                style={{
                  display: 'flex', alignItems: 'center', gap: 7,
                  padding: '7px 16px', borderRadius: 8, border: 'none',
                  background: campaign.running ? C.border : `linear-gradient(135deg, ${C.accent}, #5b21b6)`,
                  color: 'white', fontSize: 12, fontWeight: 600,
                  cursor: campaign.running ? 'default' : 'pointer',
                  boxShadow: !campaign.running ? '0 0 14px rgba(124,58,237,0.35)' : 'none',
                }}
              >
                <Send size={13} />
                Envoyer DM aux {selected.size} sélectionné{selected.size > 1 ? 's' : ''}
              </button>
            )}
          </div>
        </div>

        {/* Campaign progress (inline, above table) */}
        {(campaign.running || campaign.result) && (
          <div style={{
            margin: '16px 32px 0',
            padding: '14px 16px',
            borderRadius: 12,
            background: campaign.result?.aborted ? 'rgba(248,113,113,0.05)' : campaign.result ? 'rgba(16,185,129,0.05)' : 'rgba(124,58,237,0.05)',
            border: `1px solid ${campaign.result?.aborted ? C.red + '33' : campaign.result ? C.green + '33' : C.accent + '33'}`,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              {campaign.running
                ? <Loader size={13} color={C.accentL} style={{ animation: 'spin 1s linear infinite' }} />
                : campaign.result?.aborted
                ? <AlertTriangle size={13} color={C.red} />
                : <Zap size={13} color={C.green} />
              }
              <p style={{ fontSize: 12, fontWeight: 600, color: campaign.running ? C.accentL : campaign.result?.aborted ? C.red : C.green }}>
                {campaign.running ? 'Campagne DM en cours…'
                  : campaign.result?.aborted ? `Interrompue : ${campaign.result.abort_reason}`
                  : `Terminée — ${campaign.result?.total_sent ?? 0} DMs envoyés`
                }
              </p>
            </div>
            <LiveLog lines={campaign.log} empty="Démarrage…" accent={C.accentL} />
          </div>
        )}

        {/* Prospects table */}
        <div style={{ padding: '16px 32px 32px', flex: 1 }}>
          {prospects.length === 0 ? (
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              padding: '64px 24px', textAlign: 'center',
              border: `1px dashed ${C.border}`, borderRadius: 14, marginTop: 8,
            }}>
              <div style={{
                width: 52, height: 52, borderRadius: '50%', background: C.card,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                marginBottom: 14, border: `1px solid ${C.border}`,
              }}>
                <Filter size={20} color={C.dim} />
              </div>
              <p style={{ fontSize: 14, fontWeight: 500, color: C.muted, marginBottom: 6 }}>
                Aucun prospect pour l'instant
              </p>
              <p style={{ fontSize: 12, color: C.dim, maxWidth: 320, lineHeight: 1.6 }}>
                Lancez un scraping sur un compte Instagram pour remplir cette liste.
                Les profils filtrés apparaîtront ici avec statut "prospect".
              </p>
            </div>
          ) : (
            <div style={{ borderRadius: 14, border: `1px solid ${C.border}`, overflow: 'hidden' }}>
              {/* Table header */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: '44px 1fr 90px 90px 180px 70px 80px 40px',
                background: C.surf,
                padding: '10px 16px',
                borderBottom: `1px solid ${C.border}`,
              }}>
                {['', 'Profil', 'Statut', 'Followers', 'Bio', 'Lien', 'Ajouté', ''].map((h, i) => (
                  <span key={i} style={{ fontSize: 10, fontWeight: 600, color: C.dim, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    {h}
                  </span>
                ))}
              </div>

              {/* Rows */}
              {prospects
  .filter(m => {
    if (form.account_id && String(m.compte_utilisé) !== String(form.account_id)) return false
    if (m.statut === 'contacté' || m.statut === 'signé') return false
    if (dateFilter && m.date_ajout && !m.date_ajout.startsWith(dateFilter)) return false
    return true
  })
  .map((m, idx) => {
                const isSelected = selected.has(m.id)
                return (
                  <div
                    key={m.id}
                    onClick={() => toggleSelect(m.id)}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '44px 1fr 90px 90px 180px 70px 80px 40px',
                      padding: '11px 16px',
                      borderTop: idx > 0 ? `1px solid ${C.border}` : 'none',
                      background: isSelected ? 'rgba(124,58,237,0.06)' : 'transparent',
                      cursor: 'pointer',
                      transition: 'background 0.1s',
                      borderLeft: `2px solid ${isSelected ? C.accent : 'transparent'}`,
                      alignItems: 'center',
                    }}
                    onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = '#0f0f1c' }}
                    onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'transparent' }}
                  >
                    {/* Checkbox */}
                    <div style={{ display: 'flex', alignItems: 'center' }}>
                      {isSelected
                        ? <CheckSquare size={16} color={C.accentL} />
                        : <Square size={16} color={C.dim} />
                      }
                    </div>

                    {/* Profil (avatar + username) */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                      <div style={{
                        width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
                        background: isSelected
                          ? 'linear-gradient(135deg, #3b1f6e, #5b21b6)'
                          : 'linear-gradient(135deg, #1e1040, #2d1060)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 13, fontWeight: 700,
                        color: isSelected ? '#c4b5fd' : C.accentL,
                        transition: 'all 0.15s',
                        boxShadow: isSelected ? '0 0 10px rgba(124,58,237,0.3)' : 'none',
                      }}>
                        {m.username.replace('@', '').charAt(0).toUpperCase()}
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <p style={{ fontSize: 13, fontWeight: 500, color: isSelected ? C.accentL : C.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {m.username}
                        </p>
                        {m.compte_utilisé && (
                          <p style={{ fontSize: 10, color: C.dim }}>via compte #{m.compte_utilisé}</p>
                        )}
                      </div>
                    </div>

                    {/* Statut */}
                    <div>
                      <span style={{
                        display: 'inline-flex', alignItems: 'center',
                        padding: '2px 8px', borderRadius: 20, fontSize: 10, fontWeight: 500,
                        background: `${STATUS_COLOR[m.statut] ?? C.muted}18`,
                        color: STATUS_COLOR[m.statut] ?? C.muted,
                      }}>
                        {m.statut}
                      </span>
                    </div>

                    {/* Followers */}
                    <p style={{ fontSize: 13, fontWeight: 500, color: C.muted }}>{fmt(m.followers)}</p>

                    {/* Bio */}
                    <p style={{
                      fontSize: 11, color: C.dim,
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>
                      {m.bio || <span style={{ fontStyle: 'italic', color: C.border }}>—</span>}
                    </p>

                    {/* Lien */}
                    <div>
                      {m.lien
                        ? <a href={m.lien} target="_blank" rel="noreferrer"
                             onClick={e => e.stopPropagation()}
                             style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, color: C.accentL, textDecoration: 'none' }}>
                            <Link size={11} />
                            lien
                          </a>
                        : <span style={{ fontSize: 11, color: C.border }}>—</span>
                      }
                    </div>

                    {/* Date */}
                    <p style={{ fontSize: 11, color: C.dim }}>{m.date_ajout}</p>
                    {/* Supprimer */}
                    <div onClick={e => e.stopPropagation()}>
                      <button
                        onClick={async () => {
                          await fetch(`http://178.104.155.64:5000/modeles/${m.id}`, { method: 'DELETE' })
                          setProspects(prev => prev.filter(p => p.id !== m.id))
                          setSelected(prev => { const n = new Set(prev); n.delete(m.id); return n })
                        }}
                        style={{
                          background: 'none', border: 'none', cursor: 'pointer',
                          color: '#444466', padding: 4, borderRadius: 4,
                          display: 'flex', alignItems: 'center',
                        }}
                        title="Supprimer"
                        onMouseEnter={e => e.currentTarget.style.color = '#f87171'}
                        onMouseLeave={e => e.currentTarget.style.color = '#444466'}
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/>
                        </svg>
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* ═══════════════ DM MODAL ═══════════════ */}
      {showModal && (
        <DMModal
          selected={selected}
          prospects={prospects}
          dryRun={dryRun}
          setDryRun={setDryRun}
          running={campaign.running}
          log={campaign.log}
          result={campaign.result}
          onClose={() => setShowModal(false)}
          onLaunch={handleLaunchCampaign}
        />
      )}
    </div>
  )
}
