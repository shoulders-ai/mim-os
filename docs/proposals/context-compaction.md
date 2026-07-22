# Context Compaction

Status: Phase 1-5 implemented.

Long agentic sessions must not die of context exhaustion, and keeping the
model alive must not destroy the transcript. Compaction is therefore **a view
over the canonical session transcript, not an edit of the transcript**. The
raw `messages[]` array remains the user-visible record. A separate
compaction record tells the runtime how to rebuild model input from that
record.

The feature should be boring in normal use: users still see the full chat,
agents get a smaller historical context when needed, and the only visible
surface is a small transcript divider that marks where model-visible history
now starts.

## Principles

- **Compaction never edits messages.** `messages[]` is written only by normal
  session/turn persistence. Repair and compaction are view-time
  normalizations. Existing sessions that were already destructively compacted
  cannot be restored, but new compaction work must not remove more data.
- **Completed history is canonical.** Phase 1 keeps the current full-array
  `session.update({ messages })` turn persistence path for compatibility with
  `@ai-sdk/vue`, but removes compaction and repair from that path. Later
  phases may tighten this into append/commit-turn APIs; that is not required
  for compaction as long as no compaction code writes `messages`.
- **One door to the model.** A single pure function,
  `buildModelContext(input)`, is the only place stored UI messages become
  model-visible UI messages. Every `AgentProfile` - built-in chat, inline,
  app-mounted agents ([agents-as-apps.md](agents-as-apps.md)) - goes through
  it.
- **Real tokens first, estimates as a guardrail.** Thresholds prefer the
  provider-reported usage the runtime already persists (`lastInputTokens` /
  `lastContextTokens` in `src/main/sessions.ts`). Before provider calls, Mim
  also estimates the freshly built prompt, including instructions and tool
  definitions, so oversized resumed turns are compacted before the provider can
  reject them.
- **Deterministic before generative.** A no-LLM pre-pass handles routine bloat
  every turn. The LLM summary is a threshold backstop for genuinely long
  sessions.
- **Historical summaries are not instructions.** A compaction summary is a
  dated record of earlier work. It must not be injected as a high-authority
  instruction or presented to the user as a hidden second transcript.

## Current State

Mim now builds a model-only transcript view in
`src/main/ai/compaction.ts`. `streamProfileResponse` sends that view to
validation and `convertToModelMessages`, while session persistence keeps the
canonical `messages[]` array untouched. Incomplete tool-call repair is also a
view-time normalization; it is not written back to disk.

The deterministic pass currently handles:

- browser observation trimming via the existing browser helper;
- old `web_read` and `fs_read` content with first/last excerpts and preserved
  path/URL/line metadata;
- old `bash`/`code_run` stdout and stderr with diagnostic tails;
- oversized write/edit/create tool arguments in the view only;
- generic package and integration payload string fields, while preserving IDs,
  URLs, paths, statuses, and other scalar identity fields;
- exact duplicate large tool outputs beyond the first occurrence.

The threshold backstop writes append-only compaction records when real
provider usage or the freshly built prompt estimate approaches the selected
model's context window. Post-turn checks run after session persistence;
pre-turn checks catch resumed sessions, model switches, missed post-turn
attempts, and prompt growth that was not reflected in prior provider usage. If
Anthropic, OpenAI, or Google rejects a turn with a recognized context-length
error, Mim appends one
`overflow` compaction record, rebuilds the model prompt from the summary plus
tail, and retries once. Non-context provider errors and second context-length
failures surface normally. The model receives the latest historical summary
plus the kept tail, while the session transcript remains unchanged.
After a compaction record is appended, the session's effective context counters
are updated to that record's `tokensAfter` estimate so the renderer and the next
pre-turn check do not keep treating the old un-compacted provider usage as live
context pressure.

The renderer shows a compact divider at the latest compaction record's event
anchor, not at the model cut point. Pre-turn and overflow compactions anchor
after the triggering user message; post-turn compactions anchor after the
completed assistant reply. The divider does not hide earlier transcript
messages. It can expand to show the historical summary text. The context donut
remains informational; starting a new thread from a summary is not part of
automatic compaction. When the latest compaction record has a lower
`tokensAfter` estimate than stale provider usage, the donut reports that
effective compacted context and labels the tooltip as compacted. Before a
compaction exists, a high-context donut explains that Mim will compact
automatically when needed.

