# R First-Class — Execution Plan

Status: **implemented** (phases 1–5 landed 2026-07-04; phase 6 deferred). See docs/code-execution.md for current state.
Owner: Paul. Written 2026-07-04.

Make R and R Markdown/Quarto work a first-class experience in Mim: the chat agent
writes real scripts, runs them, sees errors and warnings, and the resulting plot or
rendered document appears in the Artifact pane. Humans get the RStudio muscle-memory
loop (Cmd+Enter to an R console) on top of Mim's terminal.

This document is written to be executed by AI coding agents, one work item at a
time. Every item lists exact files, contracts, tests-first requirements, and
acceptance criteria. File/line references were verified against the codebase on the
date above; re-verify line numbers before editing, the contracts are the source of
truth.

---

## 1. Product stance (read before implementing anything)

- **No notebook. No REPL widget. No environment pane.** We do not rebuild RStudio.
  The Work/Artifact pane model *is* the notebook: conversation = narrative,
  `.R`/`.Rmd` file = durable code, rendered plot/PDF = output.
- **Two loops, cleanly separated.**
  - *Agent loop*: script-first and stateless. The agent writes a real file in the
    workspace and runs it end-to-end via `code.run`. Reproducible by construction,
    approval-gated, fully traced. This is the auditable-AI-analyst story clients pay for.
  - *Human loop*: editor → terminal. Cmd+Enter sends the selection/line to a
    terminal running R. Ephemeral, exploratory, zero gate involvement (it is the
    user typing into their own terminal).
- **System R, never bundled.** We detect the toolchain and tell the user/agent
  what is missing. Bundling R is a packaging tarpit.
- **Interpreter allowlist, not a shell.** `code.run` spawns detected interpreter
  binaries directly (no shell, argv array). The security posture stays legible:
  "Mim's agent may run R scripts in this workspace."
- **Excel stays external.** Out of scope for this plan entirely.

### The three demo scenes (definition of "wow")

1. **Chat does the analysis.** "Fit a mixed model on `data/trial.csv`, check the
   residuals." Agent writes `analysis/fit_model.R`, runs it, reads the convergence
   warning from stderr, fixes it, re-runs — residual plot appears in the Artifact pane.
2. **The report renders beside you.** `.qmd` open in Work, rendered PDF in
   Artifact. "Add a sensitivity section" → agent edits, re-renders, PDF refreshes
   in place.
3. **CLI agents are native citizens.** Claude Code (or Codex, or Gemini — all
   equal) in our terminal produces a plot and calls `editor_open` over the MCP
   bridge; the plot pops into the desktop Artifact pane.

All three reduce to two primitives: **execution with captured output** (Phase 2)
and **in-app viewing of run products** (Phase 1). Everything else is composition.

---

## 2. Ratified decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | Interpreter **allowlist** (`Rscript`, `R`, `quarto`; `python3` in catalog but default-off), argv array, no shell | Legible security posture; approval cards stay readable |
| D2 | **System R** required; toolchain detected and surfaced, never bundled | Packaging cost; detection already has a proven pattern (`agentCatalog.ts`) |
| D3 | Per-run approval with **"always allow for this session"** | Gate already implements session grants (`sessionToolAllows`, gate.ts); we only ensure `code.run` participates |
| D4 | `code.run` is **stateless** (each run is a full script execution); persistent R session is Phase 6 | Reproducibility is the differentiator; statefulness is an optimization |
| D5 | Cmd+Enter **auto-spawns an R console** (pty running `R --no-save` directly) when no terminal exists and the file is R | "It just worked" beats "works after setup"; pty layer already spawns arbitrary programs |
| D6 | Interpreters resolve to **detected absolute paths** — never PATH-relative at spawn time | Prevents PATH-hijack via workspace contents |
| D7 | Plot-capture fallback products go to `.mim/code-runs/<runId>/`; keeper figures are written explicitly by scripts (skill teaches `ggsave` → `outputs/`) | Follows `.mim/` per-feature dir convention; editor/server verified to serve `.mim/` paths |
| D8 | Auto-open of run products is **agent-driven v1** (tool description instructs `editor_open` on the best product) + clickable product chips in the chat run card; deterministic renderer auto-open deferred to Phase 6 | Zero coupling now; dirty-guard interplay (`artifactReplacement.ts`) needs its own design |

---

## 3. Guardrails for implementing agents

Read before every item. These repeat AGENTS.md rules that bite in this plan plus
plan-specific invariants:

- **TDD.** Write the co-located `*.test.ts` first, failing, describing the contract
  below. Mock only at system boundaries (child_process spawn, Electron IPC, AI SDK).
- **Register new tools in BOTH boots**: `src/main/index.ts` *and*
  `src/main/headless.ts` (grep for existing `register*Tools(tools)` sequences).
- **Every new tool needs a `TOOL_POLICIES` entry** in `src/main/security/gate.ts`
  (unknown tools default to category `general` → effect `mutate`, which works but
  gives poor approval copy). Also add an `ACTION_PHRASES` entry in
  `src/renderer/components/chat/approvalLogic.ts`.
- **AI exposure**: Vercel AI SDK `tool()` calls use `inputSchema` (Zod) — NEVER
  `parameters` (silently breaks Anthropic; see docs/gotchas.md). The AI tool key is
  the registry name with non-alphanumerics replaced by `_` (`code.run` → `code_run`).
  The key MUST be listed in the tool-policy row's `aiToolKeys` or policy toggles
  won't govern it.
