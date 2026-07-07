// Pure multi-select reducer for the Files table. Selection is keyed by
// workspace path (not row index) so it survives re-sorts and refreshes, and
// paths are always kept in visual order so bulk actions read top-to-bottom.

export interface FileSelection {
  paths: string[]
  anchorPath: string | null
}

export interface SelectionModifiers {
  /** cmd/ctrl held: toggle membership (or add the range). */
  toggle: boolean
  /** shift held: select the anchor-to-row range. */
  range: boolean
}

export function emptySelection(): FileSelection {
  return { paths: [], anchorPath: null }
}

export function reduceRowClick(
  selection: FileSelection,
  visiblePaths: string[],
  clickedPath: string,
  mods: SelectionModifiers,
): { selection: FileSelection; activate: boolean } {
  if (mods.range) {
    const anchorPath = selection.anchorPath && visiblePaths.includes(selection.anchorPath)
      ? selection.anchorPath
      : clickedPath
    const range = rangeBetween(visiblePaths, anchorPath, clickedPath)
    const paths = mods.toggle
      ? inVisualOrder(new Set([...selection.paths, ...range]), visiblePaths)
      : range
    return { selection: { paths, anchorPath }, activate: false }
  }

  if (mods.toggle) {
    const next = new Set(selection.paths)
    if (next.has(clickedPath)) next.delete(clickedPath)
    else next.add(clickedPath)
    return {
      selection: { paths: inVisualOrder(next, visiblePaths), anchorPath: clickedPath },
      activate: false,
    }
  }

  return { selection: { paths: [clickedPath], anchorPath: clickedPath }, activate: true }
}

/** Drop paths no longer visible; returns the input object when unchanged. */
export function pruneSelection(selection: FileSelection, visiblePaths: string[]): FileSelection {
  const visible = new Set(visiblePaths)
  const paths = selection.paths.filter(path => visible.has(path))
  const anchorPath = selection.anchorPath && visible.has(selection.anchorPath)
    ? selection.anchorPath
    : null
  if (paths.length === selection.paths.length && anchorPath === selection.anchorPath) {
    return selection
  }
  return { paths, anchorPath }
}

function rangeBetween(visiblePaths: string[], fromPath: string, toPath: string): string[] {
  const from = visiblePaths.indexOf(fromPath)
  const to = visiblePaths.indexOf(toPath)
  if (from === -1 || to === -1) return visiblePaths.includes(toPath) ? [toPath] : []
  return visiblePaths.slice(Math.min(from, to), Math.max(from, to) + 1)
}

function inVisualOrder(paths: Set<string>, visiblePaths: string[]): string[] {
  return visiblePaths.filter(path => paths.has(path))
}
