# Observability And Logging

Mim has two separate runtime records:

- **Trace stream**: machine-readable audit and observability events in `.mim/traces/`.
- **Logbook**: optional human-readable notes in `.mim/log.md`.

Use the trace stream for accountability, debugging, cost analysis, agent self-review, and app/job health. Use the logbook for deliberate narrative notes the user or agent wants to keep.

The resolved system prompt can include the current logbook tail through `{{PROJECT_LOG}}`; this is prompt context, not audit state.

Anonymous hosted usage telemetry is a separate redacted projection of selected
trace events plus lifecycle/UI events. See [telemetry.md](telemetry.md) before
changing trace sinks or telemetry-related event fields.

The user-facing Review surface follows the design rationale in
[activity-review-rethink.md](activity-review-rethink.md).

## Trace Stream

The trace stream is append-only JSONL written under:

```text
.mim/traces/YYYY-MM-DD.jsonl
.mim/traces/blobs/<traceId>/<spanId>.<name>.json
```

The JSONL files contain small redacted digest events. Raw payload blobs are pointer-referenced by `payloadRef`.

Content capture (enabled by default, workspace setting `traceCaptureContent` in `.mim/settings.json`):

- **File-mutation params** — `fs.write`/`fs.edit`/`fs.create` params are always blobbed (the edit-distance raw material; independent of `traceCaptureContent` because outcome/revert detection depends on it).
- **Tool results** — every successful tool's result is blobbed on its `tool.result` event, unless the tool is secret-bearing or the serialized result exceeds the 1 MB cap (the digest still records the call). `isSecretBearingTool` denies key/OAuth/code-exchange tools and any tool whose name contains `secret`, `token`, or `credential` in any casing, so `package.secrets.*`, camelCase token setters, and credential helpers never capture.
- **Model I/O** — the full chat-turn message array (input + assistant output + tool calls/results) is blobbed on `chat.turn.done`. This content already lives in the session DB; the blob makes it reachable from the trace surface. Single-shot calls (ghost, task-label, summary) capture usage only.

Setting `traceCaptureContent: false` disables tool-result and model-I/O capture (file-mutation params still capture). Blobs are read back through the `trace.payload` kernel tool, which validates the ref shape and confines reads to `.mim/traces/blobs/`.

Every trace event carries:

- `traceId`, `spanId`, `parentSpanId` for span hierarchy
- `actor` (`user`, `ai`, `package`, `system`)
- `principal` from `~/.mim/config.yaml` user identity, when configured
- `kind`, `status`, `durationMs`
- optional `sessionId`, `runId`, `packageId`, `packageVersion`
- optional `tool`, `model`, `subject`
- optional `effect` on tool events (`read`, `mutate`, or `external`), stamped at
  capture time from the permission gate's tool-effect classifier
- redacted `summary`, pointer-only `payloadRef`, and structured `data`

Trace writes are best-effort. They must never throw through or block the action being traced.

## Emitters

Core emitters:

- `src/main/tools/registry.ts`: `tool.call`, `tool.result`, `tool.error`; one span per tool call.
- `src/main/security/gate.ts`: `gate.decision`, parented to the gated tool span.
- `src/main/ai/aiRuntime.ts`: `chat.turn`, per-step `model.call`, `chat.turn.done`, plus single-shot model calls for ghost, task labels, and summaries. The `chat.turn` root span is created up front so the turn's pre-flight `skill.list`/`package.tools.list` listing and its closing `session.update` persistence nest under it — one chat send is one trace, not a scatter of orphan traces. The single-shot housekeeping calls (ghost/task-label/summary) trace on their own ids and are intentionally excluded from the Review Run feed; they remain visible in Audit Full log and trace statistics.
- `src/main/packages/packageJobs.ts`: `job.started`, `job.step`, `job.progress`, `job.log`, `job.done`, `job.failed`, `job.cancelled`; the app run id is the trace id.
- `src/main/packages/packageRuntime.ts`: app audit, HTTP, and app tool activity with app version.
- `src/main/trace/outcomes.ts`: `outcome.edit` after user edits following AI/app file mutations.

## Outcome Signals

`TraceOutcomeTracker` keeps an in-memory index of the latest AI/app file mutation per path. It observes:

- successful AI/app `fs.write`, `fs.edit`, and `fs.create` tool calls
- subsequent user `fs.write`, `fs.edit`, and `fs.create` tool calls
- scoped open-file watcher changes for edits made outside the kernel

When a user edit follows an AI/app mutation within the correlation window, it emits `outcome.edit` with:

- `diffBytes`
- `diffRatio`
- `sinceMs`
- `aiTraceId`
- `aiSpanId`
- origin actor/tool/session/app fields
- `reverted` when the user content matches the pre-AI snapshot

On restart, the tracker lazily rebuilds recent write/create correlations from trace blobs. It does not scan day files on every watcher tick.

## Query Tools

Kernel tools:

