# Workbench Layout

This is the coding-agent handoff for the current Navigator / Work / Artifact
layout. For product reasoning, read `workbench-navigation.md`. For migration
history and remaining work, read `workbench-implementation-plan.md`.

## Screen Shape

Mim has one workbench with three panes. Work and Artifact begin at the top of
the window; their pane headers are also draggable title-bar chrome.

```
┌────────────────────────────────────────────────────────────────────┐
│ Navigator     │ Work header                  │ Artifact header     │
│ header        ├──────────────────────────────┼─────────────────────┤
│               │ Work                         │ Artifact            │
│ 240px default │ flexible, 336px min          │ 520px default       │
└───────────────┴──────────────────────────────┴─────────────────────┘
```

Pane widths:

| Pane | Default | Range |
|---|---:|---:|
| Navigator | 240px | 180-320px, 52px collapsed rail |
| Work | remaining space | min 336px, 44px rail |
| Artifact | 520px | min 336px, viewport-clamped max, 44px rail |

The Navigator never fully unmounts. Collapsing it does not produce a separate
rail component; `ShellSidebar` itself renders either the full label tray or a
permanent 52px icon rail (`NAVIGATOR_SPINE_WIDTH` in
`services/workbench/entries.ts`). Expanded Navigator is the leftmost column
of the edge-to-edge instrument: a label tray with a top chrome collapse
button and a workspace/project row, flush to the top and left edges.
Collapsed Navigator keeps that flush relationship: the rail is a flush-left,
flush-top/bottom `--chrome-high` slab (no canvas moat), and the Work pane
melts into the rail — the Work header is `--chrome-high` with no bottom
border and the Work content below carries a `--rule-light` top/left hairline
(no rounding) that outlines the pane against the rail. Rail plus header
read as one continuous L of chrome wrapping the pane's top and left. The
bridged Work header drops its own bottom border (the content border is the
line) and pads its leading controls by `NAVIGATOR_HEADER_BRIDGE_INSET` (14px)
so the expand-sidebar button lands on the traffic lights' own 20px grid, 8px
after the zoom button (`trafficLightPosition` x=14 in `src/main/index.ts`) —
top-aligned with every other pane toggle, visually belonging to the rail.
The collapsed rail keeps a passive workspace monogram mark in place of the
picker, no internal expand button, and 1.75rem `nav-token` icons/monograms on the
same 12px left gutter as the expanded tray, so icons do not shift on toggle.
The collapsed cap height plus the workspace mark mirrors the expanded
chrome-plus-workspace-row height, keeping every row below at an identical y in
both states. The first expanded pane header owns restore: Work in the normal
case, Artifact when both Navigator and Work are collapsed — in that state the
Artifact header shows a single restore cluster `[restore sidebar][restore Work]`
so both left panes have one clear control surface, and the Work rail goes quiet
(no top restore cap) to avoid a confusing second expand icon next to the header
cluster (the rail stays clickable). Artifact starts past the lights and needs
no inset.

Work and Artifact share the same user-facing states:

| State | Meaning |
|---|---|
| Normal | Work and Artifact are both expanded. |
| Expanded | The pane is expanded and its sibling is a 44px rail. |
| Collapsed | The pane is a 44px rail that shows title/meta and restores on click. |

Pane frames are edge-to-edge: flush to the window edges with **no canvas
moat** and **no card rounding** on primary panes or rails. Depth comes from
the surface gradient (chrome tray → chrome-high header bands → surface
content) and 1px `--rule-light` hairline dividers, not from cards floating on
a canvas. The Work ↔ Artifact divider is the 6px resize handle, which is a
persistent 1px hairline spanning the pane's full height (chrome-high header
band above, surface content below; lifts to `--accent` on hover). The
Navigator ↔ Work divider is the Navigator's `border-r` (expanded) or the
bridge melt (collapsed: the rail is a flush chrome-high column, the Work
header keeps its `border-b`, and the Work content carries only the left
hairline). Railed panes carry their own `border-r` / `border-l` hairline.
Rounding survives only on genuinely floating surfaces (dialogs, popovers,
menus). Railing a pane must not unmount ordinary Work or Artifact state.

When an inner Work or Artifact surface needs a status/footer bar, use a 28px
bar with `--chrome-high` background and a `--rule-light` top border. Do not use
outer app `--chrome` inside pane content.

The Work/Artifact stage is flush to every window edge (edge-to-edge: no
chrome inset / moat). Navigator is full height; it is a chrome-high column in
both states — the same tone as the pane headers — so the collapsed rail melts
into the first pane header with no seam. Depth is carried by the surface
gradient and hairline dividers, not by panes floating on a canvas.

