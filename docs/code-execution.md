# Code Execution

Mim's code execution system provides two registry tools for running commands in
the workspace: `shell.run` (the unified AI-facing `bash` tool) and `code.run`
(the allowlisted interpreter tool used by the editor Render button). The
primitives serve the agent loop (write, run, fix, show) and the human loop
(Cmd+Enter to a terminal).

## Source Map

- Toolchain detection: `src/main/toolchain/toolchain.ts`
- Toolchain tool: `src/main/tools/toolchain.ts`
- Code tools (code.run + shell.run): `src/main/tools/code.ts`
- Plot-capture harness: `resources/r/mim-run.R`
- AI tool (`bash`): `src/main/ai/aiRuntime.ts`
- Agent context Toolchain section: `src/main/ai/agentContext.ts`
- Tool policy domain: `src/main/tools/toolPolicy.ts`
- Settings (interpreter allowlist): `src/main/tools/settings.ts`
- Chat run card: `src/renderer/components/chat/ChatCodeRunCard.vue`,
  `chatCodeRunCard.ts`
- Settings UI rows: `src/renderer/components/settings/codeInterpreterRows.ts`
- Render workflow: `src/renderer/services/renderDocument.ts`
- Render toolbar: `src/renderer/components/editor/EditorToolbar.vue`
- Toolchain cache (renderer): `src/renderer/services/toolchainStatus.ts`
- Send-to-terminal: `src/renderer/components/editor/codemirror/sendToTerminal.js`
- Terminal program tabs: `src/main/pty.ts`

## Toolchain Detection

`detectToolchain()` catalogs five binaries:

| Id | Binary | Notes |
|---|---|---|
| r | R | Interactive console |
| rscript | Rscript | Non-interactive script runner |
| quarto | quarto | Quarto CLI |
| pandoc | pandoc | Document converter |
| python3 | python3 | In catalog but default-off in the interpreter allowlist |

Detection resolves each binary through the user's login shell (`$SHELL -lic
'command -v <bin>'` on POSIX, `where.exe` on Windows) with a 15s timeout.
Version is captured via `--version` (5s timeout, first line of stdout or
stderr). Results are promise-cached for the app lifetime;
`resetToolchainDetection()` clears the cache for tests.

`resolveInterpreter(name)` looks up a catalog entry by id (case-insensitive,
strips `.exe` suffix on Windows). Returns the entry with its absolute `binPath`
if installed, or `null`.

The `toolchain.status` tool (category `read`, risk `low`) exposes the full
detection array to agents and the Settings UI.

## Agent Context

`agentContext.ts` renders a `## Toolchain` section in `.mim/agent-context.md`
listing each entry's binary, version, and path (or "not found"). If
`renv.lock` exists at the workspace root, a line `renv.lock present` is
appended.

## code.run Tool

### Parameters

| Param | Type | Default | Notes |
|---|---|---|---|
| argv | string[] (min 1) | required | argv[0] is interpreter id or basename |
| timeout_ms | number | 120000 | Clamped to 1000-480000 |
| capture_plots | boolean | true | Only affects `Rscript <file.R>` form |

### Interpreter Allowlist

`argv[0]` is resolved via `resolveInterpreter()`. The resolved entry's catalog
id must appear in the `codeInterpreters` setting (default: `['rscript', 'r',
'quarto']`). Python3 is in the catalog but not in defaults. Pandoc is excluded
from the interpreter list entirely (it has no interpreter role).

Users toggle interpreters in Settings > Tools under the "Code execution" group.
Toggling an interpreter off makes subsequent `code.run` calls with that
interpreter fail with an allowlist error.

### Spawn

The detected **absolute binPath** is spawned directly (decision D6 - prevents
PATH-hijack via workspace contents). Spawn options:

- `shell: false` (no shell interpretation)
- `detached: true` on POSIX (enables process-group kill)
- `cwd`: workspace root
- `env`: inherits `process.env` plus `MIM_RUN_DIR` set to the run directory
- `stdio`: stdin ignored, stdout/stderr piped

### Timeout and Kill

Default timeout is 120s. Clamped to the range 1s-480s. On timeout:

1. SIGTERM to the process group (`process.kill(-pid, 'SIGTERM')`)
2. 2s grace period
3. SIGKILL to the process group

Windows uses `taskkill /pid <pid> /T /F`. The result reports `timedOut: true`
and `exitCode: null`.

### Output Capture

Stdout and stderr are captured as streaming tails:

- Stdout cap: 16,000 chars (keeps the tail, prepends `[...truncated N chars]`)
- Stderr cap: 6,000 chars (same marker)

Tail-truncation ensures the model sees errors and final output rather than
early verbose logging.

### Products

Before spawn, a workspace snapshot records `(path, mtimeMs, size)` for up to
30,000 entries (skipping `.git`, `node_modules`, `.mim`). After exit, a rescan
plus the run directory identifies new or changed files. Products are ranked:

1. image (png, jpg, jpeg, gif, webp, svg)
2. pdf
3. table (csv, tsv)
4. html
5. text
6. other

