// Package icon classification and URL building for the Navigator nav-token.
//
// The manifest `icon` is a free-form string. It is interpreted as:
//   - an image asset when it ends in `.svg` or `.png` (case-insensitive), or
//   - a short text token otherwise (the historical default, e.g. "B", "MD").
//
// Image icons must live under the package's `ui/` directory and be referenced
// the same way a view `src` is — `./ui/icon.svg` or `icon.svg` — so they are
// served by the existing `/packages/:id/<ui-relative-path>` route. The
// renderer renders them as a CSS-masked span (background: currentColor) so the
// mark inherits the nav-token color and follows the active grammar (ink-3 →
// accent) exactly like a text token, with no `v-html` and no privileged-surface
// HTML injection from package content.

const IMAGE_EXT = /\.(svg|png)$/i

export function isImageIcon(icon: string | undefined | null): boolean {
  return typeof icon === 'string' && IMAGE_EXT.test(icon.trim())
}

// Normalize a manifest image-icon path to its path relative to the package
// `ui/` root, matching how view `src` (`./ui/index.html`) maps to `index.html`.
//   './ui/icon.svg' -> 'icon.svg'
//   'icon.svg'      -> 'icon.svg'
//   './ui/a/b.svg'  -> 'a/b.svg'
export function iconUiRel(icon: string): string {
  let s = icon.trim().replace(/^\.\//, '')
  if (s.toLowerCase().startsWith('ui/')) s = s.slice(3)
  return s
}

export function packageIconUrl(icon: string, packageId: string, port: number): string {
  return `http://127.0.0.1:${port}/packages/${encodeURIComponent(packageId)}/${iconUiRel(icon).split('/').map(encodeURIComponent).join('/')}`
}
