# R First-Class — Manual QA Script

End-to-end verification of the R/Rmd/Quarto integration (proposal phases 1-5).
Each step is phrased "do X, confirm Y" for a human tester or an agent asking
the user to confirm visually. No screenshots.

Prerequisites: a workspace with at least one `.R` file, one `.Rmd` or `.qmd`
file, and a CSV data file. R and Quarto installed on the system (some steps
have explicit "R missing" variants).

---

## Scene 1: Chat Does the Analysis

The agent writes a script, runs it, sees errors, fixes, and the plot appears.

1. Open a workspace containing `data/trial.csv` (any CSV with numeric columns).
2. In chat, ask: "Fit a linear model on data/trial.csv predicting column Y from
   column X, save a residual plot."
3. Confirm: the agent writes an `.R` file in the workspace (e.g.
   `analysis/fit_model.R`).
4. Confirm: an approval card appears reading "run a shell command --
   Rscript analysis/fit_model.R" with a session-allow checkbox.
5. Approve the run.
6. Confirm: the chat shows a run card with green status dot, duration, and a
   product chip for a PNG image.
7. Confirm: clicking the product chip opens the plot in the Artifact pane image
   tab (fit-to-pane, dark background correct in dark theme).
8. If the model had a convergence warning or error, confirm: the agent read
   stderr, fixed the script, and re-ran (second approval card or session-allow
   applied).

## Scene 2: The Report Renders Beside You

A `.qmd` open in Work, rendered PDF in Artifact.

1. Open a `.qmd` file in the editor.
2. Confirm: the formatting toolbar appears, live preview works in split mode,
   `{r}` chunks have R syntax highlighting.
3. Click the Render button in the toolbar.
4. Confirm: the button shows a spinner while rendering.
5. Confirm: on success, the PDF appears in the Artifact pane.
6. Edit the `.qmd` (add a paragraph), click Render again.
7. Confirm: the PDF refreshes in place (same tab, updated content).

## Scene 3: CLI Agents Are Native Citizens

A CLI agent (or terminal command) produces a plot; it appears in the Artifact
pane via MCP `editor_open`.

1. In the terminal, run a script that produces `outputs/plot.png` (e.g.
   `Rscript -e "png('outputs/plot.png'); plot(1:10); dev.off()"`).
2. From a CLI agent session (or manually via `mim tool editor.open`), open
   `outputs/plot.png`.
3. Confirm: the image appears in the Artifact pane image tab.

---

## Image Tab

1. In the Files browser, click a `.png` file.
   - Confirm: it opens as an image tab in the Artifact pane (not bounced to OS).
2. Click the image.
   - Confirm: toggles between fit-to-pane and 100% (pixel) size.
3. Confirm: the footer shows filename and pixel dimensions.
4. Open a `.svg` file the same way.
   - Confirm: SVG renders correctly in the image tab.
5. Open a `.heic` or `.tiff` file.
   - Confirm: it opens via the native OS viewer (card tab or OS app), not
     the image viewer.

## Image/PDF Refresh

1. Open a `.png` in the Artifact pane.
2. In the terminal, overwrite it: `cp other.png plot.png`.
3. Confirm: the image tab updates within ~1s without losing focus or flicker.
4. Repeat with a `.pdf` tab -- overwrite the PDF, confirm it refreshes.

## Rmd/qmd Chunk Highlighting

1. Open an `.Rmd` file containing a `` ```{r} `` chunk.
2. Confirm: prose areas get markdown formatting; the chunk body shows R syntax
   highlighting (keywords colored).
3. Open a `.qmd` with a `` ```{python} `` chunk.
4. Confirm: Python highlighting inside the chunk.
5. Confirm: the live preview pane renders prose but shows code chunks as
   fenced blocks.

## Cmd+Enter Flows

### Plain R file

1. Open a `.R` file. Place the cursor on a line like `x <- rnorm(100)`.
2. Press Cmd+Enter (Ctrl+Enter on Linux/Windows).
3. Confirm: the terminal reveals, an R console tab spawns (`R --no-save`), and
   the line executes.
4. Confirm: the cursor advances to the next non-blank line.
5. Select a 3-line block, press Cmd+Enter.
6. Confirm: all three lines execute in the R console.
7. Press Cmd+Enter in a plain `.md` file.
8. Confirm: nothing happens (key is not active in plain markdown).

### R console auto-spawn

1. Close all terminal tabs.
2. Open a `.R` file, press Cmd+Enter.
3. Confirm: an "R" terminal tab appears at the R prompt, line executes.
4. In the R console, type `q()` and confirm the tab shows exited state.

