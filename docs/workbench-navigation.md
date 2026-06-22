# Workbench Navigation

This document records the shell navigation decision for the next layout pass.
It is product/UX source of truth, not an implementation report.

## Decision

Mim has one workbench with three panes:

```
┌────────────────────────────────────────────────────────────────────┐
│ Navigator     │ Work header                  │ Artifact header     │
│ header        ├──────────────────────────────┼─────────────────────┤
│ Navigator     │ Work                         │ Artifact            │
│ 240px         │ flexible, 336px min          │ 520px               │
└───────────────┴──────────────────────────────┴─────────────────────┘
```

The panes mean:

| Pane | Default width | Role |
|---|---:|---|
| Navigator | 240px | What work exists, where it is, and what state it is in |
| Work | remaining space | Processes, overviews, steering, search, configuration, run transcripts |
| Artifact | 520px | Document stage and selected durable object: text/PDF/file-card tabs, issue detail, diff, report, table |

Resizable ranges:

| Pane | Expanded range | Collapsed rail |
|---|---:|---:|
| Navigator | 180-320px | 52px |
| Work | min 336px | 44px |
| Artifact | min 336px; viewport-clamped to leave Work at min width | 44px |

Navigator stays full height. When collapsed, it remains a 52px rail. The first
expanded pane header owns the restore affordance and any macOS traffic-light
inset that the thinner rail cannot provide. Work and Artifact sit inside a
chrome inset, 4px horizontally, 8px at the top, and 10px at the bottom, so their
5px pane radius reads without introducing shadows or card-like elevation.

## Core Model

Apps are capabilities, not destinations. An app can create or expose work,
artifacts, or both.

```
App = capability
Run = user-facing process/work object
Artifact = selected material/output/detail
```

Navigator controls Work. It does not directly control Artifact.

Work controls Artifact. Selecting or opening something inside Work can place a
durable object in Artifact. Navigator changes should not silently replace a
useful Artifact.

Examples:

| Thing | Pane |
|---|---|
| Issues overview | Work |
| Issue #2 detail | Artifact |
| Knowledge base overview | Work |
| Knowledge entry #3 | Artifact |
| Workflow launch config | Work |
| Running workflow transcript/status | Work |
| Workflow output/diff/report | Artifact |
| CLI agent launcher row (Claude Code, Codex, Gemini CLI) | Navigator (Apps) |
| Agent session (launched CLI agent, live terminal or replay) | Work |
| Time-aware file browser/search/recent/changed flow | Work |
| Opened document | Artifact document tab |

## Runs And Status

Chats and workflows do not become artifacts when they complete. They remain
runs.

A run has three possible surfaces:

| Surface | Pane |
|---|---|
| Status row | Navigator |
| Process/transcript/input/approval view | Work |
| Output/report/diff/exportable record | Artifact |

Navigator must show run status for chats, workflow agents, app jobs,
agent sessions, and other long-running work:

- Working
- Needs input
- Needs approval
- Ready to review
- Done
- Error
- Paused

Selecting a run in Navigator opens the run in Work. If the run has an output,
the output may appear in Artifact through the artifact persistence rules below.

Agent sessions follow the same grammar. A detected CLI coding agent is a
capability — a launcher row in Apps, where every click spawns a new session.
Launcher rows are opt-in: detection alone shows nothing; the user enables
agents per workspace in Settings → Agents (`enabledAgents`
setting, see [agent-sessions.md](agent-sessions.md)).
The launched session is the run: it gets an Activity row with status
(working / needs-input / done / cancelled / error), an `agent-session` Work
surface, rename/archive/kill, and History membership. The terminal is never
the activity — the agent session is; the terminal is its rendering surface,
the way ChatView renders a chat run. Scratch Terminal tabs remain a fixed
fixture with zero ceremony and no Activity rows, and manually typing an
agent command in a scratch tab is not promoted into a session. Launch and
kill are user actions only; the AI cannot start or stop agent sessions.

## Artifact Persistence

Artifact is stable by default.

```
Navigator selects Work.
Work can open Artifact.
Artifact persists across Work changes.
```

This means a user can keep an issue, file, diff, report, or KB entry open while
checking a different run or overview in Work.

The Artifact pane's document host is one tab strip for text, PDF, and file-card
documents. Opening a markdown/text file, a PDF, or an unsupported/native file
from Work adds or activates a document tab inside that host. PDF and file-card
documents do not create separate Artifact history entries; they are tabs in the
document stage. Text tabs own CodeMirror state, undo history, dirty tracking,
autosave, comments, citations, and export. PDF and file-card tabs are path-only
views and are never dirty.

The maintained implementation contract for this host is
[document-pane.md](document-pane.md). In particular, the CodeMirror mount point
stays mounted while the document stage is empty; the empty state hides the
editor body rather than removing it, so reopening after closing the last tab
never reuses a detached editor view.

Closing the last document tab leaves the document stage empty and collapses the
Artifact pane to its rail. Restoring the pane shows the explicit empty state
with New document and Open file actions; no blank Untitled document is fabricated
on mount or last close.

Each Work context may still remember its last opened artifact slot.

Examples of Work contexts:

- active chat/run
- issues overview
- knowledge base overview
- file browser/search
- workflow launch config
- app manager or app workflow view

The Artifact pane is stable: Artifact remains open when Navigator changes Work.

### When Navigator Changes Work

1. User selects a row/place/run in Navigator.
2. Work changes to that context.
3. Artifact remains exactly as it was.
4. If Artifact is empty and the new Work context has a current artifact slot, Artifact may restore it.

