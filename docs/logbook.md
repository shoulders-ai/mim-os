# Logbook

The logbook is an optional human-readable workspace activity file at `.mim/log.md`.

It is separate from the trace stream (`.mim/traces/`):

- `.mim/traces/*.jsonl` is the machine-readable audit/observability stream produced by every tool call, model call, gate decision, and app job event.
- `log.md` is a compact human and agent logbook for deliberate notes such as "finished review pass" or "waiting for client reply".

The logbook is gitignored runtime state. It is never required for a valid Mim workspace.

## Tools

`log.append`

- Input: `{ message: string }`
- Appends one normalized single-line entry to `.mim/log.md`.
- Creates `.mim/` and `log.md` on first write.
- Records actor identity from the tool context. App entries render as `[package {id}]`.
- Exposed to chat and MCP as `log_append`.
- Gate policy: write, low risk.

`log.read`

- Input: `{ max_chars?: number }`
- Reads `.mim/log.md` without creating it.
- Returns `{ path, exists, content, truncated }`.
- When truncated, returns the tail so recent entries are kept.
- Gate policy: read, low risk.

## Prompt Integration

`AGENTS.md` can include `{{PROJECT_LOG}}`. At system-prompt build time Mim replaces it with a bounded tail of `.mim/log.md`, or `No project log yet.` when the file is absent.

The default `AGENTS.md` template tells agents to use `log_append` only for durable activity notes that future work should see, such as decisions, handoffs, blockers, or commitments. Routine progress belongs in the conversation, not the logbook.

## Format

New files start with:

```md
# Log
```

Entries are appended as:

```md
- 2026-06-01T12:34:56.000Z [user] Finished review pass
```

The file is intentionally simple Markdown. Do not treat it as authoritative machine state. Use the trace stream (`.mim/traces/`) for audit and debugging timelines.
