# User Manual & Public Docs — Implementation Plan

Status: **implemented** (phases 0-4; phase 5 drift automation deferred). Manual source lives in `manual/` (12 chapters + `_style.md` + `_specs/`), developer pages in `manual/develop/` (7 hand-written + 3 generated), generators and claim lint in `scripts/docs-gen/` and `scripts/docs-lint.mjs` (`npm run docs:gen` / `docs:lint`), rendering pipeline in mim-web (`scripts/build-docs.mjs` → `data/docs-compiled.json` → `/manual` + `/develop` routes, per-page markdown, `/manual/llms.txt`, and a site-root `/llms.txt` index built from per-page `description` fields the compiler extracts). Covers positioning, information architecture, content pipeline, authoring process, writing voice, and the design guide (§6, implemented as specified).

---

## 1. Positioning

Two documents, because there are two readers:

- **The Manual** (`/manual`) — the user handbook, for researchers. A book: ~12 chapters, one reading order, readable in an afternoon. That readability claim is part of the brand ("simple, intuitive").
- **Developer documentation** (`/develop`) — for people building on Mim: tool catalog, app SDK, `mim.yaml`, CLI, MCP. A different door for a different person. Largely generated, not written.

**Progressive disclosure is depth, not navigation.** The two layers connect in exactly two places:

1. **"Under the hood" trapdoors** — collapsed blocks at the end of chapter sections carrying developer-level detail, ending with links into `/develop`.
2. **One quiet line** at the bottom of the manual's sidebar: *build on mim*.

A user who never opens a trapdoor never sees developer material, not even in the nav. There is no "reference" group in the manual's sidebar — user manuals have chapters, not registers.

The manual is also **agent-readable documentation**: clean markdown, per-page "view as markdown", and an `llms.txt`-style bundle endpoint. Users will paste it into Mim's own chat; treat that as a feature, not a rendering detail.

## 2. Information architecture

### Manual chapters (flat, ordered — order is the reading order)

1. what is mim
2. install
3. your first workspace
4. writing
5. running code
6. references
7. web research
8. agents
9. apps
10. history & recovery
11. shortcuts
12. privacy & security

Notes:
- The first three chapters *are* "getting started"; no group label needed.
- *privacy & security* is a user chapter in user voice — what leaves your machine, what asks first, what can be undone. It is the trust anchor and belongs in the book; the permission-gate internals live in `/develop`.
- *shortcuts* is user-facing (an appendix in book terms) and is generated (§4).

### Developer documentation sections

- build on mim (overview / entry page)
- tool catalog — **generated** from the tool registry
- app SDK & API
- skills
- `mim.yaml`
- command line
- MCP bridge
- models — **generated** from `resources/ai-models.json`
- apps — **generated** per-app pages from mim-apps manifests + READMEs

Pages in `/develop` carry a small *developer documentation* marker so a reader who arrived via a trapdoor knows they left the book.

## 3. Source layout & ownership

The manual source lives **in mim-os**, not mim-web, so the existing rule "when changing a subsystem, update the relevant doc" extends to the manual — same repo, same PR, same agent discipline.

```
manual/
  _style.md            # voice + design rules; the contract all writers follow
  _specs/<id>.md       # one spec per chapter: outline + sources + verified commit
  <id>.md              # chapter content, frontmatter below
```

Chapter frontmatter:

```yaml
---
id: running-code
title: Running code
order: 5
sources:                     # files this page derives from
  - docs/code-execution.md
  - src/main/tools/code.ts
verified: <commit-sha>       # last commit against which claims were checked
---
```

mim-web consumes a compiled `docs-compiled.json` (same pattern as the shoulders-v0.2 site: markdown + frontmatter → JSON → Nuxt page), pulled at build time via a sync script or GitHub Action artifact.

## 4. Pipeline & automation

Ordered by leverage:

1. **Compile.** `manual/*.md` + generated fragments → `docs-compiled.json`. Port of shoulders-v0.2 `build-docs.js`, extended with a `layer` field (`manual` | `develop`) and the trapdoor/callout syntax.
2. **Generators** (deterministic scripts in mim-os; output feeds `/develop` and the shortcuts chapter):
   - tool catalog: boot the headless registry (`headless.ts`), dump name, description, effect (read/mutate/external), approval default per tool;
   - shortcuts: extract from the same source `ShortcutsDialog.vue` / `shortcutLabels.ts` read;
   - models: `resources/ai-models.json`;
   - apps: mim-apps manifests + READMEs.
3. **Claim lint** (deterministic, CI): every backticked tool name exists in the registry dump; every kbd combo matches the shortcuts source; every settings deep-link matches `sections.ts`; every internal link resolves.
4. **Drift detection.** CI or a scheduled agent diffs each page's `sources` against its `verified` commit. Changed sources → page flagged stale → an agent gets the diff + the page and either proposes an updated draft (PR) or confirms no user-facing change and bumps `verified`. Turns "keep the manual current" into a queue.
5. **Executable claims** (later): an agent runs documented CLI commands and calls documented tools via the headless CLI / MCP bridge; failures fail the check. Docs tested like code.

## 5. Authoring process (subagents)

Writers and fact-checkers are always different agents. Orchestrate and verify in the main loop; delegate implementation.

