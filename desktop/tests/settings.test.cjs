const { test } = require('node:test')
const assert = require('node:assert/strict')
const { updateSettings, publicSettings } = require('../settings.cjs')

test('blank input preserves encrypted keys; explicit removal clears them', () => {
  const previous = { provider: 'openai', model: 'model', dbPassword: 'private', openaiKey: 'secret' }
  const saved = updateSettings(previous, { provider: 'openai', model: 'next', openaiKey: '' })
  assert.equal(saved.openaiKey, 'secret')
  assert.equal(saved.dbPassword, 'private')
  assert.equal(updateSettings(saved, { provider: 'off', openaiKey: null }).openaiKey, '')
  assert.deepEqual(publicSettings(saved), { provider: 'openai', model: 'next', hasOpenaiKey: true, hasAnthropicKey: false, hasGoogleMapsKey: false, hasGeminiKey: false, renderProvider: 'off', imageModel: '' })
})
test('Maps works independently from Poe and remains masked', () => {
  const settings = updateSettings({}, { provider: 'off', googleMapsKey: 'maps-test' })
  assert.equal(settings.googleMapsKey, 'maps-test')
  assert.equal(publicSettings(settings).hasGoogleMapsKey, true)
  assert.equal(publicSettings(settings).googleMapsKey, undefined)
  assert.equal(updateSettings(settings, { provider: 'off', googleMapsKey: '' }).googleMapsKey, 'maps-test')
  assert.equal(updateSettings(settings, { provider: 'off', googleMapsKey: null }).googleMapsKey, '')
})
test('invalid configuration cannot enable a paid provider', () => {
  assert.throws(() => updateSettings({}, { provider: 'openai', model: 'x' }))
  assert.throws(() => updateSettings({}, { provider: 'arbitrary' }))
  assert.throws(() => updateSettings({}, { provider: 'openai', model: 'x', openaiKey: 'a\nb' }))
})
