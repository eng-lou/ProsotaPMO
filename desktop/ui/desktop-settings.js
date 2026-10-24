const $ = id => document.getElementById(id)
async function load() {
  const s = await window.prosotaDesktop.readSettings()
  $('provider').value = s.provider
  $('model').value = s.model
  $('openaiKey').placeholder = s.hasOpenaiKey ? 'Saved — leave blank to retain' : 'Not configured'
  $('anthropicKey').placeholder = s.hasAnthropicKey ? 'Saved — leave blank to retain' : 'Not configured'
  $('googleMapsKey').placeholder = s.hasGoogleMapsKey ? 'Saved — leave blank to retain' : 'Not configured'
  $('geminiKey').placeholder = s.hasGeminiKey ? 'Saved — leave blank to retain' : 'Not configured'
  $('renderProvider').value = s.renderProvider
  $('imageModel').value = s.imageModel
}
$('form').addEventListener('submit', async e => {
  e.preventDefault()
  try {
    await window.prosotaDesktop.saveSettings(Object.fromEntries(['provider', 'model', 'openaiKey', 'anthropicKey', 'googleMapsKey', 'geminiKey', 'renderProvider', 'imageModel'].map(k => [k, $(k).value])))
    for (const key of ['openaiKey', 'anthropicKey', 'googleMapsKey', 'geminiKey']) $(key).value = ''
    $('status').textContent = 'Saved. Reload an open map to apply its new key.'
    await load()
  } catch (e) { $('status').textContent = e.message }
})
$('clear').addEventListener('click', async () => {
  try {
    await window.prosotaDesktop.saveSettings({ provider: 'off', model: '', openaiKey: null, anthropicKey: null, googleMapsKey: null, geminiKey: null, renderProvider: 'off' })
    for (const key of ['openaiKey', 'anthropicKey', 'googleMapsKey', 'geminiKey']) $(key).value = ''
    await load(); $('status').textContent = 'Keys removed. Poe is off.'
  } catch (e) { $('status').textContent = e.message }
})
load().catch(e => { $('status').textContent = e.message })
for (const action of ['backup', 'restore']) $(action).addEventListener('click', async () => {
  $('backup').disabled = $('restore').disabled = true
  $('status').textContent = 'Preparing workspace…'
  try { $('status').textContent = await window.prosotaDesktop[action]() }
  catch (e) { $('status').textContent = e.message }
  finally { $('backup').disabled = $('restore').disabled = false }
})