## Ownership

| Concern | Owner |
|---|---|
| Active Work / Artifact entries | `src/renderer/stores/workbench.ts` |
| Pane rail/normal/expanded state and widths | `workbenchStore.paneLayout` |
| Work and Artifact history | `workbenchStore` pane histories |
| Navigator run rows | `src/renderer/stores/runs.ts` |
| Physical pane slots | `components/workbench/WorkbenchShell.vue` |
| Work surface switchboard | `components/workbench/WorkHost.vue` |
| Artifact surface switchboard | `components/workbench/ArtifactHost.vue` |
| Current Navigator implementation | `components/sidebar/ShellSidebar.vue` |

`App.vue` is a compatibility adapter: it wires kernel events, bridge commands,
menus, dialogs, and host refs into the workbench store. Tested adapter logic
lives in `src/renderer/services/appShell/` (labels, shell routing, payload
guards, lifecycle/bootstrap, workspace actions, pane sizing, Work surface
launchers, shell action execution, document actions, run lifecycle, Workbench
recovery/navigation, close-tab routing, keyboard actions, and kernel event
registration/cleanup).
Keep new layout state in the store, not in new standalone `App.vue` refs.

## Pane Rules

- Navigator selects Work.
- Work opens Artifact.
- Navigator must not directly replace Artifact.
- Artifact is stable. Switching Work keeps the current Artifact open unless the
  Artifact pane is empty and the selected Work entry has a remembered Artifact.
- Work and Artifact have independent Previous / Next history.
- At least one pane must remain expanded. If all panes are railed, recover to
  expanded Work.
- Collapsed Navigator remains visible as a 52px icon rail (it is `ShellSidebar`
  at `collapsed` width, not a separate component). The rail is a flush-left,
  flush-top/bottom `--chrome-high` slab (edge-to-edge: no canvas moat)
  continuous with the first expanded pane header; the pane content below the
  header carries the hairline that outlines the pane's top and left. A
  passive workspace monogram mark replaces the project row at the same height
  budget. Fixed-height section marker rows preserve vertical rhythm: expanded
  markers show labels, collapsed markers show dividers/reserved space. The
  footer remains Settings-only and is not part of the connection.
  Work shows the expand-sidebar button (bridged past the traffic lights) when
  it is the first expanded pane; Artifact shows Navigator and Work restore when
  both left panes are collapsed. ⌘B still flips the Navigator tray.
- Collapsing Work while Artifact is railed restores Artifact, and collapsing
  Artifact while Work is railed restores Work. The visible shell should never
  intentionally present two Work/Artifact rails at once.
- Railed Work and Artifact surfaces should remain mounted or store-backed when
  railing is ordinary navigation.
- Work and Artifact headers expose the same grammar: Previous, Next, Expand or
  Restore split, and Collapse to rail.

## Navigator

`ShellSidebar.vue` currently acts as Navigator. Its intended sections are:

- workspace switcher
- header cluster: the workspace switcher and a fixed cluster of Chat, Files,
  Terminal, and Monitor rows sit flat on the chrome — no card, no container
  tint — grouped by proximity and one full-bleed `--rule-light` hairline below
  them, pinned above the scroll list. The hairline is the scroll boundary
  and darkens to `--rule` while the list is scrolled (rows visibly pass
  beneath it). Platform fixtures, not draggable, no section header. The
  cluster's paddings are rem-true equations that keep the workspace
  monogram, core tokens, and Apps marker at identical y across the ⌘B
  toggle — see the header-cluster comment in `ShellSidebar.vue` before
  changing any of them.
- Apps: enabled core apps, package launchers, and detected CLI agent
  launchers (IconRobot rows after the package launchers; shown iff the agent
  binary is installed). Agent rows are pure launchers — every click spawns a
  new agent session and opens its Work surface; they are never "active".
  Rows are manually reorderable per workspace (`navigatorAppOrder`, plain
  package/agent ids — the catalogs cannot collide). The Apps header gear
  opens Settings > Apps.
- Activity: flat mixed list of active chats, package jobs, and agent
  sessions with status. The header carries two right-aligned icon actions:
  History (opens `work:archive`) and New chat (opens the draft composer).
- footer: global settings/actions only

Apps and Activity headers collapse or expand their own section (expanded tray
only); the core surface cluster is always visible.

