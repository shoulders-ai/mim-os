# Routines

Routines are standing prompts supplied by the current Project or the connected
Team. Project definitions live under `routines/`; Team definitions live under
`~/.mim/team/routines/` and are exposed to the editor through
`.mim/team/routines/`. A routine run creates a normal Mim chat session and
streams through the same AI runtime as an ordinary chat turn.

## Definition Files

Each routine is `<source>/routines/<name>.md` with YAML frontmatter and a prompt
body:

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
  `default`. In `mention` mode, the first bot mention activates the Slack
  thread; later replies in that thread continue the same Mim routine session
  without another mention. Two routines may not bind the same Slack
  account/channel.

Routine files are clean-break schema files: invalid fields are diagnostics, not
silently migrated. Each loaded definition carries a revision hash used by the
editor to reject stale saves. Corrupt or pre-v2 local state is ignored so bad
or legacy state cannot prevent the workspace from loading.

## Activation

The catalog exposes one explicit activation state instead of overlapping
enabled/paused flags:

- `manual` — the definition has no automatic trigger. It only shows Run.
- `active` — automatic runs are enabled on this machine for the current
  authority-bearing definition.
- `disabled` — the current authority was reviewed, but automatic runs are off.
- `review-required` — the routine is new on this machine or its trigger, model,
  agent, tools, approvals, step limit, or missed-run policy changed.

Machine-local activation lives in version 2 of `.mim/routines/state.json`.
Enabling stores an authority hash over trigger/model/agent/tools/approval/steps/
missed fields plus the local machine hostname as the visible schedule owner.
Team state keys are origin-qualified, so they cannot collide with Project
state. A prompt or description edit preserves active state; an
authority-bearing edit moves the routine to `review-required` until the user
reviews and enables automatic runs again.

This state belongs to the local Project checkout even for a Team routine. Two
clients can therefore activate different Team routines, and only the chosen
client runs its schedules, file triggers, Slack events, or webhooks. Activation
never rewrites a Team or Project definition.

Manual starts and runs are allowed for disabled routines so authors can test a
routine before enabling it.

`.mim/routines/state.json` is not the definition registry. It may have an empty
`routines` object while valid routine files exist. Use `routine.list` to inspect
definitions and `slack.bot.check` for Slack bot readiness.

## Tools

The main-process routine tools are:

- `routine.create`
- `routine.update`
- `routine.duplicate`
- `routine.list`
- `routine.get`
- `routine.enable`
- `routine.disable`
- `routine.remove`
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

`routine.update` requires the full definition plus the revision returned by
`routine.get` or `routine.list`; it writes atomically and rejects a save if the
file changed in the meantime. `routine.duplicate` copies the complete definition
under a new identifier and leaves automatic runs awaiting review. `routine.remove`
moves the Markdown definition to the OS Trash, clears its machine-local state,
and removes a uniquely owned webhook signing secret. Existing run transcripts
remain in Activity and History.

Webhook secret tools take a routine name. They resolve the routine's
`trigger.webhook.secret` name and store/remove only the local OS keychain value;
they never return the signing secret itself.

## Work Surface

The Navigator has one dense Routines work surface for Team and Project
definitions. Project definitions override same-named Team definitions. Rows
lead with the human description, keep the stable identifier secondary, label
the actual Team name or Project origin, translate triggers into plain language,
summarize access, and show the machine that owns active automatic runs plus
last/next-run context. Failed and review-required routines sort to the top. Run
or Run now is always visible; automatic routines use one Automatic toggle.
Turning it on opens an authority review rather than relying on an ambiguous
Resume action.

Each row has an action menu for Edit routine, Open definition file, View last
run, Duplicate, and Move to Trash. New and Edit share one structured dialog for
description, trigger, instructions, model, agent, tools, unattended approvals,
limits, and missed-run behavior. Daily, weekly, interval, file, webhook, and
Slack choices avoid requiring users to write implementation syntax; custom cron
definitions still remain editable. Slack editing preserves every configured
channel and response mode. Source editing stays first-class: changes under
`routines/` refresh the catalog, automation services, Slack listener, and work
surface through the workspace watcher.

Run creates a routine chat session and opens that transcript. Slack-triggered
routines keep one Mim routine session per Slack thread so follow-up replies
share memory with prior thread turns. Routine sessions appear in Activity as
routine run rows, not duplicate ordinary chat rows. The empty state explains
the feature and opens the same New routine dialog.

## Automation

When a Project is open, the desktop app starts the routine automation service.
The same service runs without Electron through `mim always-on`.

- `schedule` and `every` triggers are checked by a one-minute lifecycle ticker.
  `nextRunAt`, scheduler heartbeat, last run id, last success, and last error
  timestamps are stored in `.mim/routines/state.json`. One failed scheduled run
  remains due for retry at the next heartbeat and does not block other routines
  in the current tick.
- `files` triggers start chokidar watchers for active routines. File event
  payloads contain workspace-relative paths and event kinds as data; the runner
  does not read file contents unless the routine prompt asks to use file tools.
- `webhook` triggers are exposed at `POST /api/hooks/:routine` on the local
  Express server. Requests must be JSON and signed with
  `x-mim-timestamp` (Unix seconds) and `x-mim-signature` (`sha256=<hex>` over
  `<timestamp>.<raw body>`). Optional `x-mim-delivery` enables 24-hour local
  idempotency.
- `slack` triggers are delivered by the desktop Socket Mode listener. The
  event ledger stores only metadata for dedupe, while
  `.mim/slack/thread-sessions.json` maps active Slack threads to Mim session
  ids so thread replies can continue the existing transcript.

Automatic triggers only fire routines whose activation is `active`. If a routine is already running,
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

Implemented scope is definition storage, validation, revision-aware create/edit/
duplicate/remove lifecycle, four-state activation and authority review, manual
runs, session metadata, Navigator classification, routine-aware permission
gating, the dense Routines work surface, source-file live refresh, desktop
lifecycle ticker, file watchers, signed local webhooks, webhook secret tools,
run state persistence, and trace events for fires/skips/completions/errors.

Slack trigger validation, duplicate binding diagnostics, bot/app-token
credential tools, one-shot setup/check tools that create/update and enable the
workspace routine, Socket Mode lifecycle wiring, a metadata-only event ledger,
event-to-routine dispatch, and bot thread replies are implemented in the
desktop and always-on runtimes. The always-on heartbeat also syncs before
refreshing routine definitions, while Socket Mode reconnects independently.
Durable per-thread session continuation is implemented. Chained routines and
durable parked approvals remain outside the current runtime.
