# Spec: shortcuts (order 12)

Purpose: the book's appendix — every keyboard shortcut, generated, never
hand-maintained.

## Form

This chapter is **generated**. The generator extracts from the same sources the
in-app shortcuts dialog reads (`ShortcutsDialog.vue` / `shortcutLabels.ts`) and
emits the chapter body; the drafted file contains only:

- frontmatter (sources: the two shortcut source files);
- a two-sentence opening: shortcuts are also listed in the app (verify how the
  dialog is opened — menu item and/or shortcut); macOS forms shown, Cmd reads as
  Ctrl on Windows and Linux;
- an include marker for the generated tables: `<!-- generated:shortcuts -->`.

The generator groups shortcuts as the in-app dialog groups them, one table per
group: 11px lowercase headers, kbd in the first column, action description second.

## Writer instructions

The drafting agent for this chapter writes ONLY the frontmatter and opening and
verifies the dialog-opening claim. Do not transcribe shortcuts by hand — the
generator owns the tables. If the generator does not exist yet at draft time,
leave the marker; the compile step fails loudly on an unresolved marker, which is
correct.

## Sources

- src/renderer/components/ShortcutsDialog.vue
- src/renderer/services/shortcutLabels.ts

## Length

Opening prose under 100 words.