### Chunk send (Rmd/qmd)

1. Open an `.Rmd` file. Place cursor inside a `{r}` chunk body.
2. Press Cmd+Enter.
3. Confirm: the current line is sent to the R console.
4. Press Cmd+Shift+Enter.
5. Confirm: the entire chunk body (fences excluded) is sent.
6. Move cursor to prose (outside any chunk). Press Cmd+Enter.
7. Confirm: nothing happens.

## Render Button

1. Open a `.qmd` file with quarto detected.
2. Confirm: the Render button is visible in the toolbar.
3. Click Render.
4. Confirm: PDF (or HTML) product opens in Artifact pane on success.
5. Introduce a syntax error in the `.qmd`, click Render.
6. Confirm: a toast appears with the error tail.

### tinytex missing

1. On a machine without tinytex installed, open a `.qmd` that renders to PDF.
2. Click Render.
3. Confirm: the error message includes guidance: "PDF engine missing -- run
   `quarto install tinytex` or render to HTML".

## Run Card and Product Chips

1. From chat, trigger a `bash` command that produces multiple products (a PNG and
   a CSV), e.g. "run Rscript analysis/multi_output.R".
2. Confirm: the run card shows the command line, green status, duration.
3. Confirm: product chips list the PNG and CSV with kind icons and sizes.
4. Click the PNG chip.
5. Confirm: opens in the image tab.
6. Click the CSV chip.
7. Confirm: opens in the table tab.
8. Collapse/expand the output section.
9. Confirm: stdout/stderr text is visible when expanded.

## Terminal Mode

1. In chat, ask: "start a dev server" or give a command the agent runs with
   terminal:true.
2. Confirm: the approval card shows "run a shell command" plus the command.
3. Approve.
4. Confirm: the run card shows "sent" status (no output section, no duration).
5. Confirm: the terminal reveals with the command typed into it.

## Settings > Tools

1. Open Settings > Tools.
2. Confirm: a "Code execution" group is visible with a "Bash" row and a
   "Run code interpreters" row.
3. Confirm: interpreter rows show R, Rscript, Quarto (and python3 if detected)
   with versions or "not found".
4. Toggle Rscript off.
5. In chat, ask to run an R script via the Render button.
6. Confirm: the Render button path (`code.run`) fails with a clear allowlist
   error (not a cryptic spawn failure).
7. Toggle Rscript back on.
8. Confirm: subsequent Render runs succeed.

### Bash Row Disabled

1. In Settings > Tools, toggle the "Bash" row off.
2. In chat, ask to run any shell command.
3. Confirm: the agent has no `bash` tool available — it cannot execute commands.
4. Confirm: the Render button still works (it uses `code.run`, not `shell.run`).
5. Toggle "Bash" back on.
6. Confirm: the agent can execute commands again.

## Agent Context — Toolchain Section

1. Open `.mim/agent-context.md` in the workspace.
2. Confirm: a `## Toolchain` section exists listing detected binaries with
   versions and paths (e.g. "R 4.4.1 -- /opt/homebrew/bin/R").
3. If `renv.lock` exists in the workspace root, confirm: "renv.lock present"
   appears.
4. Switch workspace, re-check that `workspace.orient` refreshes the section.

---

## Negative Paths

### R not installed

1. Temporarily rename/hide the R binary (or test on a machine without R).
2. Press Cmd+Enter in a `.R` file.
3. Confirm: a normal shell tab opens with a toast "R not found -- sent to
   shell".
4. In chat, ask to run an R script.
5. Confirm: the `bash` tool runs `Rscript file.R` via the shell (no fast-path
   rewrite since Rscript is not detected) and the shell reports "command not
   found".
6. Confirm: Settings > Tools shows "not found" for R/Rscript with disabled
   toggles.

### Interpreter toggled off

1. In Settings > Tools, toggle Rscript off.
2. From chat, attempt to run an R script.
3. Confirm: the tool call fails before the approval card (allowlist rejection).

### Run declined

1. From chat, trigger a `bash` command.
2. On the approval card, click Decline (do not approve).
3. Confirm: the agent receives a permission-denied result and reports it.
4. Confirm: no `.mim/code-runs/` record is created for the declined run.

### Timeout

1. From chat, ask to run a script with a very short timeout: e.g. "run
   analysis/slow.R with a 2 second timeout" (where `slow.R` contains
   `Sys.sleep(30)`).
2. Confirm: after ~2s the run card shows "timed-out" status.
3. Confirm: the result reports `timedOut: true` and `exitCode: null`.
4. Confirm: no zombie R processes remain (`ps aux | grep R`).
