/**
 * Shared theme-application helper.
 *
 * Both the main App window and popout shells need to stamp `data-theme` on the
 * document element so Tailwind theme tokens resolve correctly.  Extracting the
 * one-liner keeps the contract in a single place.
 */
export function applyThemeToDocument(themeName: string): void {
  document.documentElement.dataset.theme = themeName
}
