# Subagents

Status: implemented. Current-state behavior is documented in
[../subagents.md](../subagents.md); this file retains the consolidated design
and implementation rationale.

A subagent is a durable Mim chat thread created by another agent. It has its
own session, transcript, model loop, tools, approvals, trace, lifecycle, and
Navigator row. The parent starts it asynchronously, continues its own work,
and later collects the result or sends more work into the same thread.

The model is deliberately close to Codex's useful semantics: threads own
context, work may run for hours, spawning is asynchronous, waits are
event-driven, steering can arrive while a turn is running, completed threads
can receive contextual follow-ups, and interruption stops the current turn
without throwing the thread away.

There is no backwards-compatibility requirement for this feature. The API and
session metadata below are the initial contract.

## Product contract

### Durable threads, not timed jobs

- A child has one persistent Mim session for its lifetime.
- A child may perform many turns. Finishing one turn does not close it.
- There is no default wall-clock deadline. A repository survey or feature
  implementation may run for minutes or hours.
- A profile step cap still protects an individual model turn. Reaching it
  leaves the thread available for `send`/`continue`; it does not delete the
  thread.
- Wait timeouts only bound the caller's long-poll. A timeout returns a
  heartbeat/status response and never cancels the child.
- A crash or shutdown marks an active turn interrupted. Its persisted
  transcript remains available for a follow-up.

### Parent/child communication

1. `spawn` creates the session, queues its first turn, and returns immediately.
2. The child writes messages and tool activity into its own session.
3. Completion publishes a durable state change and an event to the parent
   session's mailbox. It cannot inject tokens into a model call that is already
   in progress; the parent observes it through `wait`, `status`, `list`, or a
   subsequent model step.
4. `wait` returns the child's final assistant response and status. Large
   results are page-readable rather than silently lost.
5. `send` during an active turn is steering: the message is persisted and
   delivered at the next safe model-step boundary. If it arrives after the
   final boundary, Mim promotes it to a follow-up turn in the same thread.
6. `send` after a turn has finished starts a new turn in the same session, so
   the child retains its transcript and can answer a follow-up without being
   re-briefed.
7. `interrupt` aborts only the active turn. If it includes a message, Mim then
   starts a new turn in the same session using that instruction.
8. `stop` is terminal for automatic work but preserves the session. The user
   may still inspect or archive it.

The parent should delegate a bounded objective and ask for a crisp final
report: outcome, material changes, verification, and remaining blockers.
Subagents share the workspace, so parallel coding tasks should own disjoint
files or use separate worktrees when edit collisions are plausible.

## Lifecycle

The persisted states are:

```
queued -> working -> done
                  -> error
                  -> interrupted
                  -> stopped
       <-> waiting
       <-> needs-approval
```

`waiting` means the child has released an execution lease while it waits for
other children or an external event. It is not a timeout. `needs-approval`
identifies an otherwise-runnable turn paused at the normal permission gate.

Only one turn runs in a child thread at a time. Steering messages can be
queued concurrently and are consumed in order at safe step boundaries.

## Tool API

Kernel tool ids use `subagent.*`; AI/MCP names use underscores.

### `subagent.spawn`

```
{
  prompt: string
  label?: string
  model?: string                 // defaults to the parent's effective model
  agent?: string                 // defaults to the chat profile
  skills?: string[]
  tools?: string[]               // optional narrowing only
  context?: string[]             // workspace text files attached to turn one
  requestedGrants?: string[]     // request; never grants authority directly
}
-> {
  sessionId: string
  turnId: string
  status: "queued" | "working"
}
```

Spawning never waits for completion. Call `subagent.wait` when the parent has
nothing useful to do until one or more results arrive.

### `subagent.wait`

```
{
  sessionIds: string[]
  until?: "any" | "all"         // default: any
  timeoutMs?: number             // long-poll only; bounded below tool timeout
}
-> {
  timedOut: boolean
  agents: Array<{
    sessionId: string
    status: SubagentStatus
    turnId?: string
    result?: string
    resultTruncated?: boolean
    error?: string
  }>
}
```

The implementation is event-driven. A waiting subagent releases its scheduler
lease before awaiting descendants and reacquires one before resuming, so a
full worker pool cannot deadlock on children queued behind their parents.

### `subagent.send`

```
{ sessionId: string, message: string }
-> { sessionId, turnId, status, delivery: "steer" | "follow-up" }
```

### `subagent.interrupt`

```
{ sessionId: string, message?: string }
-> { sessionId, status: "interrupted" | "queued" }
```

With a message this is an interrupt-and-redirect operation; without one it
leaves the thread interrupted and idle.

### Inspection and control

