# Routines

Routines are workspace-owned standing prompts stored as Markdown files under
`routines/`. A routine run creates a normal Mim chat session and streams through
the same AI runtime as an ordinary chat turn.

## Definition Files

Each routine is `routines/<name>.md` with YAML frontmatter and a prompt body:

```markdown
---
name: nightly-lit-sweep
description: Sweep new literature.
tools: [web.search, web.read, fs.write]
approval:
  allow: [web.search, web.read]
steps: 42
---

Search the standing questions and summarize anything new.
```

`name` must match the filename without `.md`. `tools` is the visible tool
surface for the run; omitting it exposes the normal chat tool surface.
`approval.allow` is the unattended approval grant set and must be a subset of
`tools` when `tools` is present. Omitting `approval.allow` means the routine has
no unattended consequential grants.

`trigger` is optional. Manual starts are always available; when a routine
declares an automatic trigger it must declare exactly one of:

- `schedule: "0 8 * * *"` — five-field cron expression.
- `every: 4h` — interval trigger using `m`, `h`, or `d`.
- `files: { path: "inbox/", events: [add, change, unlink] }` — workspace-relative
  file event trigger.
- `webhook: { secret: intake }` — signed webhook trigger. The secret value lives
  in the OS keychain under `routine:webhook:<name>`, not in the routine file.
- `slack: { account, channels }` — Slack routine trigger. Channels use
  `{ id, mode }`, where mode is `mention` or `always`; `account` defaults to
  `default`. Two enabled routines may not bind the same Slack account/channel.

Routine files are clean-break schema files: invalid fields are diagnostics, not
silently migrated. Corrupt local state is ignored so a bad state file cannot
prevent the workspace from loading.

## Enablement

Machine-local enablement lives in `.mim/routines/state.json`. Enabling stores an
authority hash over trigger/model/agent/tools/approval/steps/missed fields. If
those fields change, the routine needs enablement again before scheduled
execution can trust its authority.

Manual starts and runs are allowed for disabled routines so authors can test a
routine before enabling it.

`.mim/routines/state.json` is not the definition registry. It may have an empty
`routines` object while valid routine files exist. Use `routine.list` to inspect
definitions and `slack.bot.check` for Slack bot readiness.

## Tools

The main-process routine tools are:

- `routine.create`
- `routine.list`
- `routine.get`
- `routine.pause`
- `routine.resume`
- `routine.run`
- `routine.start`
- `routine.webhook.secret.status`
- `routine.webhook.secret.set`
- `routine.webhook.secret.delete`

On desktop, `routine.start` creates a queued chat session with `routineId`,
`routineRunId`, `routineStatus`, `routineFiredAt`, and the routine prompt as the
visible first user message. The renderer opens that session and starts the
normal chat stream, so assistant text, tool calls, tool results, and approval
cards all render in the transcript as they happen. The server resolves the
queued prompt plus routine model/agent/tools/approval grants from the trusted
session and routine file before streaming; the renderer never supplies routine
authority.

`routine.run` uses the same routine profile and waits for completion in the
main process, which is useful for schedulers and headless callers. The renderer
maps routine sessions to `routine` runs in the Navigator.

Webhook secret tools take a routine name. They resolve the routine's
`trigger.webhook.secret` name and store/remove only the local OS keychain value;
they never return the signing secret itself.

## Work Surface

The Navigator has a Routines surface. It lists valid routine files plus
diagnostics, shows trigger/tool/enablement state, and provides Run, Pause, and
Resume controls. If the workspace has no routines, the surface shows a compact
new-routine form; the header plus button opens the same form later. Creating a
routine chooses a model, uses plain-language run choices such as daily, weekly,
simple interval, file changes, or external request, writes `routines/<name>.md`,
and opens the file for editing. The UI may generate `schedule` frontmatter
internally; users do not need to write cron syntax. Run creates a routine chat
session and opens that transcript. Routine sessions appear in Activity as
routine run rows, not duplicate ordinary chat rows.

## Automation

When a workspace is open, the desktop app starts the routine automation service
for that workspace.

- `schedule` and `every` triggers are checked by a one-minute lifecycle ticker.
  `nextRunAt`, scheduler heartbeat, last run id, last success, and last error
  timestamps are stored in `.mim/routines/state.json`.
- `files` triggers start chokidar watchers for enabled routines. File event
  payloads contain workspace-relative paths and event kinds as data; the runner
  does not read file contents unless the routine prompt asks to use file tools.
- `webhook` triggers are exposed at `POST /api/hooks/:routine` on the local
  Express server. Requests must be JSON and signed with
  `x-mim-timestamp` (Unix seconds) and `x-mim-signature` (`sha256=<hex>` over
  `<timestamp>.<raw body>`). Optional `x-mim-delivery` enables 24-hour local
  idempotency.

Automatic triggers only fire enabled routines. If a routine is already running,
the overlapping fire is skipped and traced. Manual starts still work for
disabled routines.

## Permissions

Routine tool calls carry routine context into the permission gate. Read/search/AI
tools are allowed as the baseline unless a path floor or saved-browser grant
requires approval. Consequential tools require either an exact `approval.allow`
grant or a live approval. Global developer mode and per-session "always allow"
do not bypass missing routine grants.

Sensitive paths, outside-workspace paths, readonly resource writes, and saved
browser session grants still require approval even when a tool is in
`approval.allow`.

## Current Scope

Implemented scope is definition storage, validation, enablement state, manual
runs, session metadata, Navigator classification, routine-aware permission
gating, the Routines work surface, desktop lifecycle ticker, file watchers,
signed local webhooks, webhook secret tools, run state persistence, and trace
events for fires/skips/completions/errors.

Slack trigger validation, duplicate binding diagnostics, bot/app-token
credential tools, one-shot setup/check tools that create/update and enable the
workspace routine, Socket Mode lifecycle wiring, a metadata-only event ledger,
event-to-routine dispatch, and bot thread replies are implemented in the
desktop runtime. Durable per-thread session continuation, debounce/replay,
chained routines, scheduler ownership across multiple hosts, durable parked
approvals, and `mim serve` ownership are still outside the current runtime.
