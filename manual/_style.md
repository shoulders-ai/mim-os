# Manual Style Contract

Every writer — human or agent — follows this file. It is the contract that makes twelve
independently drafted chapters read as one book. Deviations are defects.

## What the manual is

The user handbook for Mim, for researchers. A book: twelve chapters, one reading
order, readable in an afternoon. It documents the product **as shipped today** — not
plans, not proposals, not draft ontology. It is also agent-readable documentation:
clean markdown that users will paste into Mim's own chat.

## Voice

- Flat declaratives. Second person, present tense. "Mim runs your code." "Every change
  can be undone."
- State large capabilities calmly. The calmer the sentence, the heavier it lands.
- No exclamation marks. No "simply", "just", "easily", "powerful", "seamless".
- No reassurance-speak, no marketing, no enthusiasm. No jokes.
- Every sentence tells the reader something they can do or need to know. Delete the rest.
- Sentence-case headings. No section numbers. No "Next →" links — the table of contents
  encodes sequence.
- Address the researcher, not the programmer. A concept that needs implementation words
  to explain does not belong in a chapter body — it belongs in a trapdoor or in /develop.

## Truth rules (hard)

1. Every factual claim must be traceable to a source file you actually read this
   session. The chapter spec lists the sources; read them before writing.
2. Never invent or paraphrase a UI label, menu item, settings section, tool name,
   keyboard shortcut, file path, or command. Copy it from the source. If you cannot
   find it, write `TODO(verify: <what you looked for and where>)` — a TODO is correct,
   a guess is a defect.
3. Backticked tool names must exist in the tool registry. Keyboard shortcuts must match
   `src/renderer/services/shortcutLabels.ts`. Settings references must match
   `src/renderer/components/settings/sections.ts`.
4. Document current behavior only. `docs/ontology.md` and `docs/vocabulary.md` are
   DRAFT and must not leak into the manual. If a source doc and the code disagree,
   the code wins; note the discrepancy as `TODO(verify: …)`.

## Terminology

One term per concept, everywhere. Verify each label against the shipped UI source
before first use; if the UI disagrees with this table, follow the UI and flag it.

| term | use for | never say |
|---|---|---|
| Mim | the product | "the app", "the platform" |
| workspace | the folder holding one project (`mim.yaml`, `.mim/`) | project, repo (unless literally about git) |
| chat | a conversation with Mim's agent | session, thread |
| agent | Mim's built-in AI worker; "CLI agent" for Claude Code/Codex/Gemini CLI | assistant, bot, AI (as a noun) |
| document | a file open in the editor | note, page |
| editor | the document pane | document viewer |
| terminal | the shell surface | console |
| app | an installable extension | package, plugin, extension |
| skill | a written workflow the agent loads on demand | — |
| tool | one ability an agent can call | function, command (for tools) |
| approval | your permission decision on a tool call | confirmation |
| file history | per-file recovery under `.mim/` | version control, snapshots |
| instructions | the standing `AGENTS.md` contract | system prompt (chapters; trapdoors may name it) |
| model | the AI model behind a feature | LLM, engine |
| Navigator | the left column of the window | sidebar, nav |
| work pane, artifact pane | the center and right panes of the window | main pane, side panel |

Keyboard keys: write macOS forms (`Cmd`, `Option`) in prose. The install chapter
states once: on Windows and Linux, read Cmd as Ctrl. Do not repeat that note —
except in the shortcuts appendix, which is consulted standalone.

## File format

One file per chapter, `manual/<id>.md`. Frontmatter:

```yaml
---
id: running-code
title: running code          # lowercase, as the sidebar shows it
order: 5
sources:                     # files this page derives from — keep exact
  - docs/code-execution.md
  - src/main/tools/code.ts
verified: <commit-sha>       # commit the claims were checked against
---
```

Body starts with the h1 (`# running code`, lowercase, matching the title), then a
one- or two-sentence opening stating what the chapter covers — plain body text,
no styled lede.

## Components (authoring syntax)

- **Note callout** — sparing; for the one thing a reader would otherwise miss:

  ```
  ::: note
  Body text. One short paragraph.
  :::
  ```

- **Trapdoor** — developer-level depth at the end of a section, collapsed by default.
  A reader who never opens one still gets the full user story. May end with a link
  into /develop:

  ```
  ::: under-the-hood
  Body may use implementation vocabulary. Short.

  More in [tool catalog](/develop/tools).
  :::
  ```

- **kbd** — `<kbd>Cmd+K</kbd>`. Combos joined with `+`, no spaces.
- **Inline code** — backticks only for literals: tool names, file paths, commands,
  exact values. Never for emphasis.
- **Code blocks** — fenced, with a language tag, only for things the reader types or
  reads verbatim.
- **Definition rows** — for short term/description sets (e.g. the three surfaces):

  ```
  ::: rows
  - term — description in one sentence.
  - term — description in one sentence.
  :::
  ```

- **Links** — between chapters by id: `[running code](running-code)`. Into developer
  docs: `/develop/<page>`. Links are named by destination, not "click here" or "see above".

## Banned in content

Screenshots (describe the UI in words); icons and emoji; marketing adjectives;
"was this page helpful"; footnotes; blockquotes for anything except quoted text;
tables where prose is clearer; more than one note callout per section; H3 or deeper
(two heading levels: the h1 and h2 sections).

## Length

600–1400 words per chapter. If a chapter wants to be longer, its spec is wrong —
report that instead of writing long.
