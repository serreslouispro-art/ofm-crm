const BASE = 'http://178.104.155.64:5000'

async function request(path, options = {}) {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.description || `Erreur HTTP ${res.status}`)
  }
  if (res.status === 204) return null
  return res.json()
}

export const getModeles    = (statut) => request('/modeles' + (statut ? `?statut=${statut}` : ''))
export const getModele     = (id)     => request(`/modeles/${id}`)
export const addModele     = (data)   => request('/modeles', { method: 'POST', body: JSON.stringify(data) })
export const updateStatut  = (id, s)  => request(`/modeles/${id}/statut`, { method: 'PATCH', body: JSON.stringify({ statut: s }) })
export const deleteModele  = (id)     => request(`/modeles/${id}`, { method: 'DELETE' })

export const getMessages   = (mid)              => request(`/modeles/${mid}/messages`)
export const sendMessage   = (mid, contenu, direction = 'sortant', compte_id = null) =>
  request(`/modeles/${mid}/messages`, { method: 'POST', body: JSON.stringify({ contenu, direction, compte_id }) })

export const getComptes      = ()           => request('/comptes')
export const addCompte       = (u, p)       => request('/comptes', { method: 'POST', body: JSON.stringify({ username: u, password: p }) })
export const toggleCompte    = (id, actif)  => request(`/comptes/${id}/actif`, { method: 'PATCH', body: JSON.stringify({ actif }) })
export const deleteCompte    = (id)         => request(`/comptes/${id}`, { method: 'DELETE' })

// Scraper
export const startScrape      = (data) => request('/scrape/start',    { method: 'POST', body: JSON.stringify(data) })
export const getScrapeStatus  = ()     => request('/scrape/status')

// Campagne DM
export const startCampaign    = (data) => request('/campaign/start',  { method: 'POST', body: JSON.stringify(data) })
export const getCampaignStatus = ()    => request('/campaign/status')

// Inbox listener
export const getNonLus        = ()     => request('/modeles/non_lus')
export const getInboxStatus   = ()     => request('/inbox/status')
export const startInboxListener = (data) => request('/inbox/start', { method: 'POST', body: JSON.stringify(data) })
export const stopInboxListener  = ()   => request('/inbox/stop',  { method: 'POST', body: JSON.stringify({}) })

export const startCampaignAuto = (data) => request('/campaign/auto', { method: 'POST', body: JSON.stringify(data) })
export const stopCampaign = () => request('/campaign/stop', { method: 'POST', body: '{}' })

export const getTemplates    = ()      => request('/templates')
export const createTemplate  = (data)  => request('/templates', { method: 'POST', body: JSON.stringify(data) })
export const updateTemplate  = (id, d) => request(`/templates/${id}`, { method: 'PATCH', body: JSON.stringify(d) })
export const deleteTemplate  = (id)    => request(`/templates/${id}`, { method: 'DELETE' })
