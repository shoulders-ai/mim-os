# Slack Listener

Status: desktop runtime implemented for the core loop. Routine `slack` trigger
validation, duplicate binding diagnostics, bot/app-token credential tools, a
metadata-only event ledger, one-shot setup/check tools, Socket Mode lifecycle,
event dispatch, and bot thread replies are implemented. Durable per-thread
sessions, debounce/replay, parked approvals, and [mim-serve.md](mim-serve.md)
as an always-on host remain proposal work.

Mim hosts a Slack-triggered routine: a Socket Mode listener in the main
process watches configured channels and answers by running a mounted agent,
replying in thread as the bot. No public server, no dashboard, no second bot
runtime — Socket Mode dials out over websocket, so the desktop app (or
`mim serve` later) is the bot host. Prior art: the sf-bot architecture
(Slack event → durable dedup → per-thread debounce → agent with tools →
thread reply), rebuilt on Mim's primitives instead of a bespoke process.

Product boundary: **this is not a separate Slack-bot product.** It adds value
only as a Slack trigger for routines. The user-facing object remains the
routine file and the Activity/History run it creates; Settings only manages
credentials and socket health. v1 should bias toward `mode: mention`, because
"answer every message in this channel" is powerful but easy to misconfigure.

The division of labour with routines: **the listener is trigger
infrastructure; the responder binding is a routine.** A `slack` trigger kind
joins schedule/webhook/files/after, so the bot's authority, trust, and
enablement story is the routine story — one subsystem, not two permission
models. What is genuinely new here is the conversational shape: a Slack
thread is a continuing conversation, so fires map to a persistent
per-thread session rather than one-shot runs.

Readiness gate: the user-facing path is `slack.bot.setup`/`slack.bot.check`,
not routine-file editing or hidden runtime-state inspection. The desktop app
must be open for Socket Mode delivery; `mim serve` is the future always-on host.

## Why Socket Mode, not the personal token

Slack has no real-time push for a plain personal (`xoxp`) token. Listening
requires a Slack app with an app-level token (`xapp-`, scope
`connections:write`) and a bot token (`xoxb-`). The user creates the app
once from a manifest we ship (~5 minutes), installs it to their Slack
workspace, and hands Mim both tokens. The existing personal token stays for
`slack.search` (`search.messages` requires a user token) and the existing
human-connected Slack tools. Polling `conversations.history` with the
personal token was considered and rejected: latency equals the poll interval,
missed edits/deletes are awkward to reason about, and it spends Web API rate
budget continuously. Slack's 2025 limit reduction applies to commercially
distributed non-Marketplace apps, while internal customer-built apps keep
higher limits; either way, polling is not the right center for a desktop
listener. Socket Mode's decisive property for a desktop app: the client dials
out, so no public endpoint, no tunnel, no reverse proxy.

## Principles

- **The responder is a mounted agent, bound by a routine.** No new bot
  runtime and no new authority model: a routine file declares the channel
  binding (trigger), the persona (`agent:`), and the standing grant
  (`tools:`). The listener only converts Slack events into routine fires.
- **Unattended means allowlisted or parked, never rubber-stamped.** Tool
  calls inside the routine's allowlist auto-approve (audited per call);
  calls outside it park the run as `needs-approval` and the bot posts a
  short "waiting for approval in Mim" to the thread. The global approval
  mode is ignored, exactly as routines specify.
- **Slack content is untrusted input.** The bot reads arbitrary text from
  arbitrary coworkers, and it holds an external send capability by
  definition — precisely the combination routines' security section flags
  as an exfiltration channel. The structural mitigation: the bot's reply
  executes through a **pinned thread reply** whose channel/thread params
  are set by the runner, not the model, so an injected "post this to
  #general" cannot retarget the send. Broader Slack sends are an explicit
  allowlist entry a user must opt into, and earn the load-time warning
  diagnostic.
- **Threads should become sessions.** The implemented desktop loop creates a
  routine session per Slack event and replies in the originating thread. The
  north star is one durable chat session per Slack thread, carrying the agent's
  identity, visible in Activity, replayable in History, and reusable for
  follow-up memory. The operator surface is Mim itself, not a dashboard.
