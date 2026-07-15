# Mim Serve Status Snapshot

Generated: 2026-07-14 17:39:58 CEST

Source plan: [docs/proposals/mim-serve.md](proposals/mim-serve.md).

This document is a timestamped reconciliation of the current `mim serve`
work. It is meant to answer "where are we?" without rereading the whole
proposal thread. It describes the current working tree, not a released build.

## Executive State

The core direction is still sound: `mim serve` is the same Mim kernel running
headless, exposing team-owned tools and state over authenticated MCP HTTP. The
important product correction has landed in code: accepting an invite creates a
user-level connection, and linking a local folder is a separate action.

The feature is not ready for ordinary installed-app users. The remaining risk
is no longer "invite rewrites a random open folder"; it is "linking a mature
local folder can still hide local Board/Knowledge/References state because the
link flow does not yet inventory local state or ask what to do with it."

The working tree is heavily uncommitted and includes unrelated work. Treat any
status below as implementation snapshot, not stable release state.

## What Happened

Two assessment threads are easy to confuse:

- The broad security/product review of the original proposal identified the
  executable-workspace deny floor, SSRF blocking, write serialization,
  structured-state migration, backups, denial UX, token ergonomics, version
  skew, operator deployment realism, and cost/session attribution.
- The later product-model correction focused on one specific flaw: invite
  redemption was binding the current local folder to a remote team space.

The later correction has been implemented. The broader review has been partly
implemented across the proposal and code, but several product and operational
items remain.

## Implemented

### Serve Foundations

The proposal records Phase 0 and the runtime part of Phase 1 as substantially
implemented:

- serve-mode route restrictions and authenticated MCP HTTP routes
- issued caller tokens and single-use invite records
- remote actor attribution and caller/principal trace attribution
- executable/prompt-bearing and sensitive path deny floors for remote writes
- SSRF blocking for serve-mode URL fetches
- denied-request ledger
- ready-to-paste token snippets for common clients
- app/named-tool write serialization foundations
- structured-state migration helpers
- backup/restore helpers
- MCP `notifications/tools/list_changed` event push
- version/capability warnings during remote tool mount

These items are the server-side prerequisites that make the idea more than a
demo.

### Invite Connect Versus Folder Link

The product-model correction is implemented in the current working tree:

- `joinSharedWorkspaceFromInvite()` no longer writes to the open workspace.
- User-level team-space connections are stored in
  `~/.mim/shared-workspaces.json`.
- Bearer tokens remain in `~/.mim/keys.env`.
- Joining can work without a folder open because `workspacePath` is no longer
  required.
- The connection store is a list, so multiple team-space connections are
  supported structurally.
- A new explicit `workspace.sharedWorkspace.link` action writes the personal
  folder link.
- New folder links live in `.mim/shared-workspace.json`.
- Existing `mim.yaml sharedWorkspace` entries are still read as a
  compatibility path, but new invite joins do not write them.
- Remote tool mounting now follows the explicit folder link, not the invite
  redemption.
- Settings distinguishes `Local only`, `Connection ready`, and `Connected`,
  and shows a separate `Link this folder` action.

This resolves the most dangerous user-model bug: pasting an invite no longer
silently changes the meaning of the currently open folder.

## Not Implemented Yet

### Link-Time Safety

This is now the main blocker.

The link tool currently writes the folder link unconditionally. It does not
inspect existing local `issues/`, `knowledge/`, or `references/` state before
linking. It does not ask whether the user wants to keep local state, use team
state, or import first. A mature local Board or Knowledge base can therefore
still appear to go dark after linking.

The plan already names this as required before Phase 2 is product-complete.

### Domain Selection

The current link adopts the connection's full namespace list. There is not yet
a domain-by-domain choice such as "use Team Board here, keep local Knowledge
here." The plan calls for explicit selected domains; the implementation is not
there yet.

### Import And Merge

Import is not implemented. There is no reviewed copy flow for moving local
issues, knowledge, or references into the team space with collision reporting.
Connection and linking are separate from import by design, but import is
required before this can be safe for established local projects.

### Revocation And Stale Connection Honesty

Token records can be revoked, and local WebSocket MCP tokens have a close path,
but the desktop connection status still mainly reports whether a token exists.
It does not prove the remote token still works. A revoked or stale team-space
connection can still look locally configured until mount/sync fails.

HTTP `/mcp/events` streams are tracked globally in the server, not as a
clearly caller-token-scoped revocation surface. Recheck this before claiming
"revocation closes every active session" for serve-mode HTTP.

### Per-Token MCP Rate Limiting

`/join` has tokenless rate limiting. A per-token rate limit for authenticated
`/mcp` calls was not found in the current server search. This still matters for
a public or semi-public team-space host.

### User-Facing Onboarding

The installed-app user still needs a plain path:

- I opened a folder. Am I done?
- I received an invite. What changes if I connect?
- This folder is linked. Which tools write locally and which write to the
  team space?
- I already have local issues and knowledge. What happens to them?

The Settings copy is better after the connect/link split, but the broader
onboarding and Phase 2.5 acceptance gate are not done.

### Later Phases

Phase 3 mim-web issued identity is not implemented.

Phase 4 unattended server-hosted agent runs are not implemented. The proposal
correctly treats remote session visibility in desktop History as a hard UX
requirement before that phase feels complete.

## Current Practical Test

The useful manual test today is the connect/link split:

1. Run Mim from this working tree.
2. Open a throwaway local folder.
3. Paste a serve invite in Settings > Workspace.
4. Click `Connect`.
5. Confirm `mim.yaml` did not change and `.mim/shared-workspace.json` does not
   exist yet.
6. Click `Link this folder`.
7. Confirm `.mim/shared-workspace.json` exists and Settings shows `Connected`.

Do not use a mature local project as the first test case yet, because
link-time inventory/import is still missing.

## Current Next Work

1. Split and commit the working tree into coherent chunks so the serve reset
   is reviewable.
2. Add link-time local-state inventory for `issues/`, `knowledge/`, and
   `references/`.
3. Add domain selection to the folder link flow.
4. Add stale/revoked connection status that checks the remote, not just local
   token presence.
5. Add or verify per-token `/mcp` rate limiting for serve mode.
6. Then implement import/merge with collision reporting.

## Status Relative To The Plan

The plan document is broadly current. Its most important status statement is:

- connect/link separation is implemented at the plumbing level
- import/merge, domain-by-domain choices, stale/revoked handling, and Phase 2.5
  user acceptance remain open

That is the correct framing. The project is past the architecture correction,
but not past the safety UX needed for real users with existing local Mim data.
