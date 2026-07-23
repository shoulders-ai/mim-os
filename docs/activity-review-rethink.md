# Review / Audit surface — implementation plan

Authoritative design direction for the surface formerly launched as **Trust**
(`work:activity-trust`, `src/renderer/components/activity/ActivityTrustView.vue`).

Read this before touching `ActivityTrustView.vue`.

Decision locked: the user-facing surface is **Review**. The internal work kind
may stay `activity-trust` until a broad naming cleanup, but the Navigator row,
command palette label, and Work title say Review. This avoids the existing
Navigator **Activity** section collision and names the user's job instead of the
product promise.

---

## 1. Problem — why the current surface fails

The surface is a 918-line monolith with four peer tabs (**Activity**,
**Health**, **Timeline**, **Ledger**) behind a launcher called **Trust**. Four
concrete failures:

1. **Four products under one launcher.** The tabs sit at four different
   altitudes — Activity is run-level narration, Health is aggregate triage,
   Timeline is the raw event firehose, Ledger is the audit log. The tell: Health
   is only useful by *pre-filling a search and bouncing the user to another
   tab*. That is not navigation between views of one thing; it is four surfaces
   taped together.

2. **Observability vocabulary, not the user's.** `trace`, `event`, `span`,
   `actor`, `Ledger`, `Health`, `Denials`, `Model cost`, `Post-AI edits` — this
   is OTLP/APM language. Worse, *the same datum* is called a trace in one tab, an
   event in another, a run in the feed, and a ledger entry in a third. Five names
   for overlapping things. This is the literal cause of "the words don't all mean
   the same thing."

3. **"Trust" is a promise the screen breaks.** Trust is a relationship word.
   Behind it is a log viewer measured in event counts and dollar cost. Trust is
   earned through legibility and control, not a denials counter.

4. **Entirely rear-view, read-only.** Every pixel reports what already happened.
   You cannot correct, annotate, revert-from-here, or steer anything. For an
   audit tool that is correct. But it is the opposite of the iterative
   improvement loop that is the surface's actual reason to exist. Today it is all
   mirror and no steering wheel.

`narrate.ts` is the one part that is *right*: it already speaks plain language
("Edited report.md", "Approved fs.write", "Contacted api.example.com"). The
chrome wrapped around it does not. The rethink keeps `narrate.ts` and replaces
the chrome.

---

## 2. The reframe — two jobs, two people

There are only two jobs here, and conflating them is the root mistake.

- **Job A — "What did Mim just do, and was it right?"** Everyday, end-user,
  in-the-moment. Run-centric, narrated, and it must let the user **act** on what
  they see. This is the hero. It is not "observability"; it is **Review**.

- **Job B — "Show me the machinery."** Occasional, forward-deployed-engineer,
  invoked when something broke or compliance asks. Trace firehose, spans, raw
  JSON, export. **Health + Timeline + Ledger are all this one job** wearing three
  hats. It is Phase 6 power-depth, not three top-level tabs.

Job A is the default surface. Job B is one lens behind a toggle.

---

## 3. North-star information architecture

Collapse **4 tabs → 1 primary surface + 1 power lens**.

```
Navigator → Review                           (launcher; was "Trust")
  │
  ├─ Review                 (Job A, default — triage + narrated Runs)
  │     ├─ needs review     (deterministic flags: errors, denials, reverts)
  │     ├─ all Runs         (one grouped unit per chat turn/app run/agent)
  │     └─ a Run            (open one — the hero detail view)
  │           ├─ Story      (narrated steps, default lens — already built)
  │           ├─ Timeline   (span waterfall, lens toggle — already built)
  │           ├─ Evidence   (captured payloads, messages, results, diffs)
  │           ├─ header     (cost / latency / tokens / errors / files)
  │           └─ actions    (note/correction now; analyze/improve later)
  │
  └─ Audit                 (Job B, behind a toggle — the firehose)
        Important filter by default; full log behind an explicit toggle:
        raw events, structured filters, JSON, OTLP/OpenInference export (Phase 6)
```

- The **Review** landing is not a second Runs list. It starts with attention
  cards, then exposes the full Runs list below or behind a compact "All runs"
  affordance. The product question is "what needs my review?", not "what is the
  newest trace?"
- The **Runs feed** is the everyday substrate: one row per Run, narrated, with
  approval/external badges. The model-rooted housekeeping filter stays.
- A **Run** is the durable object the user reviews. Story is the default lens;
  Story⇄Timeline survives and gains Evidence once payload rendering lands.