- **Slack text has an explicit retention boundary.** Slack thread content is
  persisted only where the feature needs it: the per-thread session transcript
  under `.mim/sessions/`. Trace payload blobs, tool result blobs, event
  ledgers, status tools, diagnostics, and Settings never persist raw Slack
  message bodies. Slack-origin sessions are marked in metadata so search/index
  code can treat third-party message text separately from user-authored Mim
  chat.
- **Three token kinds, one secret boundary.** The existing personal/user token
  remains `slack:{account}` for `slack.search` and the current Slack tools.
  Bot and app tokens live beside it as `slack-bot:{account}` and
  `slack-app:{account}`. All are ingested from files so they never enter model
  context — never in `mim.yaml`, settings files, routine files, session
  messages, or traces.

## The binding — a routine with a `slack` trigger

```markdown
---
name: support-bot
description: Answer questions in #mim-support from the workspace docs.
trigger:
  slack:
    account: default
    channels:
      - { id: C0123456789, mode: mention }
      - { id: C0987654321, mode: always }
agent: package:support-bot/responder   # optional; default chat profile
tools: [fs.read, search.files, knowledge.search]
---

Answer as a helpful support engineer. Ground every answer in the workspace
docs; say so when you cannot. Keep replies short — this is Slack.
```

- `mode: mention` — respond only when the bot user is @-mentioned;
  `always` — respond to every non-bot message (sf-bot's channel modes).
- The listener adds a built-in grant floor beyond `tools:`: internal bot-token
  thread reads (`conversations.replies` for the bound thread, `users.info` or
  `users.list` for name resolution) and the pinned thread reply. These are not
  the general personal-token Slack tools exposed to AI/MCP. Everything else
  follows the routine allowlist rules, including the sensitive-path floor and
  per-machine enablement — a pulled routine that binds a Slack channel loads
  paused until acked on this machine.
- Trigger-scoped template variables: `{{slack.channel}}`,
  `{{slack.thread_ts}}`, `{{slack.sender}}`. Message text arrives as the
  user turn (fenced, framed as untrusted input), never interpolated into
  the prompt body.
- One `slack` trigger per routine; multiple routines may bind different
  channels. Two routines binding the same channel is a load-time
  diagnostic.
- v1 ignores Slack files, canvases, workflow cards, and edited/deleted message
  events except for a diagnostic trace entry. Text messages are enough to prove
  the conversational path without turning Slack into a document-ingestion
  subsystem.

## Data retention and privacy

Slack is third-party coworker content, not workspace-authored content. The
proposal therefore diverges from ordinary chat persistence in three places:

- **Session transcript:** stores the normalized Slack messages that reached
  the agent, with message metadata (`team_id`, `channel`, `thread_ts`, `ts`,
  `user`, and permalink when available). This is required for conversation
  memory and History replay. Deleting or archiving the session follows the
  existing session lifecycle; the Slack event ledger does not retain the text.
- **Trace stream:** records event ids, channel/thread ids, sender ids, routine
  id, run id, token kind, counts, and outcomes. It does not write Slack message
  bodies to trace payload blobs, even when workspace content capture is on.
  The `chat.turn` messages payload needs a capture policy hook so Slack-origin
  turns skip or redact external input before `writePayload`.
- **Search:** Slack-origin session text is not indexed by the normal session
  content index in v1. The manifest can index labels and metadata, but raw
  coworker message text should not appear in global Mim search until there is
  an explicit "index integration transcripts" setting.

Outbound replies are similar: the pinned reply helper records Slack's
`channel`, `ts`, `thread_ts`, and response status in trace, not the reply body.
The body already exists in the session transcript as the assistant response.

## Architecture

New code in `src/main/integrations/slack/` beside the existing client;
the routine runner and gate mechanics come from routines phases 1 and 3.

- **Socket lifecycle** (`listener.ts`): implemented with the existing `ws`
  dependency, not `@slack/bolt` or a Slack SDK. The listener opens Socket Mode
  URLs with `apps.connections.open`, keeps one socket per enabled Slack routine
  account, handles `hello` and `disconnect` frames, reconnects with bounded
  backoff, extracts enabled-routine bindings, matches mention/always modes,
  ignores bot/self messages, records metadata in the ledger, acknowledges
  event envelopes after local metadata persistence, dispatches matching events
  into the routine runner, and posts the final assistant text back to the
  Slack thread.
- **Durable event ledger** (`eventLedger.ts`): implemented as a bounded
  metadata ledger under `.mim/slack/event-ledger.json`, keyed by Slack
  `event_id` (`team_id`, `channel`, `ts`, `thread_ts`, event type, routine id,
  received time, status). It detects duplicates, lists `received`/`queued`
  replay candidates, prunes old records, and sanitizes loaded records so raw
  message text cannot be carried forward. The socket host records metadata
  before acknowledging an event envelope so Slack can redeliver if local
  persistence fails.
- **Per-thread debounce and queueing** (`threadQueue.ts`): rapid message bursts
  become one routine fire. Overlapping fires on one thread queue behind the
  active turn because a conversation is ordered; fires on different threads
  run concurrently up to the routine runner's limits. Queue records contain
  event ids and message metadata only; text is read from the in-memory event
  while live and re-fetched from Slack during restart replay.
- **Routine fires and replies** (`listener.ts` + routine runner): a fire creates
  a normal routine session, passes Slack channel/thread/user metadata as trigger
  payload, runs through the standard routine runner and gate, extracts the
  final assistant text from the session transcript, and posts it via the
  internal bot-token thread reply helper. Turn failures post a short error
  notice to the thread and mark the ledger record errored; errors do not take
  down the listener. Durable per-thread session reuse remains deferred.
- **Pinned reply helper** (`client.ts`): internal runner-owned Slack send using
  the bot token. It accepts only `{ account, channel, thread_ts, text }` where
  channel/thread come from the fire, not the model. It is not exposed as a
  general AI/MCP tool.
- **Lifecycle**: the listener starts when the active workspace has at
  least one enabled `slack`-triggered routine and stops on workspace
  switch/close. One listener connection per app instance per account.
  Kernel tool `slack.listener.status` reports socket state, connected-as
  identity, and last-event age; `slack.bot.check` folds this into the
  user-facing readiness checklist.

## Phases

### Phase 0 — Bot credentials and internal client

Implemented: token-kind-aware storage, bot auth, Socket Mode URL verification,
internal bot thread reply helper, `slack.bot.status`, `slack.bot.connect`,
`slack.bot.disconnect`, `slack.bot.setup`, `slack.bot.check`,
`slack_bot_connect`, `slack_bot_disconnect`, `slack_bot_setup`,
`slack_bot_check`, `slack.listener.status`, gate policy, and trace secret
handling. The desktop listener consumes these credentials when at least one
enabled Slack-triggered routine references the account.

- `SlackIntegration` (`client.ts`) gains token-kind-aware storage
  (`slack:{account}` existing personal/user token,
  `slack-bot:{account}`, `slack-app:{account}`) and methods:
  `botAuthTest` (resolves bot user id/team), `botPostThreadReply`
  (posts as the bot and always accepts a `thread_ts`), `connectionsOpen`
  (app-token POST → wss URL; app token must be passed in the Authorization
  header), and token-kind status helpers.
- Tools: `slack.bot.connect` (accepts `file` with both `bot_token` and
  `app_token`, verifies the bot token via `auth.test` and the app token via
  `apps.connections.open`, stores both in keychain), `slack.bot.disconnect`,
  `slack.bot.status`. Both connect/disconnect are `secrets`/`high` in the
  gate; no params/results captured in traces. `slack.status` may include a
  compact `botConfigured` summary, but the existing personal token semantics
  stay intact for backward compatibility.
- Do **not** expose a general `slack.bot.send` AI/MCP tool in v1. The only
  bot-send path is the internal pinned thread reply, because the channel/thread
  binding is the main prompt-injection mitigation.
- Ship the Slack app manifest YAML in the manual's setup chapter, not in UI
  copy. Required pieces:

  ```yaml
  display_information:
    name: Mim Routine Bot
  features:
    bot_user:
      display_name: mim
      always_online: false
  oauth_config:
    scopes:
      bot:
        - app_mentions:read
        - channels:history
        - groups:history
        - channels:read
        - groups:read
        - chat:write
        - users:read
  settings:
    socket_mode_enabled: true
  event_subscriptions:
    bot_events:
      - app_mention
      - message.channels
      - message.groups
  ```

  If emoji acknowledgments ship in v1, add `reactions:write` here and in the
  docs. Do not include DM scopes/events until the product decision changes.
- Tests: `client.test.ts` (token kinds, connectionsOpen Authorization header,
  botAuthTest, botPostThreadReply threading), `tools.test.ts` (connect from
  file, rollback on partial verification failure, status shape, trace capture
  denial), `gate.test.ts` rows for bot connect/status and the system-only
  pinned reply helper.

### Phase 1 — Listener core

Implemented for the desktop single-turn loop.

- Implemented: `listener.ts` helpers for enabled-routine binding,
  mention/always-mode routing, bot/self-message exclusion, dedup before fire,
  metadata-only ledger writes, Socket Mode connection lifecycle, envelope ack,
  reconnect/backoff, injected routine fire callback, and bot thread replies.
- Deferred: per-thread debounce, restart replay fetch, durable per-thread
  session reuse, parked approvals, and orient health.
- `eventLedger.ts`: implemented durable metadata persistence, duplicate event
  suppression, replayable status listing, bounded pruning, and no message text
  persisted.
- Deferred unsupported-payload handling: files, edited/deleted messages, and
  subtype noise should be dropped with metadata-only trace diagnostics. Bot
  messages are already ignored by the pure dispatcher.

### Phase 2 — The `slack` trigger and conversational sessions

Depends on routines phase 1 (store + runner) and phase 3 (allowlist grant
+ park-for-approval).

- Implemented: `slack` trigger kind in the routine frontmatter schema with
  load-time diagnostics for malformed channel config and duplicate
  account/channel bindings.
- Deferred: missing bot credential diagnostics, conversational sessions, and
  response posting.
- `responder.ts`: thread↔session mapping, first-touch context fetch,
  fenced untrusted-input framing of message text, pinned thread reply,
  park notice posted to the thread, error notice path.
- Session record extension in `sessions.ts` + manifest; Activity/History
  rows show the routine/agent name and a Slack-thread origin, not an ordinary
  user chat row. Slack-origin sessions bypass raw text indexing in v1.
- AI runtime/session persistence grows a capture policy hook so Slack-origin
  turns do not write raw Slack message bodies into trace payload blobs.
- Tests: `responder.test.ts` with mocked AI provider and fake Slack
  client — mapping stability, reply pinning (injection attempt cannot
  retarget), retention invariants, park flow, queueing on one thread, restart
  replay from ledger, error path.

### Phase 3 — Setup UX

- Settings > Connections > Slack: bot row with masked "connected as
  @name", connect-from-file, disconnect, socket status dot. No
  instruction prose — the manual carries the walkthrough.
- Agent-led setup: `slack_bot_connect(file?)` AI tool and
  `connections_status` coverage, so the chat can run the whole
  conversation: "create the app from this manifest, install it, give me
  the token file path." Routine authoring is already conversational via
  `routine.create`.
- Channel ids resolve to names in diagnostics and Settings via the
  existing `slack.channels`.
- Docs: `integrations.md` listener section, `security.md` pinned-reply
  rule, `_MAP.md` rows, manual chapter, `gotchas.md` (one active listener per
  bot/app-token pair — multiple Mim instances connected to the same Slack app
  are unsupported because event delivery may be distributed across sockets).

### Phase 4 — Always-on host (deferred)

The listener, responder, and trigger are renderer-free by construction;
running them under `mim serve` is wiring, and lands with routines phase 5
/ mim-serve phase 4. Durable parking (an approval that survives restarts
and reaches a human who is not at the machine) is decided there, once,
for all unattended runs.

## Open decisions

- **DMs.** v1 does not listen to DMs or MPIMs. Private channels are allowed
  only when the bot was invited and the routine names the channel id
  explicitly; they get a load-time sensitive-surface warning. Revisit DMs with
  separate policy rows if pulled for.
- **Reply streaming.** v1 posts one final reply per turn (plus the park
  notice). Progressive `chat.update` editing of a placeholder message is
  a polish item, decided after real usage.
- **Multi-account.** One bot account per workspace in v1; the
  `trigger.slack.account` field exists so this is config growth, not a
  schema break.
- **Emoji-reaction acknowledgment** (👀 on receipt, ✅ on completion —
  the sf-bot nicety) needs `reactions:write`; include in the manifest
  from day one or add later. Leaning: include, it is the cheapest
  feedback channel the bot has.
- **Slack-origin search indexing.** v1 excludes raw Slack-origin session text
  from global session search. A future setting could opt in, but it should be
  argued as an integration privacy feature, not smuggled in by the listener.
