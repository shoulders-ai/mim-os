---
id: running-code
title: running code
order: 5
sources:
  - docs/code-execution.md
  - src/main/tools/code.ts
  - src/main/toolchain/toolchain.ts
  - src/renderer/components/editor/codemirror/sendToTerminal.js
  - src/renderer/services/renderDocument.ts
  - src/renderer/components/settings/codeInterpreterRows.ts
verified: bf1358ebd68b1348a9fd85c6576c5b71e5f11880
---

# running code

Mim detects the interpreters on your machine and gives you three ways to run code: typing into a terminal, sending lines from the editor, and letting the agent run commands in chat.

## Toolchain detection

When a workspace opens, Mim looks for five binaries through your login shell: R, Rscript, Quarto, pandoc, and python3. Detection happens automatically. If a binary is missing, Mim records that and moves on -- nothing breaks, and Settings shows "not found" next to the entry. Detected interpreters appear with their version number.

## The terminal

The terminal lives in the work pane. You can open multiple shell tabs, each running your default login shell. Mim also offers program tabs that launch a detected interpreter directly -- an R program tab, for example, starts `R --no-save` so you get an interactive R console alongside your editor. Shell tabs and program tabs can coexist; each is its own tab in the terminal.

When you send code from an R file and no terminal exists yet, Mim spawns an R program tab for you automatically. If R is not detected, a normal shell tab opens instead with a notification.

## From the editor to the terminal

Two shortcuts move code from the editor into the terminal without copy-paste.

<kbd>Cmd+Enter</kbd> sends the current selection -- or, if nothing is selected, the current line -- to the terminal and advances the cursor to the next non-blank line. In `.rmd` and `.qmd` files, this works only inside `{r}` or `{python}` chunks.

<kbd>Cmd+Shift+Enter</kbd> behaves differently depending on the file type:

::: rows
- R files -- saves the file, then sends `source('<path>', echo = TRUE)` to the terminal.
- Rmd / qmd files -- sends the entire chunk body (fences excluded) to the terminal. Outside a chunk, does nothing.
- Other code files -- sends the full buffer text to the terminal.
:::

Multi-line sends to R program tabs use bracketed paste so R treats the block as a single unit rather than executing it line by line. Very large selections (over two million characters) are rejected with a notification suggesting you use <kbd>Cmd+Shift+Enter</kbd> to source the file instead.

## The agent runs code

In chat, the agent has a `bash` tool. It runs a shell command in your workspace, captures the output, and returns the result as a run card in the conversation. The card shows the command line, a status indicator (success, failed, timed out, or error), the run duration, and collapsible output text. If the output was long, a truncation notice appears. Files the run created or changed show up as product chips on the card -- click one to open it in the artifact pane.

Runs have a default timeout of two minutes, extendable up to eight minutes. If a command times out, the card shows a timed-out status and the process is stopped.

When the command is exactly `Rscript file.R` (no flags, no pipes), Mim intercepts base-graphics `plot()` calls and captures them as PNG files automatically. Scripts that save their own output with `ggsave()` or similar calls produce products regardless.

The agent can also run in terminal mode, typing a command into your visible terminal instead of capturing output. The run card then shows a "sent" status with no output section. This is for long-running processes like dev servers where you want to watch the output yourself.

## Choosing which interpreters the agent can use

Settings > Tools has a "Code execution" group. It contains two policy toggles and the per-interpreter allowlist.

The "Bash" toggle controls whether the agent can run shell commands at all. Turning it off removes the `bash` tool from chat entirely.

The "Run code interpreters" toggle controls whether the agent can call `code.run`. Disabling it does not affect the Render button when you press it yourself.

Below those toggles, each detected interpreter -- R, Rscript, Quarto, Python -- has its own toggle. Interpreters that were not found have a disabled toggle. Turning an interpreter off prevents the agent from running it through `code.run`. The default allowlist includes R, Rscript, and Quarto. Python is detected but off by default.

The toggles control whether the tool is offered to the agent at all; per-call approval is covered in [privacy & security](privacy-security).

## Rendering documents

When you open an `.rmd` or `.qmd` file and Mim detects a suitable engine, a Render button appears in the editor toolbar. Clicking it runs the document and opens the product -- typically a PDF or HTML file -- in the artifact pane.

The engine decision:

::: rows
- `.qmd` files -- rendered with Quarto. If Quarto is not detected, no Render button appears.
- `.rmd` files -- rendered with Quarto when available, otherwise with Rscript via `rmarkdown::render()`. If neither is detected, no Render button appears.
:::

If PDF rendering fails because a LaTeX engine is missing, the error guidance reads: "PDF engine missing — run `quarto install tinytex` or render to HTML."

::: under-the-hood
Toolchain detection resolves each binary by running `command -v` through your login shell (or `where.exe` on Windows) with a 15-second timeout. Version strings come from `--version` output. Results are cached for the lifetime of the app session.

Each captured run writes a `run.json` record under `.mim/code-runs/` with the command (for interpreter runs, the argv), timing, exit code, and a list of products. Output tails are capped at 16,000 characters for stdout and 6,000 for stderr, keeping the end of the output so error messages are preserved.
:::
