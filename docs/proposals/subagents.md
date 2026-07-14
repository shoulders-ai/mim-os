# Subagents

Status: proposal. Nothing implemented.

A **Subagent** is a run the agent starts itself: a real, headless chat session
spawned mid-turn to pursue a delegated task, with its own transcript, its own
tool loop, and its own row in the Navigator. The parent agent can fire several
in parallel, keep working while they run, await their results, and send
follow-up messages into a child that keeps its context.

The bet: delegation is the next capability step after automation. Routines
gave Mim standing prompts that fire without a human; subagents give the agent
the same power the human has — "start a run, watch it, collect the result."
Everything hard about this (headless turns, gated tools, session persistence,
Navigator visibility, tracing, approval grants) was already built for
routines. Subagents are a thin composition of those parts, not a new engine.

Design stance: **maximum capability, same accountability.** The child is a
first-class agent — full tool surface, any model, no output truncation, no
artificial turn budget, recursion allowed. What keeps this safe is not
crippling the child but running it through the exact same permission gate,
trace stream, and session persistence as every other run. A subagent is never
a weaker agent; it is another agent, visible in the same places.

## Context

- **The loop is already renderer-free.** `streamProfileResponse`
  (`src/main/ai/aiRuntime.ts`) runs the full tool loop in the main process.
  Routines prove it end-to-end: `startRoutineRun`
  (`src/main/tools/routines.ts`) does `session.create` → prompt message →
  `streamProfileResponse` → drain → status update, with trace spans and
  Navigator rows. A subagent run is this exact code path with a different
  parent.
- **Profiles are mountable.** `AgentProfile` + `agentMounts.resolveProfile`
  already let a run adopt an app-defined agent (instructions, tool
  allowlist, pre-activated skills). A subagent can mount any of them.
- **The gate already understands non-interactive runs.** Routine runs carry
  `ctx.routine` with `approvalAllow` grants; ungranted calls surface in the
  approvals queue attached to the run's session. The same mechanism serves
  children.
- **Sessions already carry run metadata.** `routineStatus`/`routineRunId` on
  sessions drive Navigator run rows and ping-when-done. Children reuse the
  same pattern with a `parentSessionId`.

## Tools

Kernel namespace `subagent.*` (`agent.*` is taken by CLI agent sessions).
AI keys `subagent_*`; exposed over MCP under the same names so CLI agents
(Claude Code, Codex, Gemini — all equally) can farm work to Mim-native
subagents.

### `subagent.spawn`

```
{
  prompt: string            // the task, verbatim — the child's first user message
  label?: string            // Navigator label; auto-generated from prompt if omitted
  model?: string            // any catalog model id; default: parent's model
  agent?: string            // mounted AgentProfile id; default: chat profile
  skills?: string[]         // pre-activated skills
  tools?: string[]          // optional allowlist to NARROW the surface; omit for full chat toolset
  context?: string[]        // workspace paths whose contents are injected into the first message
  schema?: object           // optional JSON Schema; forces the child's final answer through
                            // structured output and returns the validated object
  approvalAllow?: string[]  // routine-style grants for headless contexts
  wait?: boolean            // default false: return immediately; true: block until done
}
→ { sessionId, status }     // plus { result, usage } when wait: true
```

### `subagent.wait`

`{ sessionId | sessionIds[], timeoutMs? }` → per-child
`{ sessionId, status, result, usage }`. `result` is the child's **full final
assistant message** (or the schema-validated object) — exempt from
`MAX_TOOL_OUTPUT_CHARS`. The final message is the product the parent asked
for; truncating it defeats the tool. The parent controls verbosity through
the prompt, and the full transcript stays one `session.get` away. Waiting on
a child with a pending approval returns `status: 'blocked'` plus the pending
request, so the parent can report instead of hanging.

### `subagent.send`

`{ sessionId, message, wait? }` — append a user-role message to a finished
child and run another turn **with its context intact**. This is what makes
children durable workers instead of one-shot function calls: spawn a
researcher, read its answer, ask the follow-up without re-explaining.

### `subagent.status` / `subagent.list` / `subagent.stop`

Poll one child, list this session's children with statuses, abort a run
(child session keeps its partial transcript; nothing is deleted).

## Capability decisions

- **Full tool surface by default.** The child sees the same policy-filtered
  chat toolset as the parent — files, shell, web, integrations, app tools.
  `tools`/`agent` narrow it only when the caller chooses to. No special
  reduced "subagent mode".
- **No output caps, no turn caps beyond the profile's.** Chat profile
  `stepCap: 100` applies as it does everywhere. No token ceiling, no
  transcript truncation, no "3 turns max".
- **Recursion allowed.** Children can spawn children. `ToolContext` grows
  `subagent: { parentSessionId, rootSessionId, depth }`; a configurable
  max depth (settings, default 4) exists purely as a runaway-loop guard, not
  a capability statement. Concurrency runs through a small pool
  (default `min(8, cores)`, configurable); excess spawns queue rather than
  fail.
- **Approvals: same gate, inherited grants.** Children run `actor: 'ai'`
  through the unchanged permission gate. The parent session's per-session
  grants propagate to children (the user already trusted this lineage with
  those calls); `approvalAllow` adds routine-style standing grants. Anything
  else surfaces in the approvals queue attached to the child's session — the
  user approves there, the child resumes. The parent cannot grant its
  children anything the user hasn't granted it.
- **Any model, per child.** Fan out cheap models for sweeps, strong models
  for judgment, mixed panels for review — model choice is the main lever
  delegation exists for.
- **Full observability.** The spawn passes the parent turn's trace context so
  child spans nest under the parent turn — one delegation is one subtree in
  the Activity feed. Child usage rolls up into the parent session's cost
  tracking and is also visible on the child.

## What a child looks like in the product

A normal session. `session.create` with `parentSessionId`, run-status
metadata like routine runs, a Navigator run row (grouped or indented under
the parent — v1 may show siblings), openable live in the chat surface while
it streams, ping-when-done for free via the runs store. Stop/archive work
like any run. Nothing about a subagent is hidden.

## Boundaries

- **Not routines.** A routine is a standing, workspace-versioned prompt fired
  by triggers; a subagent is ephemeral and parent-owned. A routine's run may
  itself spawn subagents.
- **Not CLI agent sessions.** `agent.launch` starts an external CLI agent in
  a pty; `subagent.spawn` starts a Mim-native run. Complementary; a future
  option could let `subagent.spawn` target a CLI agent as executor.
- **Not a DAG engine.** No dependency graphs, retry policies, or scheduling.
  Orchestration logic lives in the parent's reasoning; the tool only spawns,
  waits, continues, stops.

## Implementation sketch

- `src/main/tools/subagents.ts` (+ test, TDD) modeled directly on
  `startRoutineRun`: session create → `streamProfileResponse` → drain →
  status update, plus a wait/registry map for in-flight completions.
- `src/main/sessions.ts`: `parentSessionId` + child run-status fields
  (mirror the routine metadata shape).
- `src/main/ai/aiRuntime.ts`: thread `subagent` context through
  `StreamRequest`/`ToolContext`; exempt `subagent.wait` results from tool
  output truncation.
- `src/main/security/gate.ts`: classifications (`subagent.spawn` category
  `general`, risk `medium`; reads `read`/`low`); grant inheritance.
- `src/main/server/server.ts`: MCP specs for the `subagent_*` names.
- Renderer: runs store picks children up from session metadata; parent link
  in the session header.
