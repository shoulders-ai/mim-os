import type { ComputedRef } from 'vue'
import { Prec } from '@codemirror/state'
import { keymap } from '@codemirror/view'
import {
  toggleBold, toggleItalic, toggleCode, toggleStrikethrough,
  toggleHeading, toggleBulletList, toggleNumberedList, toggleCheckbox,
  toggleBlockquote, insertLink, insertImage, insertHorizontalRule,
  insertCitation,
} from './codemirror/formatting.js'

interface UseEditorFormattingOptions {
  activeIsMarkdown: ComputedRef<boolean>
  activeTabReadOnly: ComputedRef<boolean>
  historyPreviewActive: ComputedRef<boolean>
  getEditorView: () => any
  saveActiveFile: () => Promise<boolean> | boolean
}

export function useEditorFormatting(options: UseEditorFormattingOptions) {
  function markdownCommand(command: (view: any) => void) {
    return (view: any) => {
      if (options.historyPreviewActive.value) return false
      if (!options.activeIsMarkdown.value) return false
      if (options.activeTabReadOnly.value) return false
      command(view)
      return true
    }
  }

  function editorKeymaps() {
    return Prec.highest(keymap.of([
      {
        key: 'Mod-s',
        run() {
          options.saveActiveFile()
          return true
        },
      },
      { key: 'Mod-b', run: markdownCommand(toggleBold) },
      { key: 'Mod-i', run: markdownCommand(toggleItalic) },
      { key: 'Mod-Shift-x', run: markdownCommand(toggleStrikethrough) },
      { key: 'Mod-Shift-8', run: markdownCommand(toggleBulletList) },
      { key: 'Mod-Shift-7', run: markdownCommand(toggleNumberedList) },
      { key: 'Mod-Shift-.', run: markdownCommand(toggleBlockquote) },
    ]))
  }

  function onFormat(action: string) {
    if (options.historyPreviewActive.value) return
    if (options.activeTabReadOnly.value) return
    const editorView = options.getEditorView()
    if (!editorView) return
    editorView.focus()
    switch (action) {
      case 'bold': toggleBold(editorView); break
      case 'italic': toggleItalic(editorView); break
      case 'strikethrough': toggleStrikethrough(editorView); break
      case 'code': toggleCode(editorView); break
      case 'heading-1': toggleHeading(editorView, 1); break
      case 'heading-2': toggleHeading(editorView, 2); break
      case 'heading-3': toggleHeading(editorView, 3); break
      case 'bullet-list': toggleBulletList(editorView); break
      case 'numbered-list': toggleNumberedList(editorView); break
      case 'checkbox': toggleCheckbox(editorView); break
      case 'blockquote': toggleBlockquote(editorView); break
      case 'link': insertLink(editorView); break
      case 'image': insertImage(editorView); break
      case 'horizontal-rule': insertHorizontalRule(editorView); break
      case 'cite':
      case 'citation': insertCitation(editorView); break
    }
  }

  return {
    editorKeymaps,
    onFormat,
  }
}
