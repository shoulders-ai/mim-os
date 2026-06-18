export interface OrderedNavigatorItem {
  key: string
}

export function sortWithManualOrder<T extends OrderedNavigatorItem>(
  items: T[],
  manualOrder: string[],
): T[] {
  const orderIndex = new Map(manualOrder.map((key, index) => [key, index]))
  const indexed = items.map((item, index) => ({ item, index }))

  indexed.sort((a, b) => {
    const aOrder = orderIndex.get(a.item.key)
    const bOrder = orderIndex.get(b.item.key)
    const aOrdered = aOrder !== undefined
    const bOrdered = bOrder !== undefined

    if (!aOrdered && !bOrdered) {
      return a.index - b.index
    }
    if (!aOrdered) return -1
    if (!bOrdered) return 1
    return aOrder - bOrder
  })

  return indexed.map(entry => entry.item)
}

// Destinations policy: manually ordered rows first (in saved order), rows not
// yet in the saved order keep their canonical declaration order after them.
export function applyManualOrder<T extends { key: string }>(
  rows: T[],
  manualOrder: string[],
): T[] {
  if (!manualOrder.length) return rows

  const byKey = new Map(rows.map(row => [row.key, row]))
  const ordered = manualOrder
    .map(key => byKey.get(key))
    .filter((row): row is T => Boolean(row))
  const orderedKeys = new Set(ordered.map(row => row.key))
  return [
    ...ordered,
    ...rows.filter(row => !orderedKeys.has(row.key)),
  ]
}

export function reorderKeys(
  currentKeys: string[],
  movingKey: string,
  beforeKey: string | null,
): string[] {
  const reordered = currentKeys.filter(key => key !== movingKey)
  if (!beforeKey) return [...reordered, movingKey]

  const index = reordered.indexOf(beforeKey)
  if (index < 0) return [...reordered, movingKey]
  reordered.splice(index, 0, movingKey)
  return reordered
}

