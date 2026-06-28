export type PaneId = 'navigator' | 'work' | 'artifact'
export type PaneState = 'expanded' | 'rail'

// Collapsed Navigator rail width. While collapsed, the rail and the first
// pane header merge into one continuous chrome surface (WorkbenchShell drops
// its left gutter to 0), so the pane starts flush at x=52 and the pane's
// content card carries the border below/right of that shared chrome.
export const NAVIGATOR_SPINE_WIDTH = 52

// Extra left padding for a pane header bridged into the collapsed rail. The
// macOS traffic lights sit at x=14 on a 20px pitch (red 14, yellow 34,
// zoom 54, each 12px wide), so the expand-sidebar button lands on the next
// slot of that grid: x = 52 (rail) + 8 (header pl-2) + 14 = 74.
export const NAVIGATOR_HEADER_BRIDGE_INSET = 14

export interface WorkEntryBase {
  id: string
  kind: string
  title: string
}

export type WorkEntry =
  | (WorkEntryBase & { kind: 'chat'; sessionId: string })
  | (WorkEntryBase & { kind: 'chat-draft' })
  | (WorkEntryBase & { kind: 'terminal'; terminalGroupId?: string })
  | (WorkEntryBase & { kind: 'files'; query?: string })
  | (WorkEntryBase & { kind: 'activity-trust' })
  | (WorkEntryBase & { kind: 'archive' })
  | (WorkEntryBase & { kind: 'package-run'; packageId: string; runId: string })
  | (WorkEntryBase & { kind: 'package-view'; packageId: string; viewId: string })
  | (WorkEntryBase & { kind: 'agent-session'; agentId: string; sessionId: string })

export interface ArtifactEntryBase {
  id: string
  kind: string
  title: string
}

export type ArtifactEntry =
  | (ArtifactEntryBase & { kind: 'file'; path: string })
  | (ArtifactEntryBase & { kind: 'editor' })
  | (ArtifactEntryBase & { kind: 'external-record'; source: string; recordId: string })

export interface PaneConfig {
  state: PaneState
  width: number
}

export type PaneLayout = Record<PaneId, PaneConfig>

export function fileArtifactEntry(path: string): ArtifactEntry {
  return {
    id: `file:${path}`,
    kind: 'file',
    title: basename(path),
    path,
  }
}

export function editorArtifactEntry(): ArtifactEntry {
  return {
    id: 'artifact:editor',
    kind: 'editor',
    title: 'Editor',
  }
}

export function terminalWorkEntry(): WorkEntry {
  return {
    id: 'work:terminal',
    kind: 'terminal',
    title: 'Terminal',
  }
}

export function chatWorkEntry(sessionId: string, title = 'Chat'): WorkEntry {
  return {
    id: `work:chat:${sessionId}`,
    kind: 'chat',
    title,
    sessionId,
  }
}

export function chatDraftWorkEntry(): WorkEntry {
  return {
    id: 'work:chat:new',
    kind: 'chat-draft',
    title: 'Chat',
  }
}

export function filesWorkEntry(query = ''): WorkEntry {
  return {
    id: 'work:files',
    kind: 'files',
    title: 'Files',
    query,
  }
}

export function activityTrustWorkEntry(): WorkEntry {
  return {
    id: 'work:activity-trust',
    kind: 'activity-trust',
    title: 'Monitor',
  }
}

export function archiveWorkEntry(): WorkEntry {
  return {
    id: 'work:archive',
    kind: 'archive',
    title: 'History',
  }
}

export function packageViewWorkEntry(packageId: string, title: string, viewId = 'main'): WorkEntry {
  return {
    id: `work:package-view:${packageId}:${viewId}`,
    kind: 'package-view',
    title,
    packageId,
    viewId,
  }
}

export function packageRunWorkEntry(
  packageId: string,
  runId: string,
  title = `${packageId} run`,
): WorkEntry {
  return {
    id: `work:package-run:${packageId}:${runId}`,
    kind: 'package-run',
    title,
    packageId,
    runId,
  }
}

// Identity is the session id alone — session ids are globally unique, so the
// agent id rides along as metadata for the view (icon, resume).
export function agentSessionWorkEntry(agentId: string, sessionId: string, title: string): WorkEntry {
  return {
    id: `work:agent-session:${sessionId}`,
    kind: 'agent-session',
    title,
    agentId,
    sessionId,
  }
}

function basename(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, '')
  return trimmed.split(/[/\\]/).pop() || path
}
