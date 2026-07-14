# Spec: what is mim (order 1)

Purpose: the reader closes this page knowing what Mim is, what it looks like, and
whether it is for them. It carries the product's mental model; every later chapter
assumes it.

## Outline

- What Mim is: a desktop app for AI-native research work. Local-first, file-based —
  everything durable is a file on your machine a colleague could read without Mim.
- The window: Navigator (left) selects work; the Work pane is where you act; the
  Artifact pane shows durable things (documents, PDFs, images). Use a `::: rows` block.
- The three core surfaces in one paragraph each: Chat (an agent with tools that asks
  before consequential actions), the editor, the terminal.
- Extension in one paragraph: apps, skills, and routines exist; point to
  [apps](apps) and [agents](agents). Do not explain them here.
- Where things live, briefly: the workspace folder; nothing hidden in a cloud.
- Trapdoor: the runtime in one paragraph (Electron; a single tool registry that every
  actor — you, the agent, apps — calls through; permission gate + trace). Link /develop.

## Boundaries

No install steps (→ install). No workspace mechanics (→ your first workspace).
No feature depth of any surface (→ their chapters). This chapter has no kbd, no code
blocks.

## Sources

- README.md
- docs/routines.md
- docs/workbench-navigation.md
- src/renderer/components/sidebar/ShellSidebar.vue (verify surface names as shipped)

## Length

600–900 words. The shortest chapter except shortcuts.