Within a rank, newest first. Capped at 50 products. The run's own `run.json`
is excluded. Product paths are workspace-relative slash paths (e.g.
`outputs/plot.png`, `.mim/code-runs/<runId>/plot-01.png`) so chat product
chips and `editor_open` route to in-app tabs rather than the OS viewer.

### Run Directory

Each run writes `.mim/code-runs/<runId>/run.json` atomically:

```json
{
  "argv": ["Rscript", "analysis/fit.R"],
  "startedAt": "2026-07-04T10:00:00.000Z",
  "durationMs": 3200,
  "exitCode": 0,
  "timedOut": false,
  "products": [
    { "path": ".mim/code-runs/<runId>/plot-01.png", "bytes": 45000, "kind": "image" }
  ]
}
```

## Plot-Capture Harness

`resources/r/mim-run.R` is a base-R harness that intercepts plot device opens.
It activates only when `code.run` rewrites argv, which happens under these
conditions:

- `capture_plots` is not `false` (default: true)
- argv has exactly two elements
- argv[0] resolves to `rscript`
- argv[1] ends in `.R` or `.r`

The rewrite transforms `[rscriptBinPath, script.R]` into
`[rscriptBinPath, <harness path>, script.R]`.

The harness:

1. Sets `options(device = ...)` to a custom function that opens sequential PNGs
   (`plot-01.png`, `plot-02.png`, ...) at 1600x1200 px, 192 DPI in `MIM_RUN_DIR`
2. Sources the user script with `echo = TRUE` (model sees interleaved code+output)
3. Closes all open graphics devices
4. Prints any warnings
5. Exits with status 1 on error, 0 otherwise

Scripts that use `ggsave()` or other explicit save calls produce outputs
detected by the mtime scan regardless of the harness. The harness catches
base-graphics `plot()` calls that would otherwise go to `Rplots.pdf`.

Users opt out per call with `capture_plots: false`.

## Unified Bash Tool (shell.run)

The AI agent uses a single `bash` tool (registry name `shell.run`) for all
command execution. Two modes:

**Captured mode (default, `terminal` falsy):** Spawns the user's login shell
(`defaultShell()` from `@main/platform.js`) with `['-lc', command]` on POSIX
or `cmd.exe ['/d','/s','/c', command]` on Windows. Returns exit code,
stdout/stderr tails, and workspace products.

**Terminal mode (`terminal: true`):** Types the command into the user's visible
terminal and returns `{ sent: true }` immediately. No output capture, no
products, no run.json. Used for dev servers, watch modes, and interactive
processes. Requires the desktop app — headless throws a clear error.

### Parameters

| Param | Type | Default | Notes |
|---|---|---|---|
| command | string (min 1) | required | Shell command to execute |
| terminal | boolean | false | Type into visible terminal instead |
| timeout_ms | number | 120000 | Clamped to 1000-480000 |
| capture_plots | boolean | true | Enable R plot-capture fast path |

### R Plot-Capture Fast Path

When `capture_plots !== false` AND the command matches the exact regex
`^\s*Rscript\s+(\S+\.[rR])\s*$` (single file argument, no flags, pipes,
chaining, or quotes) AND Rscript is toolchain-detected AND the harness file
resolves: the shell is bypassed and Rscript is spawned directly with the
plot-capture harness. Anything else runs verbatim via the shell.

### Kill Switch

The `shell.run` tool-policy row (domain: `code`, risk: `sensitive`, default
enabled) governs the `bash` AI tool key. Disabling it in Settings > Tools
removes the `bash` tool from the AI tool set entirely. Disabling does NOT
affect `code.run` (the Render button path).

## Security Posture

**D1 — Interpreter allowlist (code.run only).** `code.run` restricts to
detected binaries from the fixed catalog. The allowlist is user-configurable
in Settings > Tools. `shell.run` has no interpreter allowlist — it provides
full shell access, gated by per-call approval.

**D3 — Per-run approval with session allow.** Both `code.run` and `shell.run`
are category `system`, risk `high`. Every call prompts in Normal and Strict
modes. The session "always allow" checkbox applies (subject to the
sensitive-path floor). `shell.run` shows "run a shell command" plus the
command string. `code.run` shows "run a script" plus the joined argv.

**D6 — Detected absolute paths (code.run only).** `resolveInterpreter`
returns the absolute path found by the login shell. The spawn never falls
back to PATH-relative lookup, preventing workspace-planted executables from
being invoked.

## AI Tool

The `bash` AI tool has an 8.5-minute timeout (510,000ms) to accommodate the
maximum 480s script runtime plus kill grace. The tool description instructs the
agent to write code to a file first, run it, fix on failure, and open the best
product with `editor_open` after success.

## code.run Kernel Tool

`code.run` remains as the kernel-level interpreter execution tool. It is used
by the editor Render button (user actor, not AI) and the headless CLI. It
enforces the interpreter allowlist and does NOT provide shell access.

## Render

`renderDocument.ts` provides the engine decision for Rmd/qmd rendering:

- `.qmd` requires quarto: `['quarto', 'render', <path>]`
- `.rmd` prefers quarto: `['quarto', 'render', <path>]`; falls back to
  `['rscript', '-e', "rmarkdown::render('<escaped path>')"]` if quarto is absent
- Other extensions: no render available

When quarto PDF rendering fails with a missing-engine signature, the guidance
reads: "PDF engine missing -- run `quarto install tinytex` or render to HTML".

The Render button appears in the editor toolbar when the active tab is
`.rmd`/`.qmd` and a suitable engine is detected (via `toolchainStatus.ts`
cached service). Clicking it calls `code.run` with `capture_plots: false`.

## Chat Run Card

`bash` tool parts render as a purpose-built card in chat (`ChatCodeRunCard.vue`).
The card shows:

- Command line (the `command` string)
- Status indicator (running/ok/failed/timed-out/error/sent)
- Duration label
- Collapsible output text (stdout + stderr)
- Truncation notice when output was capped
- Product chips with kind icon, filename, and size

Terminal-mode results (`{ sent: true }`) render with a `sent` status and no
output/products section. Clicking a product chip opens the file in the Artifact
pane via the chat open-file path.

## Settings Surface

Settings > Tools shows a "Code execution" group containing:

- The `shell.run` (Bash) policy toggle — disable to remove agent command
  execution entirely
- The `code.run` (Run code interpreters) policy toggle — disable to remove
  Render-button agent access (the Render button itself still works as user actor)
- Per-interpreter toggles built from `toolchain.status` results: R, Rscript,
  Quarto, python3 (pandoc excluded). Each shows name, version or "not found",
  and a toggle bound to the `codeInterpreters` setting. Not-installed entries
  have a disabled toggle.

## Human Loop

The human loop provides RStudio-style muscle memory on top of Mim's terminal.

### Cmd+Enter: Send to Terminal

In code-file text tabs (not plain markdown), Cmd/Ctrl+Enter sends the
selection (or current line if no selection) to the terminal and advances the
cursor to the next non-blank line. The logic lives in
`codemirror/sendToTerminal.js`.

### Cmd+Shift+Enter: Source File / Send Chunk

Behavior depends on the active file type:

- **Rmd/qmd files**: sends the whole chunk body (fences excluded). Outside any
  chunk, does nothing. Chunk detection uses the CM6 markdown syntax tree
  (`FencedCode` nodes) with fence-info normalization.
- **R files**: saves the file first, then sends
  `source('<escaped path>', echo = TRUE)` to the terminal. If the save fails,
  nothing is sent. Path escaping uses `escapeForRString` from
  `renderDocument.ts` (single-quote R string escaping).
- **Other code files**: sends the entire buffer text with its language to the
  terminal, flowing through the bracketed-paste and chunked-write pipeline.

### Rmd/qmd Chunk Execution

In `.rmd`/`.qmd` files, Cmd+Enter inside an `{r}` or `{python}` chunk sends
the current line/selection. Cmd+Shift+Enter sends the whole chunk body (fences
excluded). Outside any chunk, Cmd+Enter does nothing.

### Bracketed Paste

Multi-line sends to R program tabs are wrapped in bracketed-paste escape
markers (`\x1b[200~` ... `\x1b[201~`) so that R's readline treats the paste
as a single unit rather than executing line-by-line. The format:

```
\x1b[200~<CR-joined body, no trailing CR inside>\x1b[201~\r
```

Single-line sends and sends to non-R (shell) tabs use plain CR-joined text
with one trailing CR. Bracketed paste is determined by the `program` field on
the terminal tab (`TermTab.program === 'r'`).

### Chunked Writes

Large payloads are split into 16KB chunks and written sequentially via
`terminal.write` kernel calls. This prevents xterm/pty buffer overflow on
large pastes. Payloads exceeding 2,000,000 characters are rejected with an
error toast ("Selection too large to paste -- use Source (Cmd+Shift+Enter)
instead") and nothing is sent.

### R Console Auto-Spawn

When Cmd+Enter is triggered from an R file and no terminal exists, a program
tab running `R --no-save` is spawned directly (validated against the detected
toolchain). If R is not detected, a normal shell tab opens with a toast: "R
not found -- sent to shell".

Terminal program spawn validates the program name against `detectToolchain()`
binPaths. `PROGRAM_DEFAULT_ARGS` maps `r` to `['--no-save']`.

### Program Metadata

`TermTab` carries an optional `program` field set when a program tab is
spawned (via `addProgramTab` or `sendText`'s implicit spawn path). Shell tabs
leave `program` undefined. This field drives the bracketed-paste decision.

### Workbench Command

The editor emits `{ type: 'terminal.send', text, language }`. The command
router opens the terminal in the Work pane with `preserveArtifact: true` so
the editor stays visible, then routes to `WorkHost.sendTerminalText(text, opts)`.
After the async send, `EditorPanel` refocuses the CodeMirror view so the user
can press Cmd+Enter repeatedly to step through a file without losing the cursor.
