import type { ComputedRef } from 'vue'
import { Prec } from '@codemirror/state'
import { keymap } from '@codemirror/view'
import {
  toggleBold, toggleItalic, toggleCode, toggleStrikethrough,
  toggleHeading, toggleBulletList, toggleNumberedList, toggleCheckbox,
  toggleBlockquote, insertLink, insertImage, insertHorizontalRule,
  insertCitation,
} from './codemirror/formatting.js'
import { computeSendSelection, languageFromPath, computeChunkSend, computeSourceCommand } from './codemirror/sendToTerminal.js'

interface UseEditorFormattingOptions {
  activeIsMarkdown: ComputedRef<boolean>
  activeTabReadOnly: ComputedRef<boolean>
  historyPreviewActive: ComputedRef<boolean>
  activeFilePath: ComputedRef<string>
  getEditorView: () => any
  saveActiveFile: () => Promise<boolean> | boolean
  sendToTerminal?: (text: string, language: string | null) => void
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

  function sendToTerminalCommand(view: any) {
    if (options.historyPreviewActive.value) return false
    if (options.activeTabReadOnly.value) return false
    if (!options.sendToTerminal) return false

    const filePath = options.activeFilePath.value
    const isMarkdown = options.activeIsMarkdown.value

    if (isMarkdown) {
      // In markdown files, Mod-Enter only works inside R/python chunks
      const result = computeChunkSend(view.state, 'line')
      if (!result) return false
      options.sendToTerminal(result.text, result.language)
      // Move cursor to next position
      view.dispatch({ selection: { anchor: result.nextPos } })
      return true
    }

    // Non-markdown: send current line/selection
    const result = computeSendSelection(view.state)
    if (!result) {
      // Blank line: just advance cursor to next line
      const line = view.state.doc.lineAt(view.state.selection.main.head)
      if (line.number < view.state.doc.lines) {
        const next = view.state.doc.line(line.number + 1)
        view.dispatch({ selection: { anchor: next.from } })
      }
      return true
    }

    const lang = languageFromPath(filePath)
    options.sendToTerminal(result.text, lang)
    view.dispatch({ selection: { anchor: result.nextPos } })
    return true
  }

  function sendChunkCommand(view: any) {
    if (options.historyPreviewActive.value) return false
    if (options.activeTabReadOnly.value) return false
    if (!options.sendToTerminal) return false

    const filePath = options.activeFilePath.value
    const isMarkdown = options.activeIsMarkdown.value

    if (isMarkdown) {
      // Markdown files: send chunk body (existing behavior unchanged)
      const result = computeChunkSend(view.state, 'chunk')
      if (!result) return false
      options.sendToTerminal(result.text, result.language)
      view.dispatch({ selection: { anchor: result.nextPos } })
      return true
    }

    // Non-markdown code files: source/run the whole file
    const lang = languageFromPath(filePath)
    const sourceCmd = computeSourceCommand(filePath, lang)

    if (sourceCmd) {
      // R files: save first, then send source() expression
      ;(async () => {
        const saved = await options.saveActiveFile()
        if (!saved) return
        options.sendToTerminal!(sourceCmd, lang)
      })()
      return true
    }

    // Other code files: send entire buffer text
    const text = view.state.doc.toString()
    if (!text) return false
    options.sendToTerminal(text, lang)
    return true
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
      {
        key: 'Mod-Enter',
        run: sendToTerminalCommand,
      },
      {
        key: 'Mod-Shift-Enter',
        run: sendChunkCommand,
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
