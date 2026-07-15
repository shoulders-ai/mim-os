# Ontology — The Concepts of Mim

**DO NOT ACT ON THIS BEFORE USER REVIEW AND EXPLICIT INSTRUCTIONS.**

**Status: DRAFT v1 — under review.** This document is the constitution for naming.
Every concept Mim has, and the only word for each. UI, docs, code, tool names,
and the SDK defer to this file. The migration plan and old→new mappings live in
[vocabulary.md](vocabulary.md).

## Laws

1. **One word per concept, everywhere.** UI label, doc prose, code identifier,
   tool name, SDK call — same word. Nothing is "developer-facing."
2. **The UI label is the source of truth.** Code follows the screen, not the
   other way around.
3. **No synonyms, even in prose.** If the concept is Chat, docs never say
   "conversation" as a name (plain-English use as a common noun is fine;
   naming a feature with it is not).
4. **New nouns need a funeral.** Adding a concept requires retiring or merging
   one. The kernel set below only shrinks.
5. **The Dr. R test.** Every definition must be understandable by a
   non-programmer researcher. If a definition needs implementation words, the
   concept isn't done.
6. **A rename isn't done until all three layers agree.** UI + docs + code in
   one change, with the mapping recorded in vocabulary.md.

## Kernel concepts (12)

| Concept | Definition | Is NOT | Canonical spellings |
|---|---|---|---|
| **Workspace** | A folder on your machine holding one project: its files, settings, and record of work. Everything Mim knows about a project lives inside it. | The app itself; your whole machine; a "folder" or "project" (those words don't name this). | UI "Workspace" · code `workspace` · disk `mim.yaml`, `.mim/` |
| **File** | Any item in the workspace. Files are the source of truth: everything durable Mim produces is a file a colleague could read without Mim. | An artifact-pane entry (that's just a file being shown). | UI "file" · tools `fs.*` |
| **Chat** | A conversation with Mim's agent. Has a transcript, cost, and a state: **active** or **done**. | An agent run (a CLI agent working in a terminal); internal word "session" dies. ⚖ | UI "Chat" · code `chat`, `chatId` (today: `session`) |
| **Run** | Umbrella for any tracked unit of work: a chat, an agent run, or an app run. Every run has a status, a place in History, and a trace. ⚖ | A tool call (too small); a workspace (too big). | UI "run" / sidebar section "Runs" · code `run`, `RunKind` |
| **Agent** | An AI worker. Mim's built-in agent powers Chat; CLI agents (Claude Code, Codex, Gemini) work in terminals as **agent runs**. | A tool; an app. "Agent session" dies (→ agent run). | UI "agent", "agent run" · code `agent`, `agentRun` |
| **App** | An installable unit that extends Mim. One app may contribute views, tools, skills, and background jobs. The word **"package" dies everywhere** — tools, types, folders, events, manifest prose. | A skill (knowledge, not surface); a tool (one ability, not a unit). | UI "App" · tools `app.*` · code `app` (today: `package`) |
| **Skill** | A written workflow the agent loads when a task calls for it. May unlock tools while active. | Instructions (always-on); an app (a skill has no surface). | UI "Skill" · code `skill` · disk `SKILL.md` |
| **Tool** | A single ability an agent or app can call: read a file, search the web, send a message. Every tool call passes the approval policy and emits a trace event; local audit storage is optional. | A skill; an app; an integration (a Connection *provides* tools). | UI "tool" · registry `namespace.verb` |
| **Approval** | Your permission decision for a consequential tool call. Modes: Strict / Normal / Allow all. Grants can be per-chat or standing. | A trust rating; a security sandbox. | UI "Approve / Decline" · code `approval`, gate internals |
| **Trace** | The permanent record of what every actor did: who, what, when, outcome. Powers Review and History detail. | The Logbook (curated notes); Telemetry (anonymous, for the makers); Snapshots (file contents). | UI "trace" · disk `.mim/traces/` |
| **Snapshot** | A saved version of a file you can go back to. Captured automatically around edits and saves. | Git; the History surface; a backup of the whole workspace. Word "history" for this dies. ⚖ | UI "Snapshots" · code `snapshot` (today: `history/`) |
| **Collection** | A shared folder brought into the workspace from elsewhere (a drive, a git repo), read-only or writable. | A workspace; an app's private data. Word "resource" dies. ⚖ | UI "Collection" · tools `collections.*` (today: `resources.*`) |

⚖ = contested call, flagged for review in vocabulary.md before execution.

## Surfaces (6)

Surfaces are *places*; they are named after what the user does there, and their
names are reserved words.

| Surface | What it is | Replaces |
|---|---|---|
| **Chat** | Talk with the agent. | — |
| **Files** | Browse and manage workspace files. | — |
| **Terminal** | Shells and CLI agent runs. | — |
| **Review** | What agents and apps did: runs, approvals, notable events; power tab **Audit**. ⚖ | "Monitor", "Trust", `activity-trust` |
| **History** | Past runs: done chats, finished agent runs and app runs. Search and reopen. | "Archive" (code + verbs) |
| **Settings** | Configuration. | — |

## Second-tier concepts

Defined, allowed, subordinate — they never compete with kernel nouns.

- **Document** — a text file open in the editor. The editor pane word; on disk it is a File.
- **Instructions** — the standing contract for agents (`AGENTS.md`): how to behave, always in context.
- **Connection** — a linked external account (Slack, Google) that provides tools.
- **Comment** — an inline note in a document, threaded, travels with the file.
- **Citation** — a reference in a document, resolved against the workspace bibliography.
- **Logbook** — the optional human-readable project diary (`.mim/log.md`).
- **Model** — the AI model behind a feature, with per-feature defaults.
- **View** — a surface contributed by an app.
- **Job** — background work inside an app run. Never user-facing as a standalone noun.

## State and verb vocabulary

One status set for every run kind (today there are five overlapping enums):

> **working · needs-input · needs-approval · done · error · stopped · ready**

`completed`, `failed`, `cancelled`, `interrupted` die (→ done / error / stopped). ⚖

Reserved verbs, one meaning each:

| Verb | Meaning | Never means |
|---|---|---|
| **Done** | Mark a run finished; it moves to History. | Delete. "Archive" dies as a verb. |
| **Reopen** | Bring a done run back to active. | "Unarchive", "restore" (for runs) die. |
| **Accept / Reject** | Decide on a proposed file change (diff review). | Approving a tool call. |
| **Approve / Decline** | Decide on a tool-call approval. | Accepting a diff. |
| **Go back** | Return a file to a snapshot. | Reopening a run. |
| **Delete** | Permanently remove. | Done, Stop. |
| **Stop** | Halt a working run. | Delete, Done. |

## Banned words

Maintained in [vocabulary.md](vocabulary.md) and enforced by CI once the
migration lands. Headline entries: **package**, **archive** (as verb/label),
**monitor**, **trust** (as a surface), **resource**, **session** (user-facing),
**unarchive**, **activity** (as a concept name), **workflow** (dead RunKind),
**project/folder** (when the thing is a Workspace).
