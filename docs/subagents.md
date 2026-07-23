# Subagents

Subagents are durable Mim chat threads created by another agent. A child owns
its session, transcript, model loop, tools, approvals, trace attribution, and
Navigator row. The parent can start several children without blocking, keep
working, wait for results, steer active turns, and send contextual follow-ups
after a turn completes.

## Runtime model

`createSubagentManager()` owns the scheduler and active-turn registry. It is
created once by both Electron and the headless kernel and registered through
`src/main/tools/subagents.ts`.

- `spawn` persists a child session and queues its first turn before returning.
- There is no child wall-clock deadline. The pool limits concurrent turns to
`min(8, available CPU cores)`; excess turns remain queued. The manager accepts
explicit concurrency/depth/descendant caps at construction for tests and
alternate runtimes; there is no user-facing scheduler setting yet.
- Recursion is supported to depth 4, with at most 64 queued or active
  descendants in one root lineage.
- `wait` is an event-driven long-poll. Its timeout is capped at 240 seconds and
  only returns control to the caller; it never cancels a child.
- A child waiting for descendants releases its scheduler lease, preventing a
  full pool from deadlocking on work queued behind waiting parents.
- One turn runs in a child session at a time. A completed session remains
  available for later follow-up turns.
- Shutdown and workspace changes interrupt active turns and retain their
  transcripts. Startup reconciles persisted active states to `interrupted`.

The persisted lifecycle is `queued`, `working`, `waiting`, `needs-approval`,
`done`, `error`, `interrupted`, or `stopped`.

## Communication

The kernel/AI/MCP surface is:

| Tool | Purpose |
|---|---|
| `subagent.spawn` | Create and queue a child thread; always returns immediately. |
| `subagent.wait` | Wait for any/all selected children to settle or for a long-poll timeout. |
| `subagent.send` | Queue steering during an active turn or start a contextual follow-up turn. |
| `subagent.interrupt` | Abort the active turn; an optional message redirects the same thread. |
| `subagent.stop` | Stop automatic work while retaining the session. |
| `subagent.status` | Read one child status and bounded result summary. |
| `subagent.list` | List children in the caller's root task lineage. |
| `subagent.result` | Page through a large final response by character offset. |

Steering messages are stored in the child's durable inbox. The AI runtime
consumes them between model steps and commits them into the finished
transcript. If steering arrives after the final safe model boundary, the
manager automatically carries it into a follow-up turn rather than stranding
it. A result cannot be injected into a parent model call that is already
executing; the parent observes completions through `wait`, `status`, `list`,
or its next tool step.

The final response summary is bounded to 24,000 characters in status/wait
results. This is a transport bound, not a worker output limit: the entire
response remains in the session and `subagent.result` pages it without loss.

## Authority

Tool visibility is separate from execution permission. A child's visible tool
surface is the intersection of the parent profile, selected child profile, an
optional `spawn.tools` narrowing, and the workspace tool policy. The security
gate enforces the effective allowlist again on every child call.

Every child call is still `actor: "ai"`. Trusted delegation metadata carries
the root/parent session ids, depth, model/profile, effective tool allowlist,
approval grants, and original remote identity.

- One-shot approvals stay one-shot.
- Resolving or denying one tool approval resumes the child loop; the manager
  marks the thread `error` only if the turn itself ultimately fails.
- Interrupt/stop/workspace shutdown cancels any pending approval promise before
  aborting the turn, so an approval pause cannot keep a stopped child alive.
- “Always allow” is keyed to the root task lineage and is shared by descendants.
- `requestedGrants` causes a real approval request; model input never mints a
  grant directly.
- Routine children inherit only the routine's trusted grants.
- Sensitive/outside-Project path floors, Team mount protection, saved-browser
  domain rules, and disabled tool settings continue to win.
- App/package actors are hard-denied from all `subagent.*` tools.

Normal mode does not prompt merely to create, inspect, steer, wait for, or stop
a child. A spawn that requests additional grants does prompt. Strict mode still
prompts according to its normal rule.

## Sessions, Navigator, and traces

Child metadata is stored under `session.subagent` and copied into the session
manifest, so `session.list` can build Navigator rows without loading message
bodies. The Navigator renders children as `subagent` runs, opens them through
the normal chat surface, shows lifecycle status, supports stop/archive/delete,
and participates in Ping when done.

Main emits `subagent:event` to the primary renderer on lifecycle/activity
changes (and to connected headless clients through their own event transport).
The renderer refreshes that session from disk. Status and last-step/tool
activity are live; the AI SDK commits the complete assistant/tool transcript
when the turn finishes rather than persisting every streamed token.

Trace events cover spawn, start, steering, follow-up, completion, interruption,
and stop. Child tool spans carry root/parent/depth attribution and nest under
the parent trace when the parent turn supplies one.

## Project filesystem

Children use the same workspace filesystem as their parent. Parallel research
is naturally safe; parallel edits should be partitioned by file ownership or
run in separate worktrees when collisions are plausible.

## Source map

- Scheduler/lifecycle: `src/main/subagents/subagentManager.ts`
- Persisted types: `src/main/subagents/types.ts`
- Kernel tools: `src/main/tools/subagents.ts`
- AI tools and safe-boundary steering: `src/main/ai/aiRuntime.ts`
- Authority and lineage grants: `src/main/security/gate.ts`
- Session storage: `src/main/sessions.ts`, `src/main/sessionManifest.ts`
- MCP catalog: `src/main/server/server.ts`
- Navigator mapping/events: `src/renderer/stores/runs.ts`,
  `src/renderer/services/appShell/kernelEvents.ts`,
  `src/renderer/components/sidebar/ShellSidebar.vue`