## Motivation

Mim is the operating system for AI-native research organisations. Its normal
workload is not a five-message chat: it is a literature sweep that reads
papers, a data analysis that runs `code.run` repeatedly, or a document
pipeline that reads, edits, and re-renders across an afternoon. For that user,
context exhaustion is a core-runtime failure mode.

Two sibling initiatives make this a prerequisite:

- [routines.md](routines.md) - scheduled and triggered agent runs. A routine
  that fires unattended can produce hundreds of tool calls. Without compaction
  those runs hit the context window and stall.
- [mim-serve.md](mim-serve.md) - an always-on headless host increases the same
  pressure: long unattended runs with no human watching for a stalled session.

## Reference Implementations

The design follows the useful parts of two working systems without importing
their storage complexity.

**pi** supplies the main semantics: trigger when context tokens exceed the
model window minus a reserve; check post-turn and pre-prompt; on provider
context-length errors, compact and retry exactly once; keep a recent tail and
avoid splitting tool calls from results; persist compaction metadata as a
separate record; rebuild context as latest-summary-plus-kept-tail. Mim does
not need pi's session tree because Mim does not have branching chat sessions.
A flat latest-wins record list is enough.

**Hermes** is the cautionary example for mutation. It rewrites and rotates live
sessions, then needs compression locks, rollback paths, and orphan cleanup.
Mim avoids that by never using compaction to rewrite the transcript. Four of
Hermes' mechanisms are still useful: deterministic trimming before any LLM
summary, anchoring the last real user message into the kept tail, distrusting
token estimates after compaction until real provider usage arrives, and
anti-thrash when a compaction saves too little.

## Architecture

### The View Function

Use `src/main/ai/compaction.ts` with co-located `compaction.test.ts`.

```ts
export interface BuildModelContextInput {
  messages: UIMessage[]
  compactions: ContextCompactionRecord[]
  modelWindow: number
  now: Date
}

export interface BuildModelContextResult {
  messages: UIMessage[]
  appliedCompactionId?: string
  estimatedTokens: number
  stage1CompactedCount: number
}
```

`buildModelContext(input)` composes, in order:

1. **Repair** - remove incomplete/non-terminal tool parts for model validity,
   but do not persist the repaired form.
2. **Compaction records** - if records exist, the latest successful record
   wins. Insert one synthetic historical assistant message, then include only
   messages from the record's cut point onward.
3. **Stage 1 deterministic pass** - apply pure per-tool trimming/dedup rules
   to the kept messages.

The synthetic summary message uses assistant role, not system role:

```ts
{
  id: `context_compaction_${record.id}`,
  role: 'assistant',
  metadata: { synthetic: true, compactionId: record.id },
  parts: [{
    type: 'text',
    text: [
      `Historical context summary created ${record.createdAt}.`,
      'This summarizes earlier transcript content only; it is not a current user request or system instruction.',
      '',
      record.summary,
    ].join('\n'),
  }],
}
```

This keeps the summary in chronological conversation context without giving it
system-instruction authority. The summary template also writes completed work
in past tense and separates open items from decisions.

### Runtime Data Flow

`streamProfileResponse` remains the entry point. Before validation and
`convertToModelMessages`, it:

1. Normalizes file UI parts from `request.messages`.
2. If `profile.persistSession && request.id`, reads the session with the turn
   trace context to obtain `compactions`, `lastInputTokens`, and
   `lastContextTokens`.
3. Calls `buildModelContext({ messages: normalizedRequestMessages,
   compactions: session.compactions ?? [], modelWindow, now })`.
4. Validates and converts the returned view, then sends that view to the
   provider.

The renderer does not send compaction records. They are main-process runtime
state. This avoids stale renderer state and keeps app-mounted agents on the
same path as normal chat.

