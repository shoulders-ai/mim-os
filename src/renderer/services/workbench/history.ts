export interface HistoryEntry {
  id: string
}

export interface PaneHistory<T extends HistoryEntry> {
  current: T | null
  backStack: T[]
  forwardStack: T[]
}

export function createPaneHistory<T extends HistoryEntry>(
  current: T | null = null,
): PaneHistory<T> {
  return {
    current,
    backStack: [],
    forwardStack: [],
  }
}

export function openHistoryEntry<T extends HistoryEntry>(
  history: PaneHistory<T>,
  entry: T,
): PaneHistory<T> {
  if (history.current?.id === entry.id) {
    return {
      ...history,
      current: entry,
    }
  }

  return {
    current: entry,
    backStack: history.current
      ? [...history.backStack, history.current]
      : [...history.backStack],
    forwardStack: [],
  }
}

export function replaceHistoryEntry<T extends HistoryEntry>(
  history: PaneHistory<T>,
  entry: T | null,
): PaneHistory<T> {
  return {
    current: entry,
    backStack: [...history.backStack],
    forwardStack: [],
  }
}

export function backHistory<T extends HistoryEntry>(
  history: PaneHistory<T>,
): PaneHistory<T> {
  if (!history.backStack.length) return history
  const nextBack = history.backStack.slice(0, -1)
  const previous = history.backStack[history.backStack.length - 1]
  return {
    current: previous,
    backStack: nextBack,
    forwardStack: history.current
      ? [history.current, ...history.forwardStack]
      : [...history.forwardStack],
  }
}

export function forwardHistory<T extends HistoryEntry>(
  history: PaneHistory<T>,
): PaneHistory<T> {
  if (!history.forwardStack.length) return history
  const [next, ...remainingForward] = history.forwardStack
  return {
    current: next,
    backStack: history.current
      ? [...history.backStack, history.current]
      : [...history.backStack],
    forwardStack: remainingForward,
  }
}

export function removeHistoryEntry<T extends HistoryEntry>(
  history: PaneHistory<T>,
  entryId: string,
): PaneHistory<T> {
  const current = history.current?.id === entryId ? null : history.current
  return {
    current,
    backStack: history.backStack.filter(entry => entry.id !== entryId),
    forwardStack: history.forwardStack.filter(entry => entry.id !== entryId),
  }
}

