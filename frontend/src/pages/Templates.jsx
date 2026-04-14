import { useState, useEffect } from 'react'
import { getTemplates, createTemplate, updateTemplate, deleteTemplate } from '../api'
import { Plus, Trash2, Edit3, Check, X, ToggleLeft, ToggleRight, TrendingUp } from 'lucide-react'

export default function Templates() {
  const [templates, setTemplates] = useState([])
  const [editing, setEditing]     = useState(null)  // {id, nom, contenu}
  const [newT, setNewT]           = useState({ nom: '', contenu: '' })
  const [showNew, setShowNew]     = useState(false)

  useEffect(() => { load() }, [])
  const load = () => getTemplates().then(setTemplates)

  const save = async () => {
    if (!newT.nom.trim() || !newT.contenu.trim()) return
    await createTemplate(newT)
    setNewT({ nom: '', contenu: '' })
    setShowNew(false)
    load()
  }

  const saveEdit = async () => {
    await updateTemplate(editing.id, { nom: editing.nom, contenu: editing.contenu })
    setEditing(null)
    load()
  }

  const toggle = async (t) => {
    await updateTemplate(t.id, { actif: t.actif ? 0 : 1 })
    load()
  }

  const del = async (id) => {
    if (!confirm('Supprimer ce template ?')) return
    await deleteTemplate(id)
    load()
  }

  const tauxReponse = (t) => t.envoyes === 0 ? '—' : `${Math.round(t.reponses / t.envoyes * 100)}%`

  return (
    <div style={{ padding: '32px 40px', maxWidth: 900, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#eeeef8', margin: 0 }}>Templates de messages</h1>
          <p style={{ fontSize: 13, color: '#555577', marginTop: 4 }}>La campagne pioche aléatoirement parmi les templates actifs</p>
        </div>
        <button onClick={() => setShowNew(true)} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 16px', borderRadius: 10, border: 'none', background: '#7c3aed', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
          <Plus size={14} /> Nouveau template
        </button>
      </div>

      {/* Stats globales */}
      {templates.length > 0 && (
        <div style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
          {[
            { label: 'Templates actifs', val: templates.filter(t => t.actif).length },
            { label: 'DMs envoyés', val: templates.reduce((s, t) => s + t.envoyes, 0) },
            { label: 'Réponses totales', val: templates.reduce((s, t) => s + t.reponses, 0) },
            { label: 'Taux global', val: (() => { const e = templates.reduce((s,t)=>s+t.envoyes,0); const r = templates.reduce((s,t)=>s+t.reponses,0); return e===0?'—':`${Math.round(r/e*100)}%` })() },
          ].map(s => (
            <div key={s.label} style={{ flex: 1, background: '#0d0d1a', border: '1px solid #1a1a2e', borderRadius: 10, padding: '14px 18px' }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: '#a78bfa' }}>{s.val}</div>
              <div style={{ fontSize: 11, color: '#444466', marginTop: 2 }}>{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Formulaire nouveau template */}
      {showNew && (
        <div style={{ background: '#0d0d1a', border: '1px solid #7c3aed', borderRadius: 12, padding: 20, marginBottom: 20 }}>
          <input
            placeholder="Nom du template (ex: Accroche OF classique)"
            value={newT.nom}
            onChange={e => setNewT(p => ({ ...p, nom: e.target.value }))}
            style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid #1a1a2e', background: '#12121e', color: '#eeeef8', fontSize: 13, outline: 'none', marginBottom: 10, boxSizing: 'border-box' }}
          />
          <textarea
            placeholder="Contenu du message..."
            value={newT.contenu}
            onChange={e => setNewT(p => ({ ...p, contenu: e.target.value }))}
            rows={4}
            style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid #1a1a2e', background: '#12121e', color: '#eeeef8', fontSize: 13, outline: 'none', resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box' }}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 10, justifyContent: 'flex-end' }}>
            <button onClick={() => { setShowNew(false); setNewT({ nom: '', contenu: '' }) }} style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid #1a1a2e', background: 'transparent', color: '#666688', fontSize: 12, cursor: 'pointer' }}>Annuler</button>
            <button onClick={save} style={{ padding: '7px 14px', borderRadius: 8, border: 'none', background: '#7c3aed', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Créer</button>
          </div>
        </div>
      )}

      {/* Liste templates */}
      {templates.length === 0 && !showNew && (
        <div style={{ textAlign: 'center', padding: '60px 0', color: '#333355' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>✉️</div>
          <div style={{ fontSize: 14 }}>Aucun template — crée ton premier message</div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {templates.map(t => (
          <div key={t.id} style={{ background: '#0d0d1a', border: `1px solid ${t.actif ? '#1a1a3e' : '#111122'}`, borderRadius: 12, padding: 18, opacity: t.actif ? 1 : 0.5 }}>
            {editing?.id === t.id ? (
              <>
                <input value={editing.nom} onChange={e => setEditing(p => ({ ...p, nom: e.target.value }))}
                  style={{ width: '100%', padding: '7px 10px', borderRadius: 7, border: '1px solid #1a1a2e', background: '#12121e', color: '#eeeef8', fontSize: 13, outline: 'none', marginBottom: 8, boxSizing: 'border-box' }} />
                <textarea value={editing.contenu} onChange={e => setEditing(p => ({ ...p, contenu: e.target.value }))}
                  rows={4} style={{ width: '100%', padding: '7px 10px', borderRadius: 7, border: '1px solid #1a1a2e', background: '#12121e', color: '#eeeef8', fontSize: 13, outline: 'none', resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box' }} />
                <div style={{ display: 'flex', gap: 8, marginTop: 8, justifyContent: 'flex-end' }}>
                  <button onClick={() => setEditing(null)} style={{ padding: '6px 12px', borderRadius: 7, border: '1px solid #1a1a2e', background: 'transparent', color: '#666688', fontSize: 12, cursor: 'pointer' }}><X size={12} /></button>
                  <button onClick={saveEdit} style={{ padding: '6px 12px', borderRadius: 7, border: 'none', background: '#7c3aed', color: '#fff', fontSize: 12, cursor: 'pointer' }}><Check size={12} /></button>
                </div>
              </>
            ) : (
              <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#eeeef8' }}>{t.nom}</span>
                    {t.actif ? <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 5, background: 'rgba(124,58,237,0.2)', color: '#a78bfa' }}>Actif</span>
                              : <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 5, background: '#1a1a2e', color: '#444466' }}>Inactif</span>}
                  </div>
                  <div style={{ fontSize: 12, color: '#666688', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{t.contenu}</div>
                  {/* Stats */}
                  <div style={{ display: 'flex', gap: 16, marginTop: 10 }}>
                    <span style={{ fontSize: 11, color: '#444466' }}>📤 {t.envoyes} envoyés</span>
                    <span style={{ fontSize: 11, color: '#444466' }}>💬 {t.reponses} réponses</span>
                    <span style={{ fontSize: 11, color: t.envoyes > 0 ? '#a78bfa' : '#444466', fontWeight: 600 }}>
                      <TrendingUp size={10} style={{ marginRight: 3 }} />{tauxReponse(t)}
                    </span>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <button onClick={() => toggle(t)} title={t.actif ? 'Désactiver' : 'Activer'}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: t.actif ? '#7c3aed' : '#333355', padding: 4 }}>
                    {t.actif ? <ToggleRight size={20} /> : <ToggleLeft size={20} />}
                  </button>
                  <button onClick={() => setEditing({ id: t.id, nom: t.nom, contenu: t.contenu })}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#555577', padding: 4 }}><Edit3 size={15} /></button>
                  <button onClick={() => del(t.id)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', padding: 4 }}><Trash2 size={15} /></button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
