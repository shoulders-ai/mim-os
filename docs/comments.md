# Inline Comments

Review comments are stored inline in the file; the file on disk is the source of truth and presentation surfaces decide whether to hide or strip the markup. Two formats exist, routed by file type:

- **Markdown** (`.md`, `.markdown`, `.mdx`, untitled tabs): pseudo-HTML `<comment>` wrappers around the anchored text.
- **Code and plain text** (anything with a known line-comment syntax): whole-line `@mim` markers above the anchored line.

`src/main/comments/dispatch.ts` routes tool calls to the right model by path.

## Markdown syntax

```md
We propose <comment id="k3f9">a staged rollout<note by="paul" at="2026-06-13T09:14">Too slow.</note><note by="ai" at="2026-06-13T09:20">Phase 2 gates it.</note></comment> over six weeks.
```

- `<comment id="...">` wraps the visible anchor text.
- `<note by="..." at="...">...</note>` children hold the thread body. The first note is the original comment; later notes are replies.
- Note bodies escape only `&` and `<` on write.
- Resolve deletes the wrapper and notes while keeping the anchor text.

The pure parser/model lives in `src/main/comments/model.ts`; tests are in `model.test.ts`.

## Code syntax

```py
# @mim(k3f9) paul 2026-06-13T09:14: This bound looks wrong
# @mim(k3f9) ai 2026-06-13T09:20: Fixed by clamping below
def clamp(x):
```

- A marker is a whole line in the file's own comment syntax (`#`, `//`, `<!-- -->`, `/* */`, `--`, `%`, or bare for `.txt`). `commentPrefixForPath` maps extensions; formats where a comment line would corrupt the file (JSON, CSV) are unsupported and `comments.add` refuses them.
- Consecutive marker lines with the same id form one thread; the first line is the comment, later lines are replies. The thread anchors to the next non-marker line.
- Marker indentation matches the anchored line. Note text is single-line (newlines flatten to spaces).
- Resolve deletes the marker lines and keeps the code.
- Threads reuse the markdown `CommentThread` shape (`[tagFrom, tagTo)` = marker block, `[anchorFrom, anchorTo)` = anchored line after it), so the rail, tools, and chat handoff work unchanged.

The model lives in `src/main/comments/codeModel.ts`; tests are in `codeModel.test.ts`.

## Surfaces

| Surface | Treatment |
|---|---|
| Editor | Markup hidden with CodeMirror replace decorations; anchors highlighted; cards render in the right review rail |
| Preview | Markdown tags stripped before sanitize/render |
| Export | Markdown tags stripped in `src/main/tools/export.ts` before PDF/DOCX generation |
| Stats | Word/char counts use stripped text (markdown) |
| Diff view | Markdown tags hidden via `commentsHideExtension` (decorations only, doc model stays raw) |
| AI file reads | Raw file content, markup included; the system prompt documents both formats and directs mutations through the comments tools |
| Search | Raw text matching, so note bodies are searchable; result snippets render comment markup readably as `anchor [author: note]` |

## Tools

Main-process tools are registered by `src/main/tools/comments.ts` and dispatch by path (markdown vs code):

- `comments.list`
- `comments.add`
- `comments.reply`
- `comments.resolve` — pass `id` to resolve one thread, or `all: true` to resolve every thread in the file

AI-facing chat tools use underscore names in `src/main/ai/aiRuntime.ts`: `comments_list`, `comments_add`, `comments_reply`, and `comments_resolve`. The same four tools are exposed over MCP for CLI agents.

Mutation tools write through the same hash-safe file pattern as `fs.write`. They refuse to mutate a file that is open and dirty in the editor; the renderer sends dirty open paths through `pushDirtyTabCount({ count, paths })`.

Comment mutations are captured by workspace history (`before-edit`/`after-edit` snapshots via the tool observer in `src/main/history/history.ts`), so a resolve — including resolve-all — is recoverable from local history.

### Attribution

The note `by` handle resolves as: explicit `by` param > connected MCP client name (from the MCP `initialize` clientInfo, carried as `ToolContext.agent`) > `'ai'` for desktop-chat calls > configured user name. So a Claude Code session's comments are signed `claude-code`, not as the workspace user. `isAgentAuthor()` in `model.ts` classifies machine handles; `CommentCard` renders agent-authored notes with an accent sparkles icon.

## Editor

The CodeMirror extension is `src/renderer/components/editor/codemirror/comments.js`. It is parameterized by parser: markdown by default, `parseCodeComments` for code files (chosen per tab in `EditorPanel`).

