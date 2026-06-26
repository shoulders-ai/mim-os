# AI Tools

Read this before changing chat tools.

## Map

- AI-facing tools: `src/main/ai/aiRuntime.ts`
- Inline editor tools: `src/main/ai/aiRuntime.ts`
- Kernel tools: `src/main/tools/*.ts`, `src/main/sessions.ts`, `src/main/ai/ai.ts`, `src/main/pty.ts`
- Prompt tool list: `src/main/ai/systemPrompt.ts`
- Permission policy: `src/main/security/gate.ts`

## Rules

- AI SDK `tool()` definitions use `inputSchema`, never `parameters`.
- AI-facing names use underscores: `fs_read`, `editor_open`, `package_create`.
- Kernel names use dots: `fs.read`, `editor.open`, `package.create`.
- AI SDK tools are defined in the main process and must call `tools.call(name, params, { actor: 'ai', sessionId })`.
- Main-process permission gate owns approval. Do not add renderer-side approval gates.
- AI-facing tools must preserve the real kernel tool semantics. A tool named `fs_create` must call `fs.create` and create the file after the permission gate allows it; do not route real actions into a separate proposal state.
- Tool descriptions are for the model. Describe constraints and non-obvious behavior only.

## File Tools

- `fs_list` returns capped workspace entries with `path`, `name`, `type`, `size`, `modifiedAt`, `createdAt`, and optional `lastChangedBy` when `include_last_changed_by` is true; recursive mode skips heavy/generated directories.
- `fs_read` returns `{ content, path, total_lines, start_line, end_line, total_chars, hash, version, truncated }`; `hash`/`version.hash` are for the full file, even when `content` is a line window or `max_chars`-truncated.
- `fs_write` overwrites the whole file after the permission gate allows it. Prefer `fs_edit` for small changes.
- `fs_edit` changes the file after the permission gate allows it, requires exactly one match, and tolerates common LLM typography/whitespace drift.
- `fs_create` and `fs_delete` mutate the real filesystem after the permission gate allows them.
- If an action needs approval, the permission gate suspends the exact tool call before execution. The result returned to the model must describe the real executed action, not a durable proposal.
- Backend-only `fs.exists` remains for packages/internal calls; it is not exposed to chat.
- `fs.copy`, `fs.trash` (recoverable OS Trash), and `fs.import` (ingest an external absolute path) are kernel tools driven by the Files UI; they are not exposed to chat. Chat deletion stays `fs_delete` (hard delete).

## Cross-Surface Tools

- `editor_open` opens a workspace path in the Editor Artifact.
- `terminal_run` calls `terminal.run` as the AI actor. The renderer keeps the current Chat Work surface visible and mounts the scratch Terminal in the background before writing the command. The tool returns after the command is sent; it does not return stdout or stderr to the model. Direct user/app-shell terminal actions still reveal Terminal Work before writing.

## Comment Tools

Chat exposes inline markdown review tools:

- `comments_list` parses a markdown file and returns thread anchors, notes, raw offsets, and line numbers.
- `comments_add` anchors a new thread by exact `anchor_text`; it matches the human-visible stripped document first, then raw text, and refuses ambiguous or overlapping anchors.
- `comments_reply` appends a note to an existing thread.
- `comments_resolve` deletes the comment wrapper and notes while keeping the anchor text.

The document on disk remains raw: `<comment>` and `<note>` tags are visible to `fs_read`. Prefer `comments_*` tools over direct `fs_edit` changes when adding, replying to, or resolving threads. Direct file edits may change prose around comments, but should not hand-edit tag markup unless the comments tools cannot express the operation.

## Integration Tools

Chat exposes selected personal integration tools through `src/main/ai/aiRuntime.ts`.

- Slack read tools: `slack_search`, `slack_history`, `slack_channels`.
- Google read tools: `gmail_search`, `gmail_read`, `calendar_events`, `drive_search`, `docs_read`, `sheets_meta`, `sheets_read`.
- Google outbound/write tools: `gmail_send`, `calendar_create`, `sheets_write`, `sheets_append`.

