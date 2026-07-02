export interface ComposerAtItem {
  type: string
  id: string
  label: string
  desc?: string
  group?: string
  path?: string
  mediaType?: string | null
  packageName?: string
}

export interface ContextChip {
  type: string
  id: string
  label: string
  desc?: string
  path?: string
  mediaType?: string | null
  packageName?: string
}

export interface ComposerContextSources {
  skills?: Array<{ id: string; name?: string; label?: string; desc?: string; description?: string; packageName?: string }>
  projectFiles?: Array<{ path: string; name?: string; mediaType?: string | null }>
  packageTools?: Array<{ id?: string; name: string; label?: string; description?: string; packageName?: string }>
  hasDocument?: boolean
  documentName?: string
}

export function buildAtItems(sources: ComposerContextSources = {}): ComposerAtItem[] {
  const items: ComposerAtItem[] = []

  for (const skill of sources.skills || []) {
    const label = skill.label || skill.name || skill.id
    if (!skill.id || !label) continue
    items.push({
      type: 'skill',
      id: skill.id,
      label,
      desc: skill.desc || skill.description,
      group: 'Skills',
      packageName: skill.packageName,
    })
  }

  if (sources.hasDocument) {
    items.push({
      type: 'document',
      id: 'current-document',
      label: sources.documentName || 'Current document',
      desc: 'Open editor document',
      group: 'Document',
    })
  }

  for (const file of sources.projectFiles || []) {
    if (!file.path) continue
    const label = file.name || file.path.split('/').pop() || file.path
    items.push({
      type: 'project-file',
      id: file.path,
      label,
      desc: file.path,
      path: file.path,
      mediaType: file.mediaType,
      group: 'Files',
    })
  }

  for (const packageTool of sources.packageTools || []) {
    const id = packageTool.id || packageTool.name
    const label = packageTool.label || packageTool.name
    if (!id || !label) continue
    items.push({
      type: 'package-tool',
      id,
      label,
      desc: packageTool.description,
      group: 'Tools',
      packageName: packageTool.packageName,
    })
  }

  return items
}

export function canSendMessage({
  canSend,
  disabled,
  busy,
  draft,
  attachments,
  contextChips,
  showAtDropdown,
}: {
  canSend: boolean
  disabled?: boolean
  busy: boolean
  draft: string
  attachments: unknown[]
  contextChips: unknown[]
  showAtDropdown: boolean
}) {
  if (showAtDropdown) return false
  return Boolean(canSend) && !disabled && !busy && (
    draft.trim().length > 0 ||
    attachments.length > 0 ||
    contextChips.length > 0
  )
}

export function getAtMentionState(text: string, cursorPos: number) {
  const before = text.slice(0, cursorPos)
  const atIndex = before.lastIndexOf('@')
  if (atIndex < 0) return { active: false, query: '', atIndex: -1 }
  if (atIndex > 0 && !/\s/.test(before[atIndex - 1])) {
    return { active: false, query: '', atIndex }
  }

  const query = before.slice(atIndex + 1)
  if (/\s/.test(query)) return { active: false, query: '', atIndex }
  return { active: true, query: query.toLowerCase(), atIndex }
}

export function filterAtItems(
  query: string,
  active: boolean,
  items: ComposerAtItem[],
) {
  if (!active) return []
  if (!query) return items
  const needle = query.toLowerCase()
  return items.filter(item =>
    item.label.toLowerCase().includes(needle) ||
    Boolean(item.desc && item.desc.toLowerCase().includes(needle)) ||
    Boolean(item.path && item.path.toLowerCase().includes(needle)) ||
    Boolean(item.packageName && item.packageName.toLowerCase().includes(needle))
  )
}

export function removeAtMention(text: string, cursorPos: number) {
  const before = text.slice(0, cursorPos)
  const atIndex = before.lastIndexOf('@')
  if (atIndex < 0) {
    return { text, cursorPos, removed: false }
  }

  return {
    text: text.slice(0, atIndex) + text.slice(cursorPos),
    cursorPos: atIndex,
    removed: true,
  }
}

export function upsertContextChip(chips: ContextChip[], item: ComposerAtItem) {
  if (chips.some(chip => chip.type === item.type && chip.id === item.id)) {
    return chips
  }

  const nextChip = {
    type: item.type,
    id: item.id,
    label: item.label,
    ...(item.desc ? { desc: item.desc } : {}),
    ...(item.path ? { path: item.path } : {}),
    ...(item.mediaType ? { mediaType: item.mediaType } : {}),
    ...(item.packageName ? { packageName: item.packageName } : {}),
  }

  return [...chips, nextChip]
}

export function projectFileContextAttachment(
  chip: ContextChip,
  content: string,
  mediaType: string,
) {
  const path = chip.path || chip.id
  return {
    filename: chip.label || path.split('/').pop() || path,
    path,
    mediaType,
    content,
    type: 'text',
    size: textByteSize(content),
    _contextChipId: chip.id,
  }
}

export function documentContextAttachment(
  chip: ContextChip,
  document: { name?: string; path?: string; content?: string },
  mediaType: string,
) {
  const filename = document.name || document.path?.split('/').pop() || 'current-document.md'
  const content = document.content || ''
  return {
    filename,
    ...(document.path ? { path: document.path } : {}),
    mediaType,
    content,
    type: 'text',
    size: textByteSize(content),
    _contextChipId: chip.id,
  }
}

function textByteSize(text: string): number {
  return new TextEncoder().encode(text).byteLength
}

export function groupAtItems(items: ComposerAtItem[]) {
  const groups: Array<{ label: string; items: ComposerAtItem[] }> = []
  for (const item of items) {
    const label = item.group || 'Context'
    let group = groups.find(g => g.label === label)
    if (!group) {
      group = { label, items: [] }
      groups.push(group)
    }
    group.items.push(item)
  }
  return groups
}

export function modelSupportsVision(model: { capabilities?: { vision?: boolean } } | null | undefined) {
  return Boolean(model?.capabilities?.vision)
}