So the right side is not tied to the left sidebar. It changes when Work opens or
selects an artifact, or when an empty Artifact pane restores the selected Work
context's remembered artifact.

### When Work Changes Artifact

Inside Work, there are two kinds of interaction:

| Interaction | Artifact behavior |
|---|---|
| Browse/highlight selection | Does not replace a stable Artifact |
| Open item / Open in Editor / Replace Artifact | Replaces Artifact because the user directly requested it |

The UI should make this distinction clear. Browsing a list, kanban board, file
search, or run output should not unexpectedly destroy a stable artifact unless
the interaction clearly means "show this on the right."

## Independent History

Work and Artifact each have their own full back/forward history.

| Pane | History entries |
|---|---|
| Work | places, runs, chats, workflows, app overviews, searches, terminal context |
| Artifact | editor-backed file slots, issues, KB entries, diffs, reports, exportable run records |

Each pane header should expose local controls:

```
Work      [<] [>]   Current work title
Artifact  [<] [>]   Current artifact title
```

The two histories are independent:

- Work Back changes only Work.
- Work Forward changes only Work.
- Artifact Back changes only Artifact.
- Artifact Forward changes only Artifact.
- Navigating Work never clears Artifact history.
- Opening a new Artifact from Work appends to Artifact history.
- Opening a PDF or file-card document adds a document tab and does not append to Artifact history.
- Opening a new Work item from Navigator appends to Work history.

History entries must store enough information to recover intent, not just raw
component state:

| Entry kind | Required recovery data |
|---|---|
| Work entry | kind, title, source app if any, run id or place id, query/filter state, last known status |
| Artifact entry | kind, title, source Work id if any, path/id/version if any, dirty state if editable |

## Recovery UX

History must fail well. A broken entry should never blank the whole workbench.

If a Work history entry cannot restore:

1. Show an inline recovery state in Work.
2. Keep Artifact unchanged.
3. Explain what failed in plain language.
4. Offer relevant actions: Retry, Go Back, Open parent place, Remove from history, View details.
5. If the entry is a run, keep its row in Navigator with Error or Missing status.

If an Artifact history entry cannot restore:

1. Show an inline recovery state in Artifact.
2. Keep Work unchanged.
3. Preserve the failed history entry so Back/Forward still makes sense.
4. Offer relevant actions: Retry, Locate file/object, Open containing Work, Remove from history.
5. If an editable artifact had unsaved state, expose recovery before replacing it.

Examples:

| Failure | Artifact/Work behavior |
|---|---|
| File deleted | Artifact shows "File no longer exists" with Locate, Remove from history, Go Back |
| App disabled | Work or Artifact shows app-disabled recovery with Enable app and Go Back |
| Run data missing | Work shows missing-run recovery; Navigator row shows Error/Missing |
| Permission denied | Pane shows permission recovery and the action that needs approval |
| Artifact renderer crashed | Artifact offers Reload artifact, Go Back, View details |
| Dirty editor would be replaced | Ask before replacement; Back/Forward must not discard changes silently |

## Navigation Contract

The sidebar is not a right-panel tab switcher. It is a work navigator.

Navigator should contain:

- workspace switcher
- header cluster: the workspace switcher plus a fixed cluster of Chat, Files,
  Review, and Terminal, flat on the chrome and pinned above one full-bleed
  hairline where the scroll list begins. Platform fixtures, not
  draggable. Chat opens a sessionless draft composer and creates the real
  chat row only on first send; from an open session, New chat is the Work
  pane header action plus Cmd+N.
- Apps: enabled core apps such as Board or Knowledge, user app launchers,
  and detected CLI agent launchers (Claude Code, Codex, Gemini CLI — visible
  iff installed on this machine; clicking one launches a new agent session).
  Rows are manually reorderable per workspace. The Apps header gear opens
  the Apps surface.
- Activity: one flat list for active chats, agent sessions, app jobs,
  approvals, and review states. Activity rows show status, open Work, and can
  be manually reordered by drag and drop. Chat, app-run, and
  agent-session rows can be renamed inline. New unordered activity appears at
  the top. The Activity header carries right-aligned History and New chat
  icon actions. Rows multi-select with Cmd/Ctrl-click and Shift-click for
  batch archive/delete from the context menu; plain click or Escape clears
  the selection.
- History opens Work for active and archived chats, app runs, and agent
  sessions from the Activity header icon.
- Apps and Activity headers are clickable collapse/expand controls.
- footer controls only for global actions such as Settings

Work should contain:

- the active run transcript or chat
- agent session views (live terminal or scrollback replay)
- terminal
- workflow config and launch forms
- issue/KB/file overviews
- search and open flows
- controls that select or open artifacts

Artifact should contain:

- one document tab strip for text, PDF, and file-card documents
- document diffs
- issue details
- KB entries
- generated reports
- exportable run records when explicitly opened as artifacts

## Required Affordances

- Pane controls use the same grammar: resize where applicable, collapse to
  rail, expand, and restore split.
- Collapsed panes become rails, not invisible hidden state. Navigator restore
  belongs in the Navigator rail, not in Work or Artifact headers.
- If one of Work or Artifact is already a rail, collapsing the other restores
  the railed sibling rather than showing two collapsed rails.
- Work views that can open artifacts use consistent commands and iconography.
- Run status is visible in Navigator even when another Work context is active.
- Selecting a completed chat/workflow in Navigator reopens it in Work, not Artifact.
- Outputs from completed runs open in Artifact from within the run view.
- Work and Artifact have independent Back/Forward controls and error-robust recovery states.