Slack send is a kernel/CLI tool only, not a chat tool. Google outbound/write chat tools are `external` main-process tool calls and require approval in normal and strict modes (their `high` risk only drives the approval card's caution styling).

Slack tools are included only when `connectors.slack.aiEnabled` allows them. Google tools are included only when Google is connected, `connectors.google.aiEnabled` allows them, the relevant service toggle is enabled, and the stored token grants the required OAuth scopes.

Integration secrets stay in the OS keychain via `src/main/integrations/secrets.ts`. Packages cannot call personal Slack or Google tools in runtime v1.

## Web Tools

Chat exposes search plus one URL reader:

- `web_search` calls `web.search` and returns search results via the Exa API. Returns `query` and `results[]` with `title`, `url`, `snippet`. Requires `EXA_API_KEY` in env or `~/.mim/keys.env` (set via Settings → Models → Integrations). Category `network`, risk `medium`.
- `web_read` calls `web.read`, the single model-facing reader. It returns cleaned content from selectable PDFs or Chromium-rendered web pages with `url`, `final_url`, `title`, `content`, `content_length`, `source`, `elapsed_ms`, and chunk continuation fields when truncated. PDF routing is mechanical: `.pdf` paths or successful `HEAD` responses with a PDF content type use local `pdfjs-dist` extraction. Other pages render in a stateless hidden Chromium session and flow through the shared HTML-to-Markdown parser. Passing `stateful: true` uses the persistent Research Browser profile (`persist:mim-research`) after a domain grant exists; agents should ask before using saved browser state. `web_read` does not return page-status verdicts, capture diagnostics, source health, hidden fallback attempts, or cache metadata. Only public `http`/`https` URLs are allowed; private/loopback initial URLs, redirect targets, and rendered subresource requests are blocked. Category `network`, risk `medium`.

Research Browser setup remains kernel/UI-only. `web.research.status` returns `{ enabled, allowedDomains, profile_available }`; `web.research.allowDomain`, `web.research.removeDomain`, `web.research.open`, and `web.research.clearProfile` maintain grants and the persistent profile.

Implementation: `src/main/web/webSearch.ts`, `src/main/web/readWebUrl.ts`, `src/main/web/readUrl.ts`, `src/main/web/readRenderedUrl.ts`, `src/main/web/readResearchUrl.ts`, `src/main/web/researchBrowser.ts`, `src/main/web/researchSettings.ts`, `src/main/web/renderedBrowser.ts`, `src/main/web/renderedCapture.ts`. Tests: `src/main/web/webSearch.test.ts`, `src/main/web/readWebUrl.test.ts`, `src/main/web/readUrl.test.ts`, `src/main/web/webReadEvaluation.test.ts`, `src/main/web/readRenderedUrl.test.ts`, `src/main/web/readResearchUrl.test.ts`, `src/main/web/researchBrowser.test.ts`, `src/main/web/researchSettings.test.ts`, `src/main/web/renderedBrowser.test.ts`, `src/main/web/renderedCapture.test.ts`, `src/main/tools/web.test.ts`.

## Trace Tools

Chat exposes trace analysis tools over the local audit stream:

- `trace_query` calls `trace.query` and returns capped, redacted digest events. Blob payloads are returned by `payloadRef` only, never inlined.
- `trace_stats` calls `trace.stats` and aggregates tool errors/durations, model tokens/cost, package events, gate decisions, job health, day trends, and post-AI edit outcomes.

Both tools are read-only kernel calls and inherit the active chat session trace context.

## Package Tools

Enabled package AI tools are passed into `createAiSdkTools({ packageTools })`.
They are exposed under the runtime-generated public name and execute through `package.tools.execute`.
Package tools cannot shadow core AI tool names.

Package authoring tools are also exposed to chat, but the built-in `build-app`
skill gates the dev-loop surface until it activates. The AI-facing wrappers are:

- `package_create` for UI or headless package scaffolds, including backend,
  manifest permissions/provides, package skills, and README content.
- `package_validate` for direct workspace package diagnostics before relying on
  the loader.
- `package_reload` for rescan + runtime cache invalidation + named-tool sync.
- `app_status` and `app_enable` for enablement state. `app.trust` is not an AI
  tool and remains user-only.
- `package_capabilities_list`, `package_tools_execute`, and
  `package_jobs_start` for verification after reload/enable.

## Skill Gating

Tools declared in skill `unlocks:` frontmatter are removed from the visible
chat tool set until their skill activates, either by the model calling
`skill(name)` or by a composer-selected chip sent as `skills: string[]` in the
`/api/ai/chat` body. The controlled set is derived from `skill.list` per request
(`listSkillUnlocks`); a skill that unlocks a base tool name gates that tool for
every chat. `tools:` is descriptive catalog metadata. See [skills.md](skills.md).

## Backend AI And Document Tools

- `ai.generateObject` is a kernel tool for package backend jobs. It is not
  exposed as a chat tool. Packages must declare `ai: true`.
- Package backends can also use `ctx.ai.callAnthropic` for Anthropic tool loops
  and `ctx.ai.callGemini` for Gemini text calls. These route through the same
  main-process key resolver but are runtime helpers, not chat tools.
- `documents.docx.extract`, `documents.docx.read`, `documents.docx.annotate`,
  `documents.docx.comments`, `documents.docx.validate`, and
  `documents.docx.workerStatus` are kernel tools for package jobs and internal
  workflows. Chat reaches them through package tools such as DOCX Review.
- `documents.pdf.extract` is a kernel PDF text helper for package jobs and
  internal workflows. It reads workspace PDFs and returns selectable text plus
  basic metadata; package UIs should write dropped PDFs into the workspace
  first, then call this helper from backend jobs.
- `documents.importMarkdown` and `documents.importMarkdown.formats` are kernel
  tools for package jobs and internal workflows. The external Import to
  Markdown package in shoulders-ai/mim-apps exposes the user-facing app/tool
  for DOCX, XLSX/XLSM, BibTeX, and selectable-text PDF conversion.

## Tests

- `src/main/ai/aiRuntime.test.ts` protects AI-facing names, schemas, dispatch, package tools, and provider endpoint normalization.
- `src/main/server/server-ai.test.ts` protects `/api/ai/chat`, `/api/ai/inline`, and `/api/ai/ghost` endpoint wiring.
- `src/main/tools/fs.test.ts` protects filesystem behavior.
- `src/main/search/textMatch.test.ts` protects `fs_edit` matching.