When the tray is collapsed to the rail, the two row kinds degrade differently:
stable **destinations** (core surface and app rows) show as their icon in the
shared left-lane token; dynamic **instances** (Activity chats/runs) show as a
1-2 char **monogram** derived from their title, with a small status dot
overlay. Monograms are keyed to content, not position, so they stay meaningful
as Activity reorders; their order matches the expanded list. Hover surfaces
the full title via the native `title`. The Activity section marker keeps the
New chat `+` token on the rail; History has no rail token (expand the tray to
reach it).

Activity rows open Work. Chat rows open chat Work; package-job rows open
`package-run` Work in `PackageRunView.vue`; agent-session rows open
`agent-session` Work in `AgentSessionView.vue` (entry id
`work:agent-session:<sessionId>`). Archive and delete intents are emitted to
`App.vue`, which updates persistence and removes matching Work history
entries. Agent-session context menus offer Kill only while the session is
live and Delete only after it has ended.

Activity rows support multi-select in the expanded tray: Cmd/Ctrl-click
toggles a row, Shift-click selects a range from the last anchor, plain click
clears the selection and navigates, Escape clears. Right-clicking inside a
multi-selection opens a batch menu (`BatchContextMenu.vue`) with Archive/
Delete over every selected row (mixed chats and runs allowed); right-clicking
outside it drops the selection and opens the normal single-row menu. Batch
actions emit the existing per-row archive/delete intents, so `App.vue`
cleanup applies per entry; batch archive includes agent sessions, while
batch delete skips live ones. Selection never changes the active Work and
does not exist on the collapsed rail.

## Work

Work contains processes, overviews, launchers, search, and run state. Current
Work hosts include chat, terminal, files, package views, package runs, agent
sessions (`AgentSessionView.vue`), and History. Package management is in
Settings > Apps, not a Work host.

Package launch screens are Work. A launched package job becomes a persisted run
and opens as `PackageRunView.vue` Work. Do not send package runs back to a
package-management surface or a launcher iframe.

A launched CLI agent becomes a persisted agent session and opens as
`AgentSessionView.vue` Work: a live terminal (`TerminalSurface.vue` bound to
the session's pty) with Kill while running, and an end-state banner with
Relaunch plus scrollback replay after it ends. The scratch Terminal fixture
(`TerminalPanel.vue`) is unrelated to agent sessions and keeps its own tabs
and spawn semantics. See [agent-sessions.md](agent-sessions.md).

## Artifact

Artifact contains durable objects/details: editor tabs, files, diffs, issue or
knowledge details, reports, and package Artifact views.

All Artifact replacement must go through the workbench store command path:

- `openArtifact`
- `replaceArtifact`
- Artifact history navigation
- `closeArtifact`
- stable empty-slot restoration
- remove-from-history

Work browsing, hover, or highlight state must not destroy a stable Artifact. Use
an explicit "Open" / "Open in Editor" / "Replace Artifact" interaction for
replacement.

## History

History is Work (`work:archive`), not Artifact. Opening History refreshes from
current renderer and main-process state. History contains active and archived
sessions, package runs, and agent sessions. Opening an archived session
restores it and hydrates messages immediately. Opening an archived package run
restores it and opens package-run Work. Opening an archived agent session
un-archives it and opens agent-session Work. Deleting acts on the fresh
history result even if the renderer session list was stale.

## Recovery And Dirty State

Failed Work activation keeps the failed Work selected for pane-local recovery
but rolls Artifact back to the pre-navigation state. Failed Artifact activation
keeps Work unchanged.

Dirty editor replacement is guarded by `ArtifactHost.vue` through
`getArtifactReplacementDecision()`, installed in `App.vue` as the workbench
store's replacement guard. The guard covers explicit opens, Artifact history,
close, stable empty restore, and active Artifact removal.

## Tests To Update With Layout Changes

Start with these before changing layout behavior:

- `src/renderer/stores/workbench.test.ts`
- `src/renderer/components/workbench/WorkbenchShell.test.ts`
- `src/renderer/components/workbench/WorkHost.test.ts`
- `src/renderer/components/workbench/ArtifactHost.test.ts`
- `src/renderer/components/sidebar/ShellSidebar.smoke.test.ts`
- `src/renderer/components/archive/ArchiveBrowser.smoke.test.ts`
- `src/renderer/components/agents/AgentSessionView.test.ts`
- `src/renderer/components/terminal/TerminalSurface.test.ts`
- `src/renderer/stores/runs.test.ts`

Run `npm run test -- workbench.test.ts WorkbenchShell.test.ts WorkHost.test.ts
ArtifactHost.test.ts ShellSidebar.smoke.test.ts ArchiveBrowser.smoke.test.ts
AgentSessionView.test.ts TerminalSurface.test.ts runs.test.ts`
for a focused pass, then `npm run build && npm run test`.