- **Tool output budget**: `MAX_TOOL_OUTPUT_CHARS = 24000` (aiRuntime.ts). `code.run`
  must self-truncate; nothing truncates for you.
- **UI**: Tailwind v4 utilities only, semantic tokens (`text-ink-3`, `bg-surface`,
  `border-rule-light`…). No `cursor: pointer`; every clickable needs `hover:bg-*`.
  Use `MimMenu`/`MimToggle`/`MimSelect` primitives. Read docs/design-system.md.
- **Renderer file I/O** goes through `window.kernel.call()` only.
- **No screenshots.** Each item's acceptance section says what to ask the user to
  verify visually.
- **Docs.** When an item lands, update the docs listed in R5.2 for that subsystem
  and `docs/_MAP.md`. Docs describe current state, not history.

---

## 4. Phase map and cut lines

```
Phase 1  See      image tab, R/Rmd/qmd file support, chunk highlighting     ~3 days
Phase 2  Run      toolchain detection, code.run, plot harness, run card      ~5 days
Phase 3  Flow     Cmd+Enter → terminal, R console auto-spawn, chunk send     ~3 days
Phase 4  Render   Rmd/qmd render loop, PDF/image tab refresh-in-place        ~2 days
Phase 5  Ship     R modelling skill, docs, QA script                         ~1.5 days
Phase 6  Later    persistent R session, renv, statement-aware send, …        deferred
```

Dependencies: 2 depends on nothing in 1 except R2.6's product chips wanting R1.1
(image tab) to be satisfying. 3 and 4 depend on 1; 4 also uses `code.run` (2).
5 depends on 2. Items within a phase are ordered by dependency.

**Cut lines** (each is a coherent, demoable release):

- **Line A** — after Phase 1: R files feel native in the editor; plots and images
  viewable in-app (already improves the CLI-agent scene via MCP `editor_open`).
- **Line B** — after Phase 2: the headline client demo. Chat closes the
  write→run→fix→show loop. *Minimum bar for the client pitch.*
- **Line C** — after Phase 3: RStudio muscle-memory. The daily-driver experience.
- **Line D** — after Phases 4+5: the full story including reports and packaging.

Given client importance, the recommendation is Line D in one push, with Line B as
the internal milestone to demo early.

---

## Phase 1 — See: artifacts render in-app, R files are first-class

### R1.1 Image artifact tab (S/M)

**Goal.** PNG/JPEG/GIF/WebP/SVG open as an in-app tab beside PDF/table tabs instead
of bouncing to the OS viewer. This single item serves chat runs, CLI agents (MCP
`editor_open`), and plain browsing.