- **Improve** is not a tab. It appears only as a contextual action from selected
  Runs or a Run detail once the bundle builder and durable write destinations
  exist. Do not render an empty Improve surface.
- **Audit** absorbs Health, the global Timeline, and the Ledger. It is one power
  surface for the engineer, not the default. Do not preserve three separate tabs
  inside it; it is filters + a flat event table + detail.

---

## 4. Vocabulary — canonical terms and kill list

One noun for the unit, one verb for the surface. Everything else dies.

| Concept | Canonical user-facing term | Kill / never show |
|---|---|---|
| The surface (launcher, palette, work title) | **Review** | "Trust", "Activity & Trust" |
| One grouped unit of work | **Run** | trace, event-group, ledger entry, "activity" (as a count) |
| One thing inside a Run | **step** | span, event |
| Narrated lens of a Run | **Story** | — (keep) |
| Technical lens of a Run | **Timeline** | — (keep, but scoped *inside* a Run) |
| Captured support for a step | **Evidence** | payload, blob |
| The engineer's firehose | **Audit** | Health, Ledger, global Timeline as peers |
| Who acted | **Mim / You / a package** | "actor", "AI", "principal" |
| Money | **cost** | "Model cost" |
| A blocked/approved action | **approval / denial** | "gate.decision", "Denials" (as a metric tile) |
| User-authored feedback | **correction** | memory |
| Accepted future instruction | **guidance** | memory |

"Trust" survives only as a *value proposition in prose*, never as a tab or
launcher label. The OTLP words (`trace`, `span`, `actor`, `principal`) stay in
the **code and trace files** — they are correct there — but never surface in the
normal Review UI. Audit may expose `traceId` and raw JSON inside developer
detail because its job is proof and debugging.

The rename reaches `entries.ts`, `App.vue`, `ShellSidebar.vue`, and the command
palette entry. Update all four together; no transitional alias in the visible UI.

---

## 5. Data prerequisite — persist effect

The Review/Audit split needs one small trace-envelope upgrade before the UI can
be credible: every `tool.call`, `tool.result`, and `tool.error` event must carry
the resolved tool **effect**:

```ts
effect: 'read' | 'mutate' | 'external'
```

The source of truth is `toolEffect()` from `src/main/security/gate.ts`, stamped
at capture time by `src/main/tools/registry.ts`. Do **not** infer it later in
the renderer: tool policies can change, package-provided tool policies can be
dynamic, and historical traces should remain historically true.

Why this matters:

- Review can suppress read plumbing (`fs.list`, `session.get`, `settings.get`,
  `trace.query`) while still showing consequential work.
- Audit can default to **Important** (`mutate`, `external`, errors, approvals,
  denials, reverts) while retaining **Full log** for proof.
- AI analysis bundles can include scoped, consequential evidence instead of
  brittle string filters over tool names.

---

## 6. Component decomposition

`ActivityTrustView.vue` (918 lines) becomes a thin shell plus parts. This
extends the decomposition the roadmap already named (Phase 1a partially built
`RunView`, `SpanTree`, `SpanDetail`):

```
ActivityTrustView.vue   thin compatibility shell for work:activity-trust
  ReviewView.vue        Job A: triage + all Runs + Run drill-down
  ActivityFeed.vue      Runs list used by Review
  ReviewQueue.vue       deterministic attention cards
  RunView.vue           a Run (Story + Timeline lenses)         [exists]
    SpanTree.vue        Timeline waterfall                       [exists]
    SpanDetail.vue      step detail                              [exists]
    EvidenceView.vue    payload/messages/results/diffs           [new]
    RunActions          note/correction; analyze later            [new]
  AuditView.vue         Job B: important/full filters + event table + JSON
  useTraceData.ts       composable/store replacing the inline fetch in the monolith
```

`narrate.ts` and `spans.ts` are unchanged engines. The data fetch currently
inline in `ActivityTrustView.vue` moves into `useTraceData` (a store is overdue;
the roadmap already flagged this).

---

## 7. The action layer — where the improvement loop actually lives

This is what turns a log viewer into Review, and it is also the answer to last
session's confusion ("how is Memory related to the apps we're tracking??").

**Memory is not a sibling of app-tracking. It is the action layer on top of
Review.** In the UI, the words are **correction** and **guidance**. The chain,
all grounded in machinery that already exists or is already planned:

1. While reviewing a **Run**, the user attaches a **note/correction** to a step.
   This is roadmap **Phase 3 (Notes)** — a `note`-kind trace event referencing a
   `spanId`, on a real durable write path.