- `trace.query`: streams day-file JSONL and returns capped redacted digest events. Filters: `from`, `to`, `days`, `kind`, `actor`, `tool`, `packageId`, `sessionId`, `runId`, `traceId`, `status`, `order`, `limit`. Chronological order is the default; `order: "desc"` returns newest events first for UI timelines.
- `trace.stats`: aggregates tool calls/errors/durations, app errors, model tokens/cost, day trends, gate approvals/denials, job health, and outcome signals.
- `trace.payload`: reads one captured blob by its `payloadRef`. Validates the ref shape (`blobs/<traceId>/<spanId>.<name>.json`) and confines reads to the traces dir. Returns `{ ref, found, payload? }`. Kernel-only — not exposed to chat (blobs can carry full content).

Chat exposes the same read-only surface as:

- `trace_query`
- `trace_stats`

Blob payloads are never inlined into query results; `trace.query`/`trace.stats` callers receive `payloadRef` only. Fetch a blob explicitly via `trace.payload`.

## In-App Access

Open the Navigator and choose **Review**. This opens the Review Work surface, a
user-facing console for understanding what Mim, apps, and the user have done
in the workspace. Keyboard users can also open `Cmd+P` and choose **Review**.

The surface has two jobs:

- **Review**: the default workflow. It shows deterministic review items
  (errors, denials, reverted outputs), then the narrated Run list. Opening a Run
  shows Story and Timeline lenses.
- **Audit**: the power/debugging lens. It defaults to consequential events
  (mutations, external calls, real approvals/denials, errors, reverts) using the
  captured `effect` field, with a **Full log** toggle for the raw event firehose
  and JSON detail.

The Review row is a fixed core Work launcher, not a Settings panel and not a
chat-only feature. Collapsed Navigator mode keeps the same shield token in the
rail.

## Headless And Chat Access

In the app chat, ask for trace analysis in plain language. The model can call the read-only tools:

```text
Show trace stats for the last 7 days.
List recent tool errors from the trace.
Which app jobs failed today?
Summarize post-AI edit outcomes this week.
```

Headless access uses the same kernel tools:

```bash
node bin/mim.mjs tool trace.stats '{"days":7}' --json
node bin/mim.mjs tool trace.query '{"days":1,"status":"error","limit":20}' --json
node bin/mim.mjs orient --json
```

Direct inspection is also valid:

```text
.mim/traces/YYYY-MM-DD.jsonl
.mim/traces/blobs/<traceId>/
.mim/agent-context.md
```

## Agent Context

`workspace.orient` regenerates `.mim/agent-context.md`. It includes an `Observability health` section when trace stats have notable signals:

- top failing tools
- top failing jobs
- gate denial hotspots
- estimated model cost and trend
- post-AI edit/revert outcomes

No traces means no health block. Trace health is best-effort and must not prevent workspace orientation.

## Hosted-Ready Hook

`createTraceLog({ sinks })` accepts extra `TraceSink` writers. Every stamped event is sent to each sink, even when no workspace is open. Sink failures are swallowed. This is the hosted streaming hook; the local JSONL format remains the default sink.

The anonymous telemetry client uses this hook, but it must never forward raw
trace events. It maps only allowlisted low-cardinality fields and ignores
`summary`, `subject`, and `payloadRef`.

## Retention

Local trace retention is enabled by default. The workspace setting `traceRetentionDays` lives in `.mim/settings.json` and defaults to `90`.

- Positive values keep that many UTC day files, including the current day.
- `0` disables local pruning.
- Invalid or missing values fall back to `90`.

The trace writer checks retention opportunistically after appends. Pruning is best-effort and never blocks the traced action. When a day file is deleted, blob directories for trace ids that appear only in deleted day files are removed; blob directories are kept when the trace id still appears in any retained day file.

## Tests

Primary coverage:

- `src/main/trace/trace.test.ts`: writer, ids, principal stamping, sinks, payload blobs, retention pruning, never-throw behavior.
- `src/main/trace/query.test.ts`: query filters, result caps, stats aggregation, health rendering.
- `src/main/trace/outcomes.test.ts`: post-AI edit outcomes, revert detection, watcher echo suppression, lazy rebuild from blobs, registry integration.
- `src/main/tools/trace.test.ts`: kernel tool behavior.
- `src/main/tools/registry.test.ts`: tracing and payload capture at dispatch.
- `src/main/ai/aiRuntime.test.ts`: chat wrappers for `trace_query` and `trace_stats`.
- `src/main/headless.test.ts`: headless tool surface registration.
- `src/renderer/components/activity/ActivityTrustView.smoke.test.ts`: Review
  landing, narrated Run feed, Run drill-down, and important/full Audit rendering.
- `src/renderer/components/sidebar/ShellSidebar.smoke.test.ts`: Navigator Review
  launcher routing.
- `src/renderer/components/workbench/WorkHost.test.ts`: Review mounted as a real
  Work surface.
