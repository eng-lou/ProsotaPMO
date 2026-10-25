export type ReleaseChannel = 'stable' | 'preview'
export const releaseChannel: ReleaseChannel = import.meta.env.VITE_RELEASE_CHANNEL === 'preview' ? 'preview' : 'stable'
export const PLANNER_VERSION = releaseChannel === 'preview' ? '0.2.42-preview.1' : '0.2.41'

// Publish a link only after its exact deployment/installer has passed verification.
// Promotion changes this catalogue; it does not silently replace another channel.
export const plannerReleases = {
  stable: {
    web: { version: '0.2.41', url: 'https://www.prosota.com', available: true },
    desktop: { version: '0.2.41', url: 'https://github.com/eng-lou/ProsotaPMO/releases/download/planner-stable-v0.2.41/Prosota-Planner-Stable-0.2.41-Setup.exe', available: true },
  },
  preview: {
    web: { version: '0.2.42-preview.1', url: 'https://preview.prosota.com', available: true },
    desktop: { version: '0.2.42-preview.1', url: 'https://github.com/eng-lou/ProsotaPMO/releases/download/planner-preview-v0.2.42-preview.1/Prosota-Planner-Preview-0.2.42-preview.1-Setup.exe', available: true },
  },
} as const
