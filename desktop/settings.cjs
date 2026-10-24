const providers = new Set(['off', 'openai', 'anthropic'])
function updateSettings(previous, input) {
  if (!input || !providers.has(input.provider)) throw new Error('Choose a supported provider.')
  const model = String(input.model || '').trim()
  if (model.length > 120 || /[\r\n]/.test(model)) throw new Error('Invalid model ID.')
  const result = { ...previous, provider: input.provider, model }
  result.renderProvider = input.renderProvider ?? previous.renderProvider ?? 'off'
  if (!['off', 'openai', 'gemini'].includes(result.renderProvider)) throw new Error('Choose a supported image provider.')
  result.imageModel = String(input.imageModel ?? previous.imageModel ?? '').trim()
  if (result.imageModel.length > 120 || /[\r\n]/.test(result.imageModel)) throw new Error('Invalid image model ID.')
  for (const key of ['openaiKey', 'anthropicKey', 'googleMapsKey', 'geminiKey']) {
    if (input[key] === null) result[key] = ''
    else if (typeof input[key] === 'string' && input[key].trim()) {
      if (input[key].length > 1024 || /[\r\n]/.test(input[key])) throw new Error('Invalid API key.')
      result[key] = input[key].trim()
    }
  }
  if (result.renderProvider !== 'off' && !result[`${result.renderProvider}Key`]) throw new Error('Enter the image provider API key.')
  if (result.renderProvider === 'openai' && !result.imageModel) throw new Error('Enter an image model ID.')
  if (result.provider !== 'off' && (!result[`${result.provider}Key`] || !model)) {
    throw new Error('Enter an API key and the model ID available on your provider account.')
  }
  return result
}
function publicSettings(value) {
  return { provider: value.provider, model: value.model || '',
    hasOpenaiKey: Boolean(value.openaiKey), hasAnthropicKey: Boolean(value.anthropicKey),
    hasGoogleMapsKey: Boolean(value.googleMapsKey), hasGeminiKey: Boolean(value.geminiKey),
    renderProvider: value.renderProvider || 'off', imageModel: value.imageModel || '' }
}
module.exports = { updateSettings, publicSettings }