`session.update`, `persistChatSession`, and `ChatView.vue` stop calling
browser compaction. `persistRepairedChatSession` is removed. The only
message-writing path left in the runtime is normal turn persistence.

### Stage 1: Deterministic Every-Turn Trimming

Stage 1 is unconditional, but it only changes parts that exceed a per-tool
policy or are exact duplicates. There is no global "estimated tokens above
100k" gate for Stage 1.

Policy goals:

- Preserve enough evidence for the model to reason about past work.
- Preserve enough metadata to let the agent re-read or rerun deliberately.
- Never replace non-repeatable evidence with only a one-line notice.
- Keep the last N results per tool verbatim.

Initial policies:

- **Browser observations** - keep the latest two `browser_open`/`browser_act`
  observations verbatim. Older bulky observations use the existing compact
  notice and preserve URL/title/ref counts where available.
- **`web_read`** - preserve URL, title, content length, truncation flags, and
  first/last excerpts. Include the `start_from_char` hint when the page can be
  re-read in chunks.
- **`code.run` / `bash`** - preserve command, cwd, interpreter/shell, exit
  code, duration if present, artifact paths, an initial output excerpt, and
  stdout/stderr tails. Failed commands keep a larger diagnostic tail than
  successful commands.
- **`fs_read`** - preserve path, line range, total lines/chars, truncation
  flags, and first/last excerpts. This is especially important because the
  file may change later.
- **Package and integration tools** - default to a conservative generic policy:
  keep structured scalar metadata, compact only string fields above a cap, and
  never remove IDs, URLs, paths, statuses, or error fields.
- **Dedup** - identical tool outputs with the same tool key and content hash
  collapse after the first occurrence to a reference note. The original
  occurrence remains available in the model view until it ages out through
  normal tail compaction.
- **Argument truncation** - oversized tool inputs are truncated only in the
  view. Always preserve the tool name, target path/URL/id, operation type, and
  a hash/length of the omitted payload.

The existing browser-specific helper remains in `messageCompaction.ts` and is
only invoked by `buildModelContext`. It can be inlined later if the helper has
no renderer consumers.

### Stage 2: LLM Summary On Threshold

Stage 2 writes compaction records; it still never rewrites `messages`.

- **Trigger** - use real provider usage first. Compact when
  `lastInputTokens > contextWindow - reserve`. `reserve` defaults to 16,384
  tokens and is capped at 20% of the model window for future smaller models.
  Check post-turn in `onFinish` and pre-turn before provider calls, so resumed
  sessions and model switches are covered.
- **Cut point** - walk back from the newest message keeping a target tail of
  roughly `min(20_000, modelWindow * 0.2)` estimated tokens. Prefer a user
  message boundary. If the token target lands on an assistant message, move
  forward to the next user boundary before falling back to an earlier user
  boundary; this prevents an oversized early user paste from being pulled back
  into the kept tail. Always keep the last real user message in the tail. Mim's
  current UI message shape keeps tool calls and results inside assistant
  message parts, so cutting at message boundaries preserves pair integrity.
- **Record target** - store both a display event anchor and a model cut point.
  `eventMessageId` / `eventMessageIndex` mark where compaction happened in the
  visible transcript. `firstKeptMessageId` / `firstKeptMessageIndex` mark where
  the model-visible tail starts. Ids are primary; indexes are fallbacks for old
  or malformed messages.
- **Summary model** - use the same model selected for the session turn, not the
  existing cheap renderer summary endpoint. This is a main-process helper
  dedicated to compaction, traced under the chat turn.
- **Summary template** - Goal / Done / Decisions / Open / Files touched /
  Evidence anchors. The prompt frames the summary as a dated historical record
  and explicitly says not to preserve instructions as instructions.
- **Repeat compaction** - use an update template: previous summary plus newly
  summarized messages in, merged historical summary out.
- **Guards** - after a successful compaction, estimates are untrusted until the
  next provider usage arrives. If the latest compaction already uses the same
  cut point, do not append a duplicate record for that boundary. If the
  previous compaction saved less than 10%, do not compact again for the same
  model window; surface the provider error if the session is genuinely at its
  floor.
