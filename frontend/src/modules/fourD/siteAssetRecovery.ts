import axios from 'axios'
import { loadSiteAsset } from './siteAssets'
import type { AssetPart } from './assetParts'

// loadSiteAsset shares downloads and parsing, but returns a fresh clone per
// caller. Retry temporary transport failures without sharing mutable clones.
export async function loadSiteAssetWithRecovery(id: string, part?: AssetPart | null) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await loadSiteAsset(id, part)
    } catch (error) {
      const transient = axios.isAxiosError(error)
        ? error.code !== 'ERR_CANCELED' && (!error.response || error.response.status >= 500)
        : error instanceof Error && /download stalled|network error|failed to fetch/i.test(error.message)
      if (!transient || attempt >= 2) throw error
      await new Promise(resolve => setTimeout(resolve, attempt === 0 ? 2000 : 5000))
    }
  }
}
