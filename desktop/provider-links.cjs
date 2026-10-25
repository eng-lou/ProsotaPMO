// Only these public setup pages may leave a Prosota window for the system browser.
const PROVIDER_LINKS = new Set([
  'https://platform.openai.com/api-keys',
  'https://platform.claude.com/settings/keys',
  'https://aistudio.google.com/apikey',
  'https://console.cloud.google.com/google/maps-apis/credentials',
  'https://developers.google.com/maps/documentation/tile/get-api-key',
])

function isProviderSetupLink(url) {
  return typeof url === 'string' && PROVIDER_LINKS.has(url)
}

module.exports = { isProviderSetupLink }
