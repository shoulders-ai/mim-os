# Inline Comments

Markdown review comments are stored inline in the document as pseudo-HTML. The file on disk is the source of truth; presentation surfaces decide whether to hide or strip the tags.

## Syntax

```md
We propose <comment id="k3f9">a staged rollout<note by="paul" at="2026-06-13T09:14">Too slow.</note><note by="ai" at="2026-06-13T09:20">Phase 2 gates it.</note></comment> over six weeks.
```

- `<comment id="...">` wraps the visible anchor text.
- `<note by="..." at="...">...</note>` children hold the thread body. The first note is the original comment; later notes are replies.
- Note bodies escape only `&` and `<` on write.
- Resolve deletes the wrapper and notes while keeping the anchor text.

The pure parser/model lives in `src/main/comments/model.ts`; tests are in `model.test.ts`.

## Surfaces

| Surface | Treatment |
|---|---|
| Editor | Tags hidden with CodeMirror replace decorations; anchors highlighted; cards render in the right review rail |
| Preview | Tags stripped before sanitize/render |
| Export | Tags stripped in `src/main/tools/export.ts` before PDF/DOCX generation |
| Stats | Word/char counts use stripped text |
| Diff view | Tags hidden via `commentsHideExtension` (decorations only, doc model stays raw) |
| AI file reads | Raw file content, tags included |
| Search | Raw text, so comments are searchable |

## Tools

Main-process tools are registered by `src/main/tools/comments.ts`:

- `comments.list`
- `comments.add`
- `comments.reply`
- `comments.resolve`

AI-facing chat tools use underscore names in `src/main/ai/aiRuntime.ts`: `comments_list`, `comments_add`, `comments_reply`, and `comments_resolve`.

Mutation tools write through the same hash-safe file pattern as `fs.write`. They refuse to mutate a file that is open and dirty in the editor; the renderer sends dirty open paths through `pushDirtyTabCount({ count, paths })`.

## Editor

The CodeMirror extension is `src/renderer/components/editor/codemirror/comments.js`.

It uses four layers:

- replace decorations for hidden tags
- mark decorations for visible anchors
- atomic ranges for hidden spans
- `EditorState.transactionFilter` to block or normalize edits touching hidden spans

Programmatic comment mutations must carry the `commentMutation` annotation. Without it, CodeMirror correctly blocks changes that create, remove, or rewrite hidden tag spans.

The review rail lives under `src/renderer/components/editor/comments/`:

- `CommentsMargin.vue` — 248px collapsible rail with header (title, k/n counter, prev/next nav, close), bottom "Send to chat" bar
- `CommentCard.vue` — collapsed: two-line row (author + time / text preview); expanded: flat thread with scrollable notes, reply input, action buttons
- `useCommentPositions.ts` — Active-First Gravity layout

Creating a comment uses the selected raw range, not text matching. AI/user tools still match by `anchor_text` because they do not have a live editor selection.

### Rail collapse

The rail can be closed via the header's close button (→| icon). When closed, a clickable "N comments" indicator appears in the editor status bar. ⇧⌘M toggles the rail when no text is selected; with a text selection it starts add-comment and reopens the rail.

### Navigation

The header shows a `k/n` counter when a comment is focused, or just the total count otherwise. ↑/↓ buttons step through comments in document order. Pressing ↓ with no active comment jumps to the first thread. These activate the thread and scroll the editor to its anchor.

## Chat Handoff

The rail can send all threads to a new or existing chat via the header send menu. Individual threads have "Send to chat" in their overflow menu.

The handoff does not auto-send. It opens the target chat, attaches a comments `data-context` part containing the full document text and thread metadata, and fills the composer with a short editable prompt ("Address these N comments."). AI-facing tool instructions are embedded in the attachment content JSON, not visible in the composer. The model sees the document with comment tags in context inside an `<attached-comments>` block — no extra `fs.read` call needed.

The "Send to chat" button is at the bottom of the rail. Individual threads have "Send to chat" in their overflow menu.

The attachment helper is `src/renderer/services/comments/sendToChat.ts`. Comments context uses media type `application/vnd.mim.comments+json`; the main AI runtime renders it as an `<attached-comments>` block for the model.

## Apply As Edit

Each card can run the existing inline AI profile on the anchor text with the thread as the instruction. The returned `suggest_edit` output opens the shared diff review flow. Accepting the diff resolves the comment in the same editor transaction.

## Tests

Focused coverage:

- `src/main/comments/model.test.ts`
- `src/main/tools/comments.test.ts`
- `src/renderer/components/editor/codemirror/comments.test.ts`
- `src/renderer/components/editor/comments/useCommentPositions.test.ts`
- `src/renderer/services/comments/sendToChat.test.ts`