**Files.**
- Modify `src/renderer/services/fileOpenPolicy.ts` (+ its test): add `'image'` to
  `FileOpenTarget`; route `png, jpg, jpeg, gif, webp, svg` to `'image'`
  (keep `heic, tif, tiff` native — Chromium can't render them in `<img>`); remove
  those routed extensions from `BINARY_NATIVE_EXTENSIONS`; `defaultOpenLabelForPath`
  returns "Open in Editor" for them; `isEditorOpenablePath` includes `'image'`.
- Modify `src/renderer/services/editorTabPersistence.ts` (+ test): add `'image'`
  to `PersistedTabKind`; handle in `parseTabKind()`.
- Create `src/renderer/components/files/ImageArtifact.vue`: loads via
  `window.kernel.call('fs.readImageDataUrl', { path })` (already exists in
  `src/main/tools/fs.ts` — used by `FileCardArtifact.vue`; reuse its call shape).
  Fit-to-pane by default (`max-w-full max-h-full object-contain`), click toggles
  100%/fit, `bg-surface` backdrop, filename + pixel dimensions in a footer strip
  (`text-ink-3`). No zoom slider, no pan — keep v1 minimal.
- Modify `src/renderer/components/editor/EditorPanel.vue`: new
  `v-if="activeTab?.kind === 'image'"` block in the kind-dispatch template region
  (beside `PdfArtifact`/`TableArtifact` blocks); `openDocument(path, 'image')`
  already generalizes.
- Modify `src/renderer/services/appShell/documentActions.ts` (+ test): add
  `'image'` branch → `artifactHost().openDocument(path, 'image')`.

**Tests first.** `fileOpenPolicy.test.ts`: png/svg → `'image'`, heic → `'native'`,
label text, `isEditorOpenablePath('a/plot.png') === true`. `documentActions` test:
image target routes to `openDocument(path, 'image')`. `editorTabPersistence.test.ts`:
`'image'` round-trips, unknown kinds still rejected.

**Acceptance.** `npm run test` green. Ask user to verify: opening a `.png` from
Files shows it in the Artifact pane, fit-to-pane, dark theme looks right; `.svg`
renders; right-click still offers a native-open path (context menu unaffected).

### R1.2 Non-text tab refresh on disk change (S)

**Goal.** Re-running a script that overwrites `plot.png` (or re-rendering a PDF)
refreshes the open tab in place. Without this, the wow demo shows a stale plot.

**Contract discovered.** `useEditorFileSync.ts` (`onWorkspaceFilesChanged`,
~line 343) skips non-text tabs, and `EditorPanel.vue` `syncWatchedWorkspaceFiles()`
(~line 1129) only registers watchers for text tabs.

**Files.** Modify `src/renderer/components/editor/useEditorFileSync.ts` (+ test)
and the watcher registration in `EditorPanel.vue`: watch `image` and `pdf` tabs
too; on a change event for such a tab, bump `tab.id = \`${kind}:${path}-${Date.now()}\``
(the established forced-remount idiom, see `reloadActiveTabAfterRestore()`), which
re-fetches the data URL / reloads the iframe. Never mark them dirty; no conflict
bar for binary kinds.

**Tests first.** `useEditorFileSync` test: a `workspace:files-changed` event for an
open image tab's path triggers the reload callback; text-tab behavior unchanged;
events for unwatched paths ignored.

**Acceptance.** Ask user to verify: open a PNG, overwrite it from the terminal
(`cp other.png plot.png`), tab updates within ~1s without flicker of unrelated state.

### R1.3 R file extensions become editor-native (S)

**Goal.** `.R`, `.Rmd`, `.qmd` stop relying on the content sniffer.

**Files.** Modify `src/renderer/services/fileOpenPolicy.ts` (+ test): add
`r`, `rmd`, `qmd` to `EDITOR_EXTENSIONS`; `fileKindForPath`: `r` → `'R'`,
`rmd` → `'R Markdown'`, `qmd` → `'Quarto'`.

**Notes.** R syntax highlighting already works: `@codemirror/language-data`
registers R (legacy mode) for `.r/.R` and `language.js` lazy-loads by filename.
No editor change needed for plain `.R`.

**Tests first.** Extend `fileOpenPolicy` tests for targets and kind labels.

**Acceptance.** `.R` opens instantly as editor tab with highlighting; `@mim`
line-comments, Cmd+K inline AI, ghost, and history rail all function on it (these
key off editor tabs generally — spot-check, no code expected).

### R1.4 Rmd/Quarto as markdown documents with chunk highlighting (M)

**Goal.** `.Rmd`/`.qmd` get the full markdown experience (live preview, toolbar,
comments, citations) plus syntax highlighting inside ```` ```{r} ```` chunks.

**Files.**
- Modify `src/renderer/components/editor/codemirror/language.js` (+
  `language.test.ts`): add `'rmd', 'qmd'` to `MARKDOWN_EXTENSIONS`; change
  `markdownLanguageExtension()` to pass `codeLanguages: resolveFenceLanguage`
  where `resolveFenceLanguage(info)` normalizes the fence info string before
  matching against `@codemirror/language-data`: strip surrounding `{}`, take the
  first token up to `,` or whitespace (`{r, echo=FALSE}` → `r`,
  `{python}` → `python`, plain `js` → `js`), then
  `LanguageDescription.matchLanguageName(languages, token, true)`.
- No other files: the markdown gate is `isMarkdownPath()`, so live preview,
  toolbar, view modes, export dialog, comment notifications, and citations all
  follow automatically (verified list in `EditorPanel.vue` / `useEditorFileSync.ts`).

**Known consequences to verify, not fight.** Export dialog becomes available for
Rmd (exports the *source* as DOCX/PDF — acceptable; the real render path is R4.1).
Inline `<comment>` tags become insertable in Rmd — see Risks (§10) for the
knitting question; do not block this item on it.

**Tests first.** `language.test.ts`: `isMarkdownPath('a.rmd') === true` (and qmd);
`resolveFenceLanguage` unit cases: `{r}`, `{r, echo=FALSE}`, `{python}`, `r`,
` ```js `, unknown `{foo}` → null (no throw).

**Acceptance.** Ask user to verify: open an `.Rmd` with an `{r}` chunk — prose gets
live preview, chunk body gets R highlighting, formatting toolbar appears, `viewMode`
split works.

---

## Phase 2 — Run: the execution primitive

### R2.1 Toolchain detection (`toolchain.status`) (M)

**Goal.** One module that answers: is R/Rscript/Quarto/pandoc installed, where, and
what version — consumed by `code.run` (allowlist resolution, D6), agent context
(R2.5), Settings (R2.7), and the R console spawn (R3.3).

**Files.**
- Create `src/main/toolchain/toolchain.ts` + `toolchain.test.ts`.
- Register a `toolchain.status` tool (read effect) in a small
  `registerToolchainTools(tools)` — wire into both boots.
- Gate: add `'toolchain.status': { category: 'read', risk: 'low' }` to
  `TOOL_POLICIES`.

**Contract.**
```ts
export interface ToolchainEntry {
  id: 'r' | 'rscript' | 'quarto' | 'pandoc' | 'python3'
  bin: string            // 'R', 'Rscript', 'quarto', 'pandoc', 'python3'
  installed: boolean
  binPath?: string       // absolute
  version?: string       // first line of `<bin> --version`, trimmed
}
export function detectToolchain(): Promise<ToolchainEntry[]>   // cached promise
export function resetToolchainDetection(): void
export function resolveInterpreter(name: string): Promise<ToolchainEntry | null>
```
Copy the detection mechanics from `src/main/agents/agentCatalog.ts`
(`detectCommand`: login-shell `command -v` on POSIX, `where.exe` on Windows, 15s
timeout, `absolutePathFrom()` parsing; module-level promise cache + reset for
tests). Add version capture: `execFile(binPath, ['--version'], { timeout: 5000 })`,
first line of stdout||stderr (R prints version to stdout, some tools to stderr).
Detection failures are `installed: false`, never throws.

**Tests first.** Inject the exec boundary (same style as agentCatalog tests):
detection parses paths, version capture trims first line, cache returns same
promise, reset clears, missing binary → `installed:false`, `resolveInterpreter`
is case-insensitive on the basename and strips `.exe`.

**Acceptance.** `node bin/mim.mjs` headless can call `toolchain.status` (verify via
existing CLI tool-call path); on the user's Mac it reports real R/quarto paths.

### R2.2 `code.run` tool (L) — the core of the plan

**Goal.** Execute an allowlisted interpreter in the workspace, return captured
output + products to the model.

**Files.**
- Create `src/main/tools/code.ts` + `code.test.ts` exporting
  `registerCodeTools(tools, deps)` — wire into both boots.
- Gate (`src/main/security/gate.ts`): add
  `'code.run': { category: 'system', risk: 'high', targetParam: 'argv' }` to
  `TOOL_POLICIES` (system → effect `mutate` → prompts in Normal/Strict; session
  "always allow" then applies automatically per D3).
- Tool policy (`src/main/tools/toolPolicy.ts`): add domain `'code'` to
  `ToolPolicyDomain` and a row:
  `{ id: 'code.run', domain: 'code', label: 'Run code interpreters', description: 'Execute detected interpreters (Rscript, Quarto) on workspace files', defaultEnabled: true, toolIds: ['code.run'], aiToolKeys: ['code_run'], risk: 'sensitive' }`.
  Add `'code'` to `DOMAIN_ORDER`/`DOMAIN_LABELS` in `ToolsSettingsPanel.vue`.
- Approval copy (`src/renderer/components/chat/approvalLogic.ts`): ACTION_PHRASES
  `'code.run': 'run a script'`; ensure `canRemember()` returns true for it so the
  session-allow checkbox appears; the approval card target should show the joined
  argv (via `targetParam`).
- AI exposure (`src/main/ai/aiRuntime.ts`): add `code_run` (see below).
- Settings (`src/main/tools/settings.ts`): add `codeInterpreters?: string[]` to the
  `Settings` interface + `DEFAULTS` (`['rscript', 'r', 'quarto']` — note: catalog
  ids, not paths; `python3` in catalog but not in defaults per D1).

**Tool contract.**
```
code.run
params:
  argv: string[]            // argv[0]: interpreter basename or catalog id
  timeout_ms?: number       // default 120_000, clamp to [1_000, 480_000]
  capture_plots?: boolean   // default true; only affects `Rscript <file.R>` form
returns:
  exitCode: number | null   // null when killed on timeout
  timedOut: boolean
  durationMs: number
  stdout: string            // tail-truncated to 16_000 chars, '[…truncated N chars]' prefix when cut
  stderr: string            // tail-truncated to 6_000 chars, same marker
  products: Array<{ path: string; bytes: number; kind: 'image'|'pdf'|'table'|'html'|'text'|'other' }>
  runId: string
  runDir?: string           // '.mim/code-runs/<runId>' when plot capture was armed
```
Execution rules:
1. Reject when no workspace open, empty argv, or argv contains non-strings.
2. Resolve `argv[0]` via `resolveInterpreter()`; reject if not installed or its
   catalog id is not in the `codeInterpreters` setting. Spawn the **detected
   absolute binPath** (D6), remaining argv passed through verbatim. `spawn` with
   `shell: false`, `cwd = tools.getWorkspacePath()`,
   `env = { ...process.env, MIM_RUN_DIR: <abs runDir> }`.
3. Relative-path arguments stay relative (cwd is the workspace); do NOT try to
   validate every arg as a path (flags like `--to pdf` are legitimate). Path
   safety comes from cwd + allowlist + approval, not arg inspection.
4. Timeout: SIGTERM, then SIGKILL after 2s grace; POSIX spawn with
   `detached: true` and signal the process group (`process.kill(-pid, …)`);
   Windows `taskkill /pid <pid> /T /F`. Set `timedOut: true`, `exitCode: null`.
5. Cap in-memory capture while streaming (keep tails, not heads — the end of R
   output has the error).
6. Write `.mim/code-runs/<runId>/run.json` (`atomicJson.ts`) with
   `{ argv, startedAt, durationMs, exitCode, timedOut, products }` — follows the
   `.mim/` per-feature convention; enables Monitor integration later.
7. `runId`: reuse the id-generation idiom from `agentSessions.ts` (injected
   generator for tests).

**Products capture** (same file, pure helpers + injected fs for tests):
- Before spawn: bounded workspace walk (reuse the skip set from `fs.ts`
  `SKIP_RECURSIVE_DIRS` — `.git`, `node_modules`, `.mim`; cap 30_000 entries)
  snapshotting `path → { mtimeMs, size }`.
- After exit: rescan + additionally scan `runDir`. Product = path that is new or
  whose `(mtimeMs, size)` changed. Exclude the run's own `run.json`. Cap 50,
  ranked image > pdf > table (csv/tsv) > html > text > other, then newest first.
- Kind mapping by extension; reuse extension sets from `fileOpenPolicy.ts`
  conceptually but do NOT import renderer code into main — duplicate the tiny
  mapping in `code.ts` with a comment.

**AI tool** (aiRuntime.ts):
```ts
code_run: tool({
  description:
    'Run a script with a detected interpreter (Rscript, R, quarto) in the workspace. ' +
    'Write code to a real file first, then run it — do not pass code inline. ' +
    'Returns exit code, output tails, and files the run created or changed (products). ' +
    'After a successful run that produced a figure, PDF, or table, open the most ' +
    'relevant product with editor_open so the user sees it. ' +
    'If the run fails, read the stderr tail, fix the script, and re-run.',
  inputSchema: z.object({
    argv: z.array(z.string()).min(1),
    timeout_ms: z.number().optional(),
    capture_plots: z.boolean().optional(),
  }),
  execute: async (params) => call('code.run', params),
}),
```
The default AI tool timeout is 5 min (`DEFAULT_AI_TOOL_TIMEOUT_MS`); `code.run`'s
max runtime is 480s + kill grace, so wrap this tool's `call` with an 8.5-minute
timeout override (follow whatever per-call override `withAiToolTimeout` supports;
if none exists, add an optional ms argument to it — one-line change + test).

**Tests first** (`code.test.ts`, spawn injected; a couple of integration cases may
use the real `node` binary as a fake catalog entry — real child_process is fine in
vitest):
- rejects: unknown interpreter, interpreter not in settings allowlist, no workspace.
- spawns detected absolute path with `shell:false`, cwd=workspace, `MIM_RUN_DIR` set.
- timeout kills and reports `timedOut`.
- stdout/stderr tail-truncation with marker; total result under 24k chars.
- products: new file detected, modified file detected, `.mim` (non-runDir) and
  `node_modules` excluded, ranking order, cap.
- run.json written atomically with expected shape.
- gate integration: `TOOL_POLICIES` has the entry (there is an existing pattern of
  policy-coverage tests — extend it).

**Acceptance.** From chat (with R installed): "run `analysis/demo.R`" produces an
approval card reading "run a script — Rscript analysis/demo.R" with the
session-allow checkbox; output returns to the model; `.mim/code-runs/<id>/run.json`
exists. Declining works. Headless CLI can invoke it too.

### R2.3 R plot-capture harness (M)

**Goal.** Base-graphics plots from `Rscript` runs don't vanish into `Rplots.pdf`;
they land as PNGs in the run dir and surface as products.

**Files.**
- Create `resources/r/mim-run.R` (ship with the app; follow how
  `resources/ai-models.json` is located at runtime — same resolution idiom, and
  confirm the `resources/` dir is packaged by checking that existing reference;
  add a boot-time existence check that logs, never throws).
- Modify `src/main/tools/code.ts`: when `capture_plots !== false` AND argv matches
  the exact two-token form `[<rscript>, <path ending .R|.r>]`, rewrite to
  `[<rscriptBinPath>, <abs mim-run.R>, <script arg>]`. Any other shape runs
  verbatim (flags, `-e`, multiple args: no rewrite — document in tool description).

**Harness sketch** (implementation may refine; keep it dependency-free base R):
```r
args <- commandArgs(trailingOnly = TRUE)
script <- args[[1]]
run_dir <- Sys.getenv("MIM_RUN_DIR")
if (nzchar(run_dir)) {
  dir.create(run_dir, recursive = TRUE, showWarnings = FALSE)
  n <- 0L
  options(device = function(...) {
    n <<- n + 1L
    grDevices::png(file.path(run_dir, sprintf("plot-%02d.png", n)),
                   width = 1600, height = 1200, res = 192)
  })
}
status <- 0L
tryCatch(
  source(script, echo = TRUE, max.deparse.length = 250),
  error = function(e) { message("Error: ", conditionMessage(e)); status <<- 1L }
)
while (grDevices::dev.cur() > 1L) grDevices::dev.off()
if (!is.null(warnings()) && length(warnings())) print(warnings())
quit(save = "no", status = status)
```
`echo = TRUE` is deliberate: the model sees code and output interleaved, like a
console transcript.

**Tests first.** Pure-function tests for the argv-rewrite rule (all shapes).
Harness itself: one integration test guarded by
`describe.skipIf(!rscriptDetected)` that runs a tiny script with `plot(1:10)` and
asserts a `plot-01.png` product appears (runs on dev machines with R; skips in CI).

**Acceptance.** Ask user: chat-run a script using base `plot()` — PNG product
returned and openable; a `ggsave()` script also surfaces its output via the mtime
scan (no harness involvement).

### R2.4 Agent context: Toolchain section (S)

**Goal.** The agent knows before its first tool call whether R/Quarto exist, so it
plans correctly and can tell the user what to install instead of failing.

**Files.** Modify `src/main/ai/agentContext.ts` (+ test): add
`toolchain?: string[]` to `AgentContextData`; populate from `detectToolchain()`
(plus `renv.lock` presence in the workspace root — one `existsSync`); render as a
`## Toolchain` section after the header, lines like
`R 4.4.1 — /opt/homebrew/bin/R`, `Quarto 1.5.57 — installed`,
`pandoc — not found`, `renv.lock present`.
Detection is promise-cached (R2.1) so regeneration on workspace open/session
create stays cheap.

**Tests first.** Extend `agentContext` tests: section renders with entries,
omitted entirely when detection returns nothing, renv line appears when file exists.

**Acceptance.** `.mim/agent-context.md` in the user's workspace shows the section;
`workspace.orient` refreshes it.

### R2.5 Chat run card with product chips (M)

**Goal.** `code_run` results render as a purpose-built card instead of the generic
JSON dump: command, status, duration, collapsible output, and clickable product
chips that open in the Artifact pane. This is the user-visible half of the wow.

**Contract discovered.** `ChatMessage.vue` renders all tool parts through one
generic collapsible card; tool identity is `part.type === 'tool-code_run'`. There
is no per-tool rendering yet — this item introduces the first, so keep the seam
clean: a `toolCardComponent(toolName)` resolver defaulting to the generic card.

**Files.**
- Create `src/renderer/components/chat/ChatCodeRunCard.vue` + a logic module
  `chatCodeRunCard.ts` + test (parse the tool part's input/output into a
  view-model: argv line, status = running|ok|failed|timed-out, duration label,
  output tail, products with kind icons — pure functions, fully testable).
- Modify `src/renderer/components/chat/ChatMessage.vue`: dispatch `tool-code_run`
  parts to the card; while streaming/pending show the argv line + spinner (match
  the existing tool-card status dot idiom).
- Product chip click → open the file. Follow the existing chat→editor path used
  elsewhere in chat (grep for how chat opens files/attachments; if no path exists,
  emit `open-file` up through `ChatView.vue` and wire to
  `documentActions.openFileInEditor` in the App shell adapter — small, tested).
- Styling per design system: chips are `hover:bg-chrome-mid` rows with kind icon,
  basename, byte size in `text-ink-3`.

**Tests first.** `chatCodeRunCard.test.ts`: view-model from success, failure
(non-zero exit), timeout, in-flight (no output yet), products present/empty,
long-output truncation indicator passthrough.

**Acceptance.** Ask user to verify: a run shows the card with green/red status;
clicking a `plot-01.png` chip opens the image tab (R1.1); output expands/collapses;
both light and dark themes look right.

### R2.6 Settings > Tools: Code execution section (S/M)

**Goal.** Users see detected interpreters and control the allowlist.

**Files.** Modify `src/renderer/components/settings/ToolsSettingsPanel.vue`
(+ registry test pattern used by `AppsSettingsPanel.registry.test.ts` if
applicable): the new `code` domain group (from R2.2) renders the `code.run` policy
row; beneath it, an interpreter list built from `toolchain.status` — each catalog
entry with name, version or "not found" (`text-ink-3`), and a `MimToggle` bound to
the `codeInterpreters` setting via `settings.get`/`settings.set`. Not-installed
entries render the toggle disabled.

**Tests first.** Logic-level test for the merge of catalog + detection + setting
into row view-models (pure function in a small `codeInterpreterRows.ts`).

**Acceptance.** Ask user: Settings > Tools shows "Code execution"; toggling
`Rscript` off makes the next `code_run` call fail with a clear allowlist error.

---

## Phase 3 — Flow: the human loop

### R3.1 Terminal `sendText` + program tabs (M)

**Goal.** Two terminal capabilities the editor needs: send raw text to the active
terminal, and spawn a tab running a specific program (R console) instead of a shell.

**Files.**
- Modify `src/renderer/components/terminal/TerminalPanel.vue`:
  - `sendText(text: string, opts?: { spawn?: { program: 'r' } })`: ensure a tab
    exists (spawning per opts when none), then write via
    `window.kernel.call('terminal.write', { id, data })`. Multi-line text: join
    lines with `\r`; single trailing `\r` to execute. (Bracketed paste is a Phase 6
    refinement — see R6.3 — plain line semantics matches RStudio's send behavior.)
  - `addProgramTab({ file, args, label })`: like `addTab()` but spawns the given
    program; tab label from arg (e.g. `R`).
  - Extend `defineExpose` with both.
- Modify `src/main/pty.ts` / the `terminal.spawn` tool: accept optional
  `program: string` + `args: string[]`. Validate `program` against
  `detectToolchain()` binPaths (only detected toolchain binaries are spawnable by
  name — the renderer never passes raw paths). `spawnPtyProcess` already takes
  arbitrary `file`/`args` (verified) so this is parameter plumbing + validation.
- Modify `src/renderer/components/workbench/WorkHost.vue`: expose a
  `sendTerminalText(text, opts)` pass-through beside `runTerminalCommand`.

**Tests first.** `pty`/tool-level test: `terminal.spawn` with `program: 'r'`
resolves the detected R binPath, rejects undetected programs. Renderer logic tests
for the line-joining rule (pure helper `terminalSendText.ts`: `"a\nb"` →
`"a\rb\r"`, trailing newline not doubled).

**Acceptance.** Ask user: with a terminal open, a scripted `sendText('1+1')`
(temporary dev hook or via R3.2) executes in the shell.

### R3.2 Cmd+Enter: send selection/line from editor to terminal (M)

**Goal.** RStudio muscle memory. In a code-file tab, Cmd/Ctrl+Enter sends the
selection (if any) else the current line to the terminal, then advances the cursor
to the next non-blank line.

**Files.**
- Create `src/renderer/components/editor/codemirror/sendToTerminal.js` + test:
  pure CM6 command `sendToTerminalCommand(view, dispatchSend)` returning
  `{ text, cursorAdvancedTo }` semantics: selection → sliceDoc; empty selection →
  current line text (skip if blank: advance only); cursor advance = start of next
  line with non-whitespace content (or end of doc). Testable with headless
  `EditorState`.
- Modify `src/renderer/components/editor/useEditorFormatting.ts`: register
  `Mod-Enter` in `editorKeymaps()` (`Prec.highest`), gated: active tab is `text`
  kind and NOT `isMarkdownPath(path)` (plain markdown returns false so the key
  falls through; Rmd chunks arrive in R3.4). Needs `activeFilePath` +
  `sendToTerminal(text, opts)` added to the composable's options.
- Modify `src/renderer/components/editor/EditorPanel.vue`: emit
  `sendToTerminal` payload `{ text, language }` (language from extension: `.R` →
  `'r'`).
- Wire in the App shell (`src/renderer/App.vue` + `services/appShell/` adapter, and
  `services/workbench/commands.ts`): new workbench command
  `{ type: 'terminal.send', text, language }` routed like `terminal.run` — reveal
  terminal Work surface, call `WorkHost.sendTerminalText(text, { spawn: language === 'r' ? { program: 'r' } : undefined })`.
  Add to the `commands.ts` test.

**Tests first.** `sendToTerminal.test.ts` (CM state cases: selection, line, blank
line, last line, cursor advance). `commands.test.ts`: routing + reveal.

**Acceptance.** Ask user: open `.R`, place cursor on `x <- rnorm(100)`, Cmd+Enter —
terminal reveals, line executes, cursor lands on the next statement; select a
3-line block, Cmd+Enter runs all three; Cmd+Enter in a `.md` file does nothing.

### R3.3 R console auto-spawn (S)

**Goal.** Cmd+Enter from an R file with no terminal open spawns a pty running
`R --no-save` directly (D5). If R exits, the tab behaves like any exited terminal.

**Files.** Already plumbed by R3.1/R3.2 (`spawn: { program: 'r' }` +
`addProgramTab`); this item finishes behavior: if R is not detected, fall back to
a normal shell tab and toast ("R not found — sent to shell"), using the existing
toast store.

**Tests first.** Logic test for the spawn decision (detected/not, existing
tab/none).

**Acceptance.** Ask user: fresh workspace, no terminal, Cmd+Enter in `.R` → an "R"
tab appears already at the R prompt with the line executed; quit R (`q()`), tab
shows exited state; Cmd+Enter again reuses/spawns correctly.

### R3.4 Rmd/qmd chunk execution keys (M)

**Goal.** In Rmd/qmd: Cmd+Enter inside an `{r}` chunk sends the current
line/selection; Cmd+Shift+Enter sends the whole chunk body.

**Files.**
- Extend `sendToTerminal.js` (+ tests): chunk detection via the markdown syntax
  tree (`FencedCode` node containing the cursor; info string must start with
  `{r`), returning the chunk body range (fences excluded). Fall back to regex
  scanning only if the tree node proves unreliable — decide in implementation,
  test either way.
- Extend the keymap in `useEditorFormatting.ts`: for markdown paths, `Mod-Enter`
  is active only when inside an R chunk (otherwise return false); `Mod-Shift-Enter`
  sends the chunk body.

**Tests first.** Chunk-range cases: cursor mid-chunk, on fence line, outside any
chunk, chunk at EOF without closing fence (send nothing), `{python}` chunk
(send — the terminal decides what interprets it; language hint from info string).

**Acceptance.** Ask user: in an `.Rmd`, Cmd+Shift+Enter on a chunk runs its body in
the R console; Cmd+Enter on prose does nothing.

---

## Phase 4 — Render: the document loop

### R4.1 Render action for Rmd/qmd (M)

**Goal.** One click (or one agent tool call) renders the open document and shows
the result in the Artifact pane.

**Engine rule.** `.qmd` → `quarto render <path>`; `.Rmd` → quarto if detected else
`Rscript -e "rmarkdown::render('<path>')"` (argv array, no shell, path passed as
an argument — build the `-e` expression with a tested escaping helper).

**Files.**
- Renderer affordance: a "Render" button in the editor toolbar area, visible when
  the active tab is `.rmd`/`.qmd` and (quarto or R) is detected
  (`toolchain.status` via a small cached service). Click → busy spinner →
  `window.kernel.call('code.run', { argv, capture_plots: false })` (user actor:
  gate auto-allows; no approval friction). On success: rank products; `.pdf` →
  `openDocument(path, 'pdf')`; `.html` → open via the existing native-open path;
  on failure: toast with the stderr tail and a "view output" affordance.
- Agent path needs no new code — `code_run` covers it; add a sentence to the
  `code_run` description: "To render an R Markdown or Quarto document, run quarto
  render (or rmarkdown::render) on the file, then open the produced PDF."
- Create `src/renderer/services/renderDocument.ts` + test for the engine/argv
  decision and product pick (pure).

**Tests first.** `renderDocument.test.ts`: engine selection matrix (qmd/rmd ×
quarto present/absent), escaping of paths with quotes/spaces in the `-e` form,
product ranking (pdf beats html beats other).

**Acceptance.** Ask user: open a `.qmd`, click Render — PDF appears in the
Artifact pane; edit text, Render again — PDF refreshes in place (needs R1.2);
break the doc, Render — toast shows the quarto error tail.

### R4.2 Quarto/PDF polish (S)

**Goal.** Honest failure modes for the LaTeX-less. When quarto PDF rendering fails
with a missing-tinytex signature, the toast/agent output should say "PDF engine
missing — run `quarto install tinytex` or render to HTML" rather than dumping LaTeX
noise. Detection: match on quarto's stderr message (implementation finds exact
string; keep the matcher tested and tolerant).

**Files.** Extend `renderDocument.ts` + the `code_run` description line about
rendering. Small.

**Acceptance.** On a machine without tinytex, rendering to PDF produces the
guidance message.

---

## Phase 5 — Ship: knowledge and packaging

### R5.1 "R modelling" skill template (S/M)

**Goal.** Package the workflow so the agent behaves like it knows R practice, and
clients see a named capability.

**Files.** Modify `src/main/templates/skillTemplates.ts` (+ existing test
pattern): new `SKILL_TEMPLATES` entry `r-modelling`:
- frontmatter: `tools: ['code_run', 'editor_open', 'fs_read', 'fs_write']`,
  `unlocks: []` (code_run stays generally available; no progressive gating v1).
- Body (concise, imperative): project layout (`data/` read-only inputs,
  `analysis/` scripts, `outputs/` figures+tables); every analysis is a script run
  end-to-end via `code_run`, never inline `-e` snippets; `set.seed` discipline;
  save keeper figures explicitly (`ggsave` → `outputs/`, the auto-captured
  `.mim/code-runs/` PNGs are previews); after successful runs open the headline
  product with `editor_open`; on failure read stderr tail, fix, re-run; renv:
  if `renv.lock` present run `renv::restore()` before first analysis; rendering
  rule from R4.1; when R/quarto missing, tell the user exactly what to install.

**Tests first.** Template render test (frontmatter parses, name/description
defaults, body non-empty) following the existing `skillTemplates` tests.

**Acceptance.** Settings > Skills > Add > template list shows "R modelling";
created skill activates in chat and the agent follows the layout conventions in a
scripted try-out.

### R5.2 Documentation (S)

- Create `docs/code-execution.md`: tool contract, interpreter allowlist model,
  plot-capture harness, run dir layout, security posture (D1/D3/D6), toolchain
  detection, render rule.
- Update `docs/_MAP.md`: Systems rows (code execution under Main Process — Core or
  a new cluster; toolchain), file-tree entries (`tools/code.ts`, `toolchain/`,
  `resources/r/`), Docs Index row, and mark this proposal implemented (link stays).
- Update `docs/security.md`: `code` domain, `code.run` policy entry, session-allow
  applicability.
- Update `docs/document-pane.md`: image tab kind, non-text refresh, Rmd/qmd
  markdown status, Render button.
- Update `docs/design-system.md` only if the run card introduced a new reusable
  pattern.
- Add to `docs/gotchas.md` anything earned the hard way (e.g. fence info-string
  normalization, process-group kill on POSIX).

### R5.3 Manual QA script (S)

Create `docs/qa/r-first-class-qa.md` (or append to an existing QA location if one
exists — check first): the end-to-end demo script covering the three scenes in §1,
each step phrased as "do X, confirm Y", so any release check (human or agent-led
with user confirmation, per the no-screenshots rule) can run it. Include the
negative paths: R missing, interpreter toggled off, run declined, timeout.

---

## Phase 6 — Later (specced, deliberately deferred)

- **R6.1 Persistent R session.** `r.session.run`/`r.session.reset` tools backed by
  a shipped `resources/r/mim-session.R`: JSON-lines over stdin/stdout
  (`{id, code}` → `{id, stdout, warnings, error, plots[]}`), one session per
  workspace, 30-min idle kill, dies on workspace switch/quit. Same gate row as
  `code.run`. Motivation: big-data iteration without reloading; the deliverable
  remains a written-out script.
- **R6.2 renv + sessionInfo capture.** Append `sessionInfo()` output to
  `run.json`; agent-context nudge when `renv.lock` is missing in an R workspace.
- **R6.3 Bracketed-paste + statement-aware send.** Wrap multi-line sends in
  `\x1b[200~…\x1b[201~` when the target is an R pty; paren/brace-balancing
  expansion so Cmd+Enter mid-`ggplot` chain sends the whole statement.
- **R6.4 Deterministic product auto-open.** Renderer setting to auto-open the
  top-ranked product after a successful `code_run`, respecting the
  `artifactReplacement.ts` dirty guard.
- **R6.5 Quarto preview mode.** `quarto preview` as a managed long-running process
  with the HTML in a live view — depends on the AI-native browser work.
- **R6.6 Monitor integration.** Surface `.mim/code-runs/` records as Activity rows.

---

## 10. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Arbitrary-code-execution surface via `code.run` | Allowlist of detected absolute binaries (D1/D6), no shell, workspace cwd, `mutate` approval + session-scope grant only (never persistent), tool-policy row default-on but user-disableable, full trace |
| PATH hijack (workspace ships a malicious `Rscript`) | D6: spawn only toolchain-detected absolute paths; detection runs login shell, not workspace-relative |
| Output floods (printing a 1M-row df) | Streaming tail caps (16k/6k) enforced in the tool, not post-hoc |
| Long model-blocking runs | 120s default / 480s max timeout, process-group kill, AI-wrapper timeout raised for this tool only |
| exceljs-style fidelity trap — n/a here, but the analogous one: **harness changes script semantics** | Harness only wraps the exact `Rscript file.R` form; `echo=TRUE` documented; `capture_plots:false` opt-out |
| `mtime` granularity (1s filesystems) misses products | Compare `(mtimeMs, size)` pairs against a full pre-run snapshot, not a timestamp threshold |
| `<comment>` tags in Rmd may leak into knitted output | Verify during R1.4 acceptance: pandoc treats them as raw HTML (invisible in HTML output, dropped in PDF). If they leak, scope the comment-insertion UI to non-Rmd markdown and log an issue |
| Windows: `Rscript.exe`, `where` detection, process-tree kill | Detection pattern already handles win32 (`agentCatalog.ts`); kill via `taskkill /T /F`; add win32-conditional unit tests for both |
| Quarto PDF requires tinytex | R4.2 guidance path; skill mentions it |
| CI has no R | All `code.run` tests run against injected spawn or the `node` binary; R-dependent tests are `skipIf(!rscriptDetected)` |

## 11. Open items requiring a human decision during implementation

1. **`code.run` default-enabled?** Plan says yes (consistent with `terminal.run`,
   risk `sensitive`, still approval-gated). Flip `defaultEnabled: false` if client
   deployments prefer opt-in.
2. **Approval card copy** for argv display — confirm wording with Paul at R2.2
   review ("run a script — Rscript analysis/fit.R").
3. **Where the Render button lives** (toolbar vs. tab strip) — decide at R4.1 with
   a quick visual check; the toolbar is currently markdown-gated, which Rmd now
   satisfies.
