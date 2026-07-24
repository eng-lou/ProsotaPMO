// The real Prosota brand mark (2026-07-25, replacing an earlier hand-drawn
// SVG recreation — per Maro: "the logo please", re-sharing the actual
// prosota_ltd_logo.jpg). That JPG has a plain white background and no
// higher-res/vector source exists, so it's been de-matted into
// public/logo.png (a one-off script, not part of the build) rather than
// used as-is — a raw JPG would show a white box around the mark in the
// dark sidebar/login screen. De-matting used the standard "recover
// unpremultiplied color from an alpha = 255-min(rgb) estimate" technique,
// snapping near-white JPEG compression noise straight to fully transparent
// first (a plain min-channel threshold alone left a faint whitish halo from
// that noise) — verified by compositing over both the light and dark theme
// backgrounds before use.
export function ProsotaLogo({ size = 26, className }: { size?: number; className?: string }) {
  return <img src="/logo.png" width={size} height={size} alt="Prosota" className={className} />
}