- **Failure behavior** - summary failure writes no record and does not mutate
  messages. The next pre-turn check can try again. Failed attempts are traced.

Post-turn compaction is awaited in `onFinish`. This keeps ordering simple and
avoids a background write racing the next send. If a post-turn attempt fails,
the pre-turn check is the safety net for the next send.

### Storage

Session JSON gains `compactions`. Missing fields normalize to an empty array
for backward compatibility.

```ts
interface ContextCompactionRecord {
  id: string
  eventMessageId?: string
  eventMessageIndex?: number
  firstKeptMessageId: string
  firstKeptMessageIndex: number
  summarizedMessageCount: number
  summary: string
  tokensBefore: number
  tokensAfter: number
  savedRatio: number
  modelId: string
  trigger: 'post_turn' | 'pre_turn' | 'overflow'
  createdAt: string
}
```

Records are append-only and latest successful record wins. They should be
appended by a main-process helper in `sessions.ts`, not by generic renderer
updates. `sessionManifest.ts` does not need the summary text. If a lightweight
indicator is later useful, add only metadata such as `latestCompactionAt`.

Search keeps indexing the canonical `messages[]` projection. Today that means
user/assistant text and selected data-context filenames, not full bulky tool
outputs. Compaction must not make search worse, but expanding search recall
over historical tool outputs is a separate search design, not part of this
work.

### Triggers

1. **Post-turn** - main path. After successful turn persistence, check the
   real input-token pressure and append a compaction record if needed.
2. **Pre-turn** - before provider calls, re-read session compaction metadata
   and last token usage, then check the freshly built prompt estimate. This
   covers model switches, resumed routines, missed post-turn compaction, and
   prompt growth from tool definitions or newly attached context.
3. **Overflow recovery** - when the provider rejects with a recognized
   context-length error, do not persist the failed response. Compact with
   trigger `overflow`, rebuild context, and retry exactly once. A second
   failure surfaces to the user.

Provider error matching belongs behind a small helper with provider-specific
tests. Add details to `docs/gotchas.md` only when the patterns prove quirky.

### Renderer Contract

No renderer UI is required for Phase 1-4. The transcript remains the full
history.

The renderer shows a divider after `eventMessageId`, driven by compaction
records. For legacy records without an event anchor, it falls back to
`firstKeptMessageId` / `firstKeptMessageIndex`. The divider is trigger-aware:
pre-turn compaction says it happened before the reply, post-turn compaction
says it prepares future turns, and overflow compaction says Mim summarized and
retried after a model-window rejection. It can show the
`tokensBefore -> tokensAfter` transition, expands to the summary text, and
never hides earlier transcript messages.

While a high-context turn is waiting for the server response, the renderer can
show a transient, non-persisted status row. It starts as a context check and
switches to summarizing if the pre-stream wait continues. Oversized first
messages use separate copy because there is no earlier chat history to
summarize yet. The status row disappears as soon as the response stream opens.

The context donut reports effective context pressure only; it does not offer a
start-fresh action because automatic compaction should continue the same chat.
The donut prefers the latest compaction record's `tokensAfter` estimate over a
higher stale `lastContextTokens` value, and its tooltip distinguishes high
context checks from "using compacted context" while reminding users that the
full chat stays visible.

Interaction follows [design-system.md](../design-system.md): hover background
as affordance, no pointer cursor, terse copy, Tailwind utilities only.

## Phases

### Phase 1: Relocate, No New Behavior - Implemented

Add `src/main/ai/compaction.ts` and `compaction.test.ts`. Move browser
trimming and incomplete-tool repair into `buildModelContext`. Wire it into
`streamProfileResponse` where `compactBrowserToolResultsForContext` sits
today.

Remove compaction from:

- `session.update`
- `persistChatSession`
- `ChatView.vue`

Remove persisted repair from:

- `persistRepairedChatSession`

Expected behavior: model input remains equivalent to today's compacted view,
but stored messages stop being edited by compaction/repair.

Tests:

