export type ReleaseChannel = 'stable' | 'preview'
export const PLANNER_VERSION = '0.2.41'
export const releaseChannel: ReleaseChannel = import.meta.env.VITE_RELEASE_CHANNEL === 'preview' ? 'preview' : 'stable'

// Publish a link only after its exact deployment/installer has passed verification.
// Promotion changes this catalogue; it does not silently replace another channel.
export const plannerReleases = {
  stable: {
    web: { version: '0.2.41', url: 'https://www.prosota.com', available: false },
    desktop: { version: '0.2.41', url: 'https://github.com/eng-lou/ProsotaPMO/releases/download/planner-stable-v0.2.41/Prosota-Planner-Stable-0.2.41-Setup.exe', available: false },
  },
  preview: {
    web: { version: '0.2.41', url: 'https://preview.prosota.com', available: false },
    desktop: { version: '0.2.41', url: 'https://github.com/eng-lou/ProsotaPMO/releases/download/planner-preview-v0.2.41/Prosota-Planner-Preview-0.2.41-Setup.exe', available: false },
  },
} as const