2. Confirmed corrections distil into workspace guidance via a new durable,
   user-authored guidance store that feeds the **existing**
   `.mim/agent-context.md` renderer (`src/main/ai/agentContext.ts`) — roadmap
   **Phase 5**. No new `memory.*` core subsystem, no magic. "Mim remembers my
   corrections" = the agent-context digest gains a visible section fed by
   confirmed guidance.
3. Optional capstone: **re-run this step with my correction** (span-replay,
   depends on the Phase 0.3 payload capture that already shipped).

So the firehose (Audit, Job B) and the learning loop (Review actions, Job A) are
not two features fighting for one tab. One is the rear-view; the other is the
steering wheel. They share the same trace data and nothing else.

---

### AI analysis, bounded

The high-value AI action is **Analyze selected runs**. It is explicitly scoped:
this run, selected runs, failed runs, one app, or a date range. Mim first builds
a deterministic evidence bundle from run summaries, effects, errors, approvals,
external calls, file changes, reverts, and selected payload excerpts. The model
returns proposals with evidence references, confidence, and destination. It
does not directly edit package prompts or hidden memory.

V1 destinations:

- note/correction on the Run or step
- workspace guidance, once the guidance store exists
- issue, only when the Board package is installed
- copy/export proposal

Not V1: "accept into app prompt." Mim and Team apps are owned by their source,
and Project app edits require a deliberate authored change rather than hidden
prompt mutation from an activity review.

Counts discipline:

- Deterministic signals may show exact counts: same tool failed, same package
  failed, same error string/code, same file reverted, same approval denied.
- Semantic recurrences are AI-inferred and must be labeled as such with
  confidence. Never show AI clustering as exact telemetry.

---

## 8. Sequencing

Respects the roadmap gate ("don't build the learning loop before Notes exists").

1. **Effect capture** (main-process, low risk): stamp `effect` onto tool trace
   events and update trace types/tests. This is the filtering prerequisite.
2. **Review/Audit shell + vocabulary** (renderer, visible fix): replace the four
   peer tabs with Review ⇄ Audit, land deterministic review items and all Runs
   in Review, fold Health/Timeline/Ledger into `AuditView`, and apply the §4
   rename across `entries.ts` / `App.vue` / `ShellSidebar.vue` / command
   palette. This kills failures 1–3 from §1.
3. **Run Evidence** (roadmap 1b/1c): add the Evidence lens and run header stats
   using `trace.payload`; no AI yet.
4. **Notes/corrections** (roadmap Phase 3): durable write path attached to a Run
   or step. This fixes failure 4.
5. **Analyze selected runs**: bundle builder + on-demand AI proposals. The model
   analyzes selected evidence only and returns editable proposals.
6. **Durable guidance** (Phase 5): accepted corrections become visible guidance
   injected through agent context. App-prompt overrides remain out of scope until
   the override mechanism is designed.

Step 1 is the deliverable that replaces the Trust UI. Steps 3–4 deliver the improvement loop.

---

## 9. What dies — no transitional crutch

Zero users, zero backward-compat obligation. Cut clean:

- The four-tab `MimSegmented` and the **Health**, **Ledger**, global
  **Timeline** tabs as peers. Their useful content reappears inside `AuditView`.
- The **metric strip** (Events / Errors / Model cost / Denials / Failed jobs /
  Post-AI edits) as a top-level always-on header. Aggregate health belongs in
  Audit, not in the user's everyday face.
- The launcher/title/palette strings "Trust" and "Activity & Trust".
- Any empty **Improve** tab. Improve appears only when the action exists.
- App-prompt edits for immutable registry packages in v1.

Do not ship a both-worlds intermediate (e.g. keeping Ledger as a tab "for now").

---

## 10. Adjacent debt — do not lose (from the Opus independent review)

Tracked here so the rethink doesn't bury it; these are independent of the IA work
and should be cleared alongside step 1:

- **Cleared in the Review/Audit slice** — `isSecretBearingTool`
  (`src/main/tools/registry.ts`) now denies key/OAuth/code-exchange tools and any
  tool name containing `secret`, `token`, or `credential` in any casing, covering
  camelCase credential tools (`slack.setToken`, `google.setTokenBundle`,
  `google.setOAuthClient`, `google.exchangeCode`).
- **MEDIUM** — the `chat.turn.done` model-I/O blob in `aiRuntime.ts` is written
  with no `maxBytes` and duplicates content already blobbed per `tool.result`.
- **TEST GAP** — `streamProfileResponse` (`aiRuntime.ts`) is unexported and only
  smoke-tested; turn-trace threading and model-I/O capture are verified only
  indirectly.