- `session.update` preserves large browser observations verbatim.
- `buildModelContext` compacts old browser observations in the returned view.
- repair removes incomplete tool parts from the returned view only.
- `streamProfileResponse` passes the built view to validation/conversion.

### Phase 2: Conservative Stage 1 Generalization - Implemented

Add the per-tool policies, dedup, and argument truncation as pure view rules.

Tests assert:

- stable output for repeated calls with the same input;
- last-N verbatim behavior per tool;
- failed command output keeps diagnostic tails;
- metadata required to re-read/rerun is preserved;
- tool-call/result pair integrity at message boundaries;
- original `messages` object is not mutated.

### Phase 3: Compaction Records And Summaries - Implemented

Add `compactions` to session normalization and storage. Add a main-process
append helper for compaction records. Add threshold checks, cut-point
selection, compaction summary generation, update-summary generation,
fresh-compaction handling, and anti-thrash guards.

`streamProfileResponse` re-reads session metadata with the turn trace context
before building model context. Compaction summary calls trace as
`chat.compaction` under the turn trace, with `tokensBefore`, `tokensAfter`,
`savedRatio`, `firstKeptMessageId`, and `trigger`.

Implemented coverage includes session normalization/storage, generic
`session.update` ignoring renderer-supplied compactions, append-only record
writes that leave `messages[]` untouched, stored-record model views, post-turn
record creation, previous-usage pre-turn catch-up, and fresh-prompt preflight
before provider prompting.

### Phase 4: Overflow Recovery - Implemented

Add provider context-length error classification and retry-once behavior in
the turn loop.

Implemented coverage mocks the provider boundary to return a context-length
error and asserts:

- exactly one compaction attempt;
- exactly one retry;
- no failed assistant/error message is persisted before retry;
- a second context-length failure surfaces normally.

### Phase 5: Renderer Divider - Implemented

Add the transcript divider driven by `session.compactions`.

Implemented coverage includes:

- divider placement after `eventMessageId` / index fallback, with
  `firstKeptMessageId` / index fallback for legacy records;
- expandable summary text;
- trigger-aware divider copy and compact token transition labels;
- transient pre-stream status copy for checking, summarizing, and oversized
  first-message states;
- full transcript remains visible;
- session-store merging of backend compaction metadata after turn persistence.

## Backward Compatibility And Migration

- Existing sessions with no `compactions` field load as `compactions: []`.
- Existing sessions already containing compacted browser notices keep those
  notices; the removed content cannot be reconstructed.
- `lastInputTokens` and `lastContextTokens` are provider-reported usage after
  a normal model turn. Immediately after a compaction record append, both are
  set to the record's `tokensAfter` estimate so UI/context-pressure checks
  reflect the effective compacted model view until the next provider usage
  replaces them.
- Existing renderer/session update flows continue to work in Phase 1. The
  only immediate behavior change is that compaction/repair no longer mutates
  persisted messages.
- No migration rewrites session files. Session files update naturally on the
  next normal session write or compaction-record append.

## Explicitly Not Building

- **Manual compact-now command** - it adds UI vocabulary without solving a
  current user problem. Automatic threshold and overflow handling are enough.
- **Auxiliary summarizer-model config** - use the session model for compaction
  summaries. Revisit only if cost or latency becomes a proven problem.
- **Session trees / branching** - Mim does not have branching chat sessions.
- **Split-turn prefix summaries** - cut at message boundaries. A single turn
  too large for that is handled by overflow recovery.
- **Focus topics / custom summary instructions** - the summary template is the
  contract. User-steered summaries would make compaction feel like a second
  memory feature.
- **Extension hooks on compaction** - no consumer exists yet.
- **Session rotation or destructive compression** - unnecessary when
  compaction records are separate from transcript messages.
- **Search expansion over bulky tool outputs** - useful later, but separate
  from protecting model context.

## Remaining Implementation Choices

- Exact per-tool Stage 1 caps. Start conservative and tune with tests against
  real large `web_read`, `fs_read`, and command-output transcripts.
- Exact post-turn compaction timeout. Add an abortable timeout only if
  compaction latency proves able to block normal persistence for too long.