- **Phase 0 — contracts** (main loop + human): the chapter specs (`_specs/`) and `_style.md`. The one step not to delegate — it is the product's mental model. The style guide is what makes N agent drafts converge to one author.
- **Phase 1 — rendering** (one implementation subagent, mim-web): port the docs pipeline from shoulders-v0.2, apply the design guide (§6), add trapdoors and the manual/develop split.
- **Phase 2 — generators** (parallel subagents, mim-os, TDD per repo convention).
- **Phase 3 — chapter drafting** (fan-out, one subagent per chapter): inputs are exactly the spec, `_style.md` verbatim, and an instruction to read the listed sources before writing. Hard rule: every factual claim traceable to a source file actually read; uncertainty becomes `TODO(verify)`, never a guess. One chapter per agent keeps context sharp and re-drafts cheap.
- **Phase 4 — verification**: (a) per-chapter adversarial fact-check, a fresh agent per page whose only job is to refute claims against the code; (b) one whole-manual consistency read (terminology, cross-page redundancy) — a single agent because consistency is a global property; (c) the mechanical lint. Human does the voice pass on the early chapters and *privacy & security*.
- **Phase 5 — drift automation** (§4.4), built last; it only pays off once pages and `sources:` exist.

## 6. Design guide

The manual is the website speaking, not the app: it follows mim-web's single-typeface discipline, not the app's five font roles. The feeling: humanist but slightly ominous — "simple, intuitive, and so powerful it is a bit frightening." Gravitas comes from structure and weight, never ornament. **Every pixel has a purpose or it goes.**

### Tokens

Palette (from mim-web `tailwind.config.js`; zero accent colors anywhere):

| token | value | use |
|---|---|---|
| void | `#000000` | header band only |
| paper | `#f5f5f1` | page ground |
| porcelain | `#fbfbf8` | (reserved; currently unused on docs) |
| ink | `#11110f` | text, rules, emphasis |
| graphite | `#5d5d56` | secondary text |
| soft | `#8c8c84` | tertiary labels |
| line | `#d8d8cf` | hairlines (55% alpha for row rules) |

Type: **Satoshi variable (300–900) for everything**; `letter-spacing: 0` at every size; `text-rendering: geometricPrecision`. True monospace (`ui-monospace` stack) **only inside code blocks**, where alignment is functional. No italics for decoration.

| role | spec |
|---|---|
| h1 | 29px / 680 / 1.18 |
| h2 | 16px / 700, under a full-width 1px ink rule (`padding-top` 13px) |
| body | 15px / 450 / 1.7, ink |
| small labels (`note`, markers, sidebar group-free) | 11.5px / 580, soft |
| sidebar links | 13px, graphite; active = ink at 620 |
| code blocks | 12.5px mono / 1.7 |
| table body | 13px |

### Layout

- Full-width black band, 56px, sticky: wordmark SVG + `/ manual` (or `/ develop`). Band content sits in the **same max-width container as the page** (62rem, 24px side padding). Nothing on the right side.
- Sidebar 176px, sticky, lowercase, flat chapter list — no group labels, no numbers. Below a hairline: *build on mim* (soft, 12px).
- Content column: max 66ch.
- Below ~820px the sidebar wraps into a horizontal link row.

### Components

- **Note callout**: 2px `line` left rule, lowercase `note` label (11px, soft), 14px graphite body. No colored boxes, ever.
- **Trapdoor** (`under the hood`): `<details>` with 2px **ink** left rule — the darker rule signals depth. Summary 12px/580 graphite with a text `+`/`−` tick. Body 14px graphite; may end with a link into `/develop`.
- **kbd**: Satoshi, 1px `line` border, 2px radius, no background, no raised edge.
- **Inline code**: Satoshi at 640. No box, no background — weight alone marks it literal.
- **Code block**: bare 1px hairline box, square corners, no background.
- **Definition rows** (e.g. the three surfaces): 108px term column + description, hairline row rules.
- **Tables**: 11px/580 soft lowercase headers over a `line` rule; hairline row rules; first column ink at 600. Effect classes are plain words — only **mutate** is bold ink (the one distinction that must be un-missable); *read* and *external* are graphite text.
- **`/develop` marker**: a small soft line (*developer documentation*) above the h1 — information (you left the book), not decoration.

### Interaction

- **No animation.** Page changes are instant. No transitions on hover — states just change. `prefers-reduced-motion` honored for anything that slips through.
- Hover = color shift only (graphite → ink). Links in prose: ink, underlined with `soft`, 3px offset.
- Focus-visible: 1px `currentColor` outline, 4px offset.
- Text selection inverts: ink background, paper text.
- Single theme (paper). The dark register belongs to the band and the landing page only.

### Banned

Shadows; border-radius beyond 2px; pills; icons in prose; accent colors; eyebrows/breadcrumbs; styled lede paragraphs; "next →" links (the ToC encodes sequence); page footers and taglines; "was this page helpful?"; section numbers (hypertext links by name, not clause address); screenshots by default — if unavoidable, White theme, consistently framed, prefer HTML vignettes.

### Voice

Flat declaratives. Second person, present tense. State large capabilities calmly — "Mim runs your code." "Every change can be undone." — the calmer the sentence, the heavier it lands. No exclamation marks, no "simply"/"just", no reassurance-speak, no marketing. Every sentence tells the reader something they can do or need to know. One term per concept, everywhere (`_style.md` carries the terminology table); mixed naming is a defect, not a style choice.

## 7. Open questions

- Sync mechanism mim-os → mim-web (GH Action artifact vs. script) — decide in Phase 1.
- Whether `/develop` inlines app docs or links to mim-apps READMEs (leaning: generate per-app pages from the same READMEs the app itself displays).
- Search over the manual (client-side fuzzy over compiled JSON, as in shoulders-v0.2) — worth adding in Phase 1 or defer.