- `subagent.status` returns one child's metadata and latest result summary.
- `subagent.list` returns children in the caller's task lineage, including
  uncollected completions.
- `subagent.result` reads a final response by character offset and limit.
- `subagent.stop` terminates automatic work and retains the transcript.

## Authority and approvals

Tool visibility and permission to execute are separate.

The child's effective tool surface is the intersection of:

```
workspace tool policy
∩ parent's effective profile allowlist
∩ selected child profile allowlist
∩ spawn.tools (when supplied)
```

Omitting `tools` therefore preserves the parent's effective surface; it does
not produce a new unrestricted identity. A constrained routine or mounted
agent cannot delegate around its own constraints. Package actors may not use
the subagent surface.

Every child tool call still passes through the normal security gate. The gate
receives durable lineage metadata (`rootSessionId`, `parentSessionId`, depth,
origin, and effective allowlist):

- One-shot approval applies only to the pending call.
- A denied tool call returns to the child loop and may be recovered from; it
  does not by itself make the whole thread terminal.
- "Always allow for this task" is a lineage grant shared with descendants.
- `requestedGrants` is an approval request, not model-authored authority. The
  gate or user mints the internal lineage grant.
- Routine children inherit only the routine's trusted `approvalAllow` grants.
- Remote/MCP-originated delegation retains the remote principal and transport;
  every child call must also satisfy that origin's remote grant.
- Sensitive paths, workspace read-only rules, saved browser-domain rules, and
  disabled tool settings remain hard floors and can still require a fresh
  approval or deny the call.

The approval UI attaches a request to the child session while retaining its
root lineage, so the user can see both the immediate actor and the task that
created it.

## Scheduling and limits

- Default concurrency is `min(8, available CPU cores)`; manager construction
  may override it for alternate runtimes and tests. A user-facing scheduler
  setting is not part of the initial implementation.
- Excess turns queue; they do not fail merely because the pool is full.
- Recursion is supported with configurable depth and descendant-count guards
  (initial defaults: depth 4, 64 queued/live descendants per root).
- A turn has no wall-clock limit. The existing AI/MCP call timeout only bounds
  synchronous tool calls; `subagent.wait` caps each long-poll below that limit.
- Cancellation uses abort signals at model/tool boundaries. Stopping a parent
  does not silently destroy already-spawned children; explicit `stop` owns that
  decision.

## Persistence and visibility

Each child session stores a `subagent` object containing its root and parent
session ids, depth, status, current turn id, timestamps, last activity,
effective profile/model, inbox, completion/result metadata, and error state.
The transcript remains the source of truth for prompts and answers.

Active turns are reconciled to `interrupted` during startup, matching other
agent-running records. Status and progress events are main-process events;
workspace sessions are then refreshed in the renderer.

Navigator treats child sessions as runs. A child row shows queued, working,
waiting, approval, done, interrupted, stopped, or error state and opens the
normal chat transcript. Completion participates in the existing ping system.
V1 shows live status and last tool/step activity while the final turn transcript
is committed at completion; incremental token replay is a later refinement.

## Observability

The spawn records the parent trace and session lineage. Child turns create
their own spans linked to that parent context, and every tool call keeps child
agent/turn attribution. Audit events cover spawn, queue, start, steer,
follow-up, approval pause/resume, completion, interruption, stop, and failure.
Child token usage stays on the child session and can be rolled up by lineage.

## Implementation sequence

1. Add failing contracts for lifecycle, scheduler lease release, steering and
   follow-up delivery, interruption, authority narrowing, grant inheritance,
   remote-origin preservation, reconciliation, and result paging.
2. Add the persisted session schema and the subagent manager: queue/semaphore,
   durable inbox, event waiters, turn runner, result reader, and shutdown
   reconciliation.
3. Thread delegation context and safe-boundary inbox consumption through the
   AI runtime. Compose this with the existing skill-driven `prepareStep`.
4. Register kernel, AI, and curated MCP tools with explicit schemas and policy
   metadata. Keep package actors denied.
5. Add Navigator run mapping, statuses, event refresh, open/stop behavior, and
   completion pings.
6. Update current-state docs and verify focused tests, the full test suite,
   build/type checks, and package compatibility.

## Non-goals for the first implementation

- No DAG/workflow language, dependency scheduler, automatic retries, or
  consensus primitive. The parent orchestrates with spawn/send/wait.
- No direct child-to-child authority transfer; communication routes through
  normal tool calls and durable sessions.
- No separate filesystem isolation layer. Shared-workspace conflicts are an
  orchestration concern; worktree-backed children can be added independently.
- No JSON-schema final-answer mode in V1. Durable textual results plus paging
  are the primitive; structured synthesis can be layered on later.