It uses four layers:

- replace decorations for hidden markup
- mark decorations for visible anchors
- atomic ranges for hidden spans
- `EditorState.transactionFilter` to block or normalize edits touching hidden spans

Programmatic comment mutations must carry the `commentMutation` annotation. Without it, CodeMirror correctly blocks changes that create, remove, or rewrite hidden markup spans.

Anchor edits are non-destructive: typing inside an anchor just edits the anchored text. A deletion that consumes the entire anchor removes the whole thread cleanly (never leaving an empty tag shell), and any user edit that removes threads triggers a "Comment removed with edit" toast with Undo.

The review rail lives under `src/renderer/components/editor/comments/`:

- `CommentsMargin.vue` — 248px collapsible rail with header (title, k/n counter, prev/next nav, close), bottom "Send to chat" bar, and an empty state with a "Request AI review" action
- `CommentCard.vue` — collapsed: two-line row (author + time / text preview); expanded: flat thread with scrollable notes, reply input, action buttons. Notes can be edited in place (hover pencil, including the first note) and replies deleted (hover trash, with undo toast). Timestamps show relative time with the absolute time as a tooltip.
- `useCommentPositions.ts` — Active-First Gravity layout

Creating a comment uses the selected raw range, not text matching. AI/user tools still match by `anchor_text` because they do not have a live editor selection. In code files the comment anchors to the line containing the selection start.

Typed-but-unsaved drafts survive tab switches: they are stashed per tab and restored when the tab becomes active again (if the anchor still matches).

### Resolve All

The bottom bar shows a "Resolve all" button alongside "Send to chat". Clicking it triggers an inline confirmation ("Resolve all N?") with confirm/cancel buttons. Confirming resolves every thread in a single editor transaction with an undo toast.

### Rail collapse and toggle

The rail can be closed via the header's close button (→| icon). When closed, a clickable "N comments" indicator appears in the editor status bar. ⇧⌘M (and the toolbar Comment button without a selection) toggles the rail — including opening it empty, which shows the empty state; with a text selection both start add-comment and reopen the rail.

### Navigation

The header shows a `k/n` counter when a comment is focused, or just the total count otherwise. ↑/↓ buttons step through comments in document order. Pressing ↓ with no active comment jumps to the first thread. These activate the thread and scroll the editor to its anchor.

### External change summary

When an agent mutates comments in a clean open file through the tools, the editor live-reloads and a toast summarizes the review round ("Comments updated in plan.md — 2 resolved · 1 reply"). The delta is computed by `diffCommentThreads` in `model.ts`.

## Chat Handoff

The rail can send all threads to a new or existing chat via the header send menu. Individual threads have "Send to chat" in their overflow menu.

The handoff does not auto-send. It opens the target chat, attaches a comments `data-context` part containing the full document text and thread metadata, and fills the composer with a short editable prompt ("Address these N comments."). AI-facing tool instructions are embedded in the attachment content JSON, not visible in the composer. The model sees the document with comment markup in context inside an `<attached-comments>` block — no extra `fs.read` call needed.

### Request AI review

When a file has no comments, the rail's empty state offers "Request AI review": it prepares a chat draft with the document attached and an instruction telling the model to review and leave `comments_add` comments. Helper: `buildReviewRequestAttachment` in `sendToChat.ts`.

The attachment helper is `src/renderer/services/comments/sendToChat.ts`. Comments context uses media type `application/vnd.mim.comments+json`; the main AI runtime renders it as an `<attached-comments>` block for the model.

## Apply As Edit

Each card can run the existing inline AI profile on the anchor text with the thread as the instruction. The returned `suggest_edit` output opens the shared diff review flow. Accepting the diff resolves the comment in the same editor transaction (path-aware: markdown re-inserts the anchor, code removes the marker lines).

## Tests

Focused coverage:

- `src/main/comments/model.test.ts`
- `src/main/comments/codeModel.test.ts`
- `src/main/tools/comments.test.ts`
- `src/renderer/components/editor/codemirror/comments.test.ts`
- `src/renderer/components/editor/comments/useCommentPositions.test.ts`
- `src/renderer/services/comments/sendToChat.test.ts`

## Known limits

- The diff/merge view hides markdown comment tags only; `@mim` marker lines appear raw in code-file diffs.
- Editor word/char stats strip markdown tags but count code marker lines.
- Git diffs, GitHub rendering, and external editors show the raw markup by design (in-file storage).
