# Spec: running code (order 6)

Purpose: Mim as a place where analysis actually runs — terminal, agent-run code,
and the R/Quarto loop.

## Outline

- The terminal: multi-tab shells; program tabs launch detected interpreters
  (R, python — verify the set in toolchain source). Detection happens automatically;
  missing tools are shown, not errors.
- From document to terminal: <kbd>Cmd+Enter</kbd> sends the current line or chunk
  to the terminal (verify exact behavior/labels in the send-to-terminal source).
- The agent runs code: the `bash` tool in chat — output arrives as a run card;
  runs are recorded. `code.run` for allowlisted interpreters; plots produced by R
  are captured and shown (plot-capture harness — one user-level sentence).
- Which interpreters are allowed is yours to control (verify: Settings > Tools,
  interpreter toggles in `codeInterpreterRows.ts`).
- The render loop: Rmd and Quarto documents render from the editor (verify engine
  matrix in `renderDocument.ts`); products (PDF/HTML) open in the artifact pane.
- Trapdoor: toolchain detection (login-shell resolution, version capture); run
  records and output caps.

## Boundaries

No CLI coding agents (→ agents) — a shell tab and an agent run are different
things; one contrast sentence is allowed. No approval-policy depth (→ privacy &
security).

## Sources

- docs/code-execution.md
- src/main/tools/code.ts
- src/main/toolchain/toolchain.ts
- src/renderer/components/editor/codemirror/sendToTerminal.js
- src/renderer/services/renderDocument.ts
- src/renderer/components/settings/codeInterpreterRows.ts

## Length

900–1300 words.
