// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed } from 'vue'

// ---- Mocks for CM6 modules ----
vi.mock('./codemirror/sendToTerminal.js', () => ({
  computeSendSelection: vi.fn(),
  computeChunkSend: vi.fn(),
  languageFromPath: vi.fn(),
  computeSourceCommand: vi.fn(),
}))

vi.mock('./codemirror/formatting.js', () => ({
  toggleBold: vi.fn(),
  toggleItalic: vi.fn(),
  toggleCode: vi.fn(),
  toggleStrikethrough: vi.fn(),
  toggleHeading: vi.fn(),
  toggleBulletList: vi.fn(),
  toggleNumberedList: vi.fn(),
  toggleCheckbox: vi.fn(),
  toggleBlockquote: vi.fn(),
  insertLink: vi.fn(),
  insertImage: vi.fn(),
  insertHorizontalRule: vi.fn(),
  insertCitation: vi.fn(),
}))

// Stub Prec.highest / keymap.of so editorKeymaps() doesn't crash
vi.mock('@codemirror/state', () => ({
  Prec: { highest: (x: any) => x },
}))
vi.mock('@codemirror/view', () => ({
  keymap: { of: (bindings: any[]) => bindings },
}))

import { useEditorFormatting } from './useEditorFormatting.js'
import {
  computeSendSelection,
  computeChunkSend,
  languageFromPath,
  computeSourceCommand,
} from './codemirror/sendToTerminal.js'
import {
  toggleBold,
  toggleItalic,
  toggleCode,
  toggleStrikethrough,
  toggleHeading,
  toggleBulletList,
  toggleNumberedList,
  toggleCheckbox,
  toggleBlockquote,
  insertLink,
  insertImage,
  insertHorizontalRule,
  insertCitation,
} from './codemirror/formatting.js'

// ---- Helpers ----

function makeView(overrides: Record<string, any> = {}) {
  return {
    state: {
      doc: {
        lineAt: vi.fn(() => ({ number: 1, from: 0, to: 5 })),
        line: vi.fn((n: number) => ({ from: n * 10, to: n * 10 + 5 })),
        lines: 5,
      },
      selection: { main: { head: 0 } },
    },
    dispatch: vi.fn(),
    focus: vi.fn(),
    ...overrides,
  }
}

interface MountOpts {
  activeIsMarkdown?: boolean
  activeTabReadOnly?: boolean
  historyPreviewActive?: boolean
  activeFilePath?: string
  sendToTerminal?: ((text: string, language: string | null) => void) | undefined
  saveActiveFile?: (() => Promise<boolean> | boolean)
}

function mount(opts: MountOpts = {}) {
  const sendToTerminal = opts.sendToTerminal !== undefined
    ? opts.sendToTerminal
    : vi.fn()

  return useEditorFormatting({
    activeIsMarkdown: computed(() => opts.activeIsMarkdown ?? false),
    activeTabReadOnly: computed(() => opts.activeTabReadOnly ?? false),
    historyPreviewActive: computed(() => opts.historyPreviewActive ?? false),
    activeFilePath: computed(() => opts.activeFilePath ?? 'script.R'),
    getEditorView: () => makeView(),
    saveActiveFile: opts.saveActiveFile ?? vi.fn(() => true),
    sendToTerminal: sendToTerminal ?? undefined,
  })
}

function getKeyBinding(keymaps: any[], key: string) {
  return keymaps.find((k: any) => k.key === key)
}

// ---- Tests ----

describe('useEditorFormatting', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ================================================================
  // sendToTerminalCommand (Mod-Enter)
  // ================================================================
  describe('sendToTerminalCommand (Mod-Enter)', () => {
    it('returns false when historyPreviewActive is true', () => {
      const { editorKeymaps } = mount({ historyPreviewActive: true })
      const binding = getKeyBinding(editorKeymaps(), 'Mod-Enter')
      expect(binding.run(makeView())).toBe(false)
    })

    it('returns false when activeTabReadOnly is true', () => {
      const { editorKeymaps } = mount({ activeTabReadOnly: true })
      const binding = getKeyBinding(editorKeymaps(), 'Mod-Enter')
      expect(binding.run(makeView())).toBe(false)
    })

    it('returns false when sendToTerminal is undefined', () => {
      const { editorKeymaps } = mount({ sendToTerminal: null as any })
      // sendToTerminal is explicitly set to undefined via the mount helper
      const result = useEditorFormatting({
        activeIsMarkdown: computed(() => false),
        activeTabReadOnly: computed(() => false),
        historyPreviewActive: computed(() => false),
        activeFilePath: computed(() => 'script.R'),
        getEditorView: () => makeView(),
        saveActiveFile: vi.fn(),
        // sendToTerminal omitted
      })
      const binding = getKeyBinding(result.editorKeymaps(), 'Mod-Enter')
      expect(binding.run(makeView())).toBe(false)
    })

    describe('non-markdown files', () => {
      it('calls computeSendSelection, sendToTerminal, and dispatches cursor advance', () => {
        const sendToTerminal = vi.fn()
        const { editorKeymaps } = mount({ sendToTerminal, activeFilePath: 'analysis.py' })
        const view = makeView()

        vi.mocked(computeSendSelection).mockReturnValue({ text: 'print("hi")', nextPos: 42 })
        vi.mocked(languageFromPath).mockReturnValue('python')

        const binding = getKeyBinding(editorKeymaps(), 'Mod-Enter')
        const result = binding.run(view)

        expect(result).toBe(true)
        expect(computeSendSelection).toHaveBeenCalledWith(view.state)
        expect(languageFromPath).toHaveBeenCalledWith('analysis.py')
        expect(sendToTerminal).toHaveBeenCalledWith('print("hi")', 'python')
        expect(view.dispatch).toHaveBeenCalledWith({ selection: { anchor: 42 } })
      })

      it('advances cursor without calling sendToTerminal when computeSendSelection returns null (blank line)', () => {
        const sendToTerminal = vi.fn()
        const { editorKeymaps } = mount({ sendToTerminal })
        const view = makeView({
          state: {
            doc: {
              lineAt: vi.fn(() => ({ number: 2, from: 10, to: 15 })),
              line: vi.fn((n: number) => ({ from: n * 10, to: n * 10 + 5 })),
              lines: 5,
            },
            selection: { main: { head: 12 } },
          },
        })

        vi.mocked(computeSendSelection).mockReturnValue(null)

        const binding = getKeyBinding(editorKeymaps(), 'Mod-Enter')
        const result = binding.run(view)

        expect(result).toBe(true)
        expect(sendToTerminal).not.toHaveBeenCalled()
        // Should advance to the next line (line 3)
        expect(view.dispatch).toHaveBeenCalledWith({ selection: { anchor: 30 } })
      })

      it('does not dispatch when on the last line and computeSendSelection returns null', () => {
        const sendToTerminal = vi.fn()
        const { editorKeymaps } = mount({ sendToTerminal })
        const view = makeView({
          state: {
            doc: {
              lineAt: vi.fn(() => ({ number: 5, from: 50, to: 55 })),
              line: vi.fn(() => ({ from: 50, to: 55 })),
              lines: 5,
            },
            selection: { main: { head: 52 } },
          },
        })

        vi.mocked(computeSendSelection).mockReturnValue(null)

        const binding = getKeyBinding(editorKeymaps(), 'Mod-Enter')
        const result = binding.run(view)

        expect(result).toBe(true)
        expect(sendToTerminal).not.toHaveBeenCalled()
        expect(view.dispatch).not.toHaveBeenCalled()
      })
    })

    describe('markdown files', () => {
      it('calls computeChunkSend with line mode and sends if inside a chunk', () => {
        const sendToTerminal = vi.fn()
        const { editorKeymaps } = mount({ sendToTerminal, activeIsMarkdown: true })
        const view = makeView()

        vi.mocked(computeChunkSend).mockReturnValue({
          text: 'x <- 1',
          language: 'r',
          nextPos: 30,
        })

        const binding = getKeyBinding(editorKeymaps(), 'Mod-Enter')
        const result = binding.run(view)

        expect(result).toBe(true)
        expect(computeChunkSend).toHaveBeenCalledWith(view.state, 'line')
        expect(sendToTerminal).toHaveBeenCalledWith('x <- 1', 'r')
        expect(view.dispatch).toHaveBeenCalledWith({ selection: { anchor: 30 } })
      })

      it('returns false when computeChunkSend returns null (cursor in prose)', () => {
        const sendToTerminal = vi.fn()
        const { editorKeymaps } = mount({ sendToTerminal, activeIsMarkdown: true })
        const view = makeView()

        vi.mocked(computeChunkSend).mockReturnValue(null)

        const binding = getKeyBinding(editorKeymaps(), 'Mod-Enter')
        const result = binding.run(view)

        expect(result).toBe(false)
        expect(sendToTerminal).not.toHaveBeenCalled()
        expect(view.dispatch).not.toHaveBeenCalled()
      })
    })
  })

  // ================================================================
  // sendChunkCommand (Mod-Shift-Enter)
  // ================================================================
  describe('sendChunkCommand (Mod-Shift-Enter)', () => {
    it('returns false when not markdown and buffer is empty', () => {
      const sendToTerminal = vi.fn()
      vi.mocked(languageFromPath).mockReturnValue(null)
      vi.mocked(computeSourceCommand).mockReturnValue(null)
      const { editorKeymaps } = mount({ sendToTerminal, activeIsMarkdown: false })
      const view = makeView({
        state: {
          doc: {
            toString: () => '',
            lineAt: vi.fn(() => ({ number: 1, from: 0, to: 0 })),
            line: vi.fn(() => ({ from: 0, to: 0 })),
            lines: 1,
          },
          selection: { main: { head: 0 } },
        },
      })
      const binding = getKeyBinding(editorKeymaps(), 'Mod-Shift-Enter')
      expect(binding.run(view)).toBe(false)
    })

    it('returns false when historyPreviewActive', () => {
      const sendToTerminal = vi.fn()
      const { editorKeymaps } = mount({ sendToTerminal, activeIsMarkdown: true, historyPreviewActive: true })
      const binding = getKeyBinding(editorKeymaps(), 'Mod-Shift-Enter')
      expect(binding.run(makeView())).toBe(false)
    })

    it('returns false when read-only', () => {
      const sendToTerminal = vi.fn()
      const { editorKeymaps } = mount({ sendToTerminal, activeIsMarkdown: true, activeTabReadOnly: true })
      const binding = getKeyBinding(editorKeymaps(), 'Mod-Shift-Enter')
      expect(binding.run(makeView())).toBe(false)
    })

    it('returns false when sendToTerminal is undefined', () => {
      const result = useEditorFormatting({
        activeIsMarkdown: computed(() => true),
        activeTabReadOnly: computed(() => false),
        historyPreviewActive: computed(() => false),
        activeFilePath: computed(() => 'doc.Rmd'),
        getEditorView: () => makeView(),
        saveActiveFile: vi.fn(),
      })
      const binding = getKeyBinding(result.editorKeymaps(), 'Mod-Shift-Enter')
      expect(binding.run(makeView())).toBe(false)
    })

    it('returns false when computeChunkSend returns null', () => {
      const sendToTerminal = vi.fn()
      const { editorKeymaps } = mount({ sendToTerminal, activeIsMarkdown: true })
      vi.mocked(computeChunkSend).mockReturnValue(null)

      const binding = getKeyBinding(editorKeymaps(), 'Mod-Shift-Enter')
      expect(binding.run(makeView())).toBe(false)
      expect(sendToTerminal).not.toHaveBeenCalled()
    })

    it('sends the chunk and dispatches cursor advance when computeChunkSend returns a result', () => {
      const sendToTerminal = vi.fn()
      const { editorKeymaps } = mount({ sendToTerminal, activeIsMarkdown: true })
      const view = makeView()

      vi.mocked(computeChunkSend).mockReturnValue({
        text: 'library(ggplot2)\nggplot(df)',
        language: 'r',
        nextPos: 80,
      })

      const binding = getKeyBinding(editorKeymaps(), 'Mod-Shift-Enter')
      const result = binding.run(view)

      expect(result).toBe(true)
      expect(computeChunkSend).toHaveBeenCalledWith(view.state, 'chunk')
      expect(sendToTerminal).toHaveBeenCalledWith('library(ggplot2)\nggplot(df)', 'r')
      expect(view.dispatch).toHaveBeenCalledWith({ selection: { anchor: 80 } })
    })

    describe('non-markdown code files (source/run)', () => {
      it('R file: saves then sends source() expression', async () => {
        const sendToTerminal = vi.fn()
        const saveActiveFile = vi.fn(() => Promise.resolve(true))
        vi.mocked(languageFromPath).mockReturnValue('r')
        vi.mocked(computeSourceCommand).mockReturnValue("source('analysis/fit.R', echo = TRUE)")

        const { editorKeymaps } = mount({
          sendToTerminal,
          activeIsMarkdown: false,
          activeFilePath: 'analysis/fit.R',
          saveActiveFile,
        })

        const binding = getKeyBinding(editorKeymaps(), 'Mod-Shift-Enter')
        const result = binding.run(makeView())

        expect(result).toBe(true)
        expect(computeSourceCommand).toHaveBeenCalledWith('analysis/fit.R', 'r')

        // Wait for the async IIFE to complete
        await new Promise(r => setTimeout(r, 0))

        expect(saveActiveFile).toHaveBeenCalled()
        expect(sendToTerminal).toHaveBeenCalledWith("source('analysis/fit.R', echo = TRUE)", 'r')
      })

      it('R file with quote/space in path: escapes correctly in source command', async () => {
        const sendToTerminal = vi.fn()
        const saveActiveFile = vi.fn(() => Promise.resolve(true))
        vi.mocked(languageFromPath).mockReturnValue('r')
        vi.mocked(computeSourceCommand).mockReturnValue("source('it\\'s a file.R', echo = TRUE)")

        const { editorKeymaps } = mount({
          sendToTerminal,
          activeIsMarkdown: false,
          activeFilePath: "it's a file.R",
          saveActiveFile,
        })

        const binding = getKeyBinding(editorKeymaps(), 'Mod-Shift-Enter')
        binding.run(makeView())

        await new Promise(r => setTimeout(r, 0))

        expect(sendToTerminal).toHaveBeenCalledWith("source('it\\'s a file.R', echo = TRUE)", 'r')
      })

      it('R file: no send when save fails', async () => {
        const sendToTerminal = vi.fn()
        const saveActiveFile = vi.fn(() => Promise.resolve(false))
        vi.mocked(languageFromPath).mockReturnValue('r')
        vi.mocked(computeSourceCommand).mockReturnValue("source('script.R', echo = TRUE)")

        const { editorKeymaps } = mount({
          sendToTerminal,
          activeIsMarkdown: false,
          activeFilePath: 'script.R',
          saveActiveFile,
        })

        const binding = getKeyBinding(editorKeymaps(), 'Mod-Shift-Enter')
        binding.run(makeView())

        await new Promise(r => setTimeout(r, 0))

        expect(saveActiveFile).toHaveBeenCalled()
        expect(sendToTerminal).not.toHaveBeenCalled()
      })

      it('non-R code file: sends entire buffer text with its language', () => {
        const sendToTerminal = vi.fn()
        vi.mocked(languageFromPath).mockReturnValue('python')
        vi.mocked(computeSourceCommand).mockReturnValue(null)

        const { editorKeymaps } = mount({
          sendToTerminal,
          activeIsMarkdown: false,
          activeFilePath: 'main.py',
        })

        const view = makeView({
          state: {
            doc: {
              toString: () => 'print("hello")\nprint("world")',
              lineAt: vi.fn(() => ({ number: 1, from: 0, to: 5 })),
              line: vi.fn((n: number) => ({ from: n * 10, to: n * 10 + 5 })),
              lines: 2,
            },
            selection: { main: { head: 0 } },
          },
        })

        const binding = getKeyBinding(editorKeymaps(), 'Mod-Shift-Enter')
        const result = binding.run(view)

        expect(result).toBe(true)
        expect(sendToTerminal).toHaveBeenCalledWith('print("hello")\nprint("world")', 'python')
      })

      it('markdown chunk behavior remains unchanged', () => {
        const sendToTerminal = vi.fn()
        vi.mocked(computeChunkSend).mockReturnValue({
          text: 'x <- 1',
          language: 'r',
          nextPos: 30,
        })

        const { editorKeymaps } = mount({
          sendToTerminal,
          activeIsMarkdown: true,
          activeFilePath: 'doc.Rmd',
        })
        const view = makeView()

        const binding = getKeyBinding(editorKeymaps(), 'Mod-Shift-Enter')
        const result = binding.run(view)

        expect(result).toBe(true)
        expect(computeChunkSend).toHaveBeenCalledWith(view.state, 'chunk')
        expect(sendToTerminal).toHaveBeenCalledWith('x <- 1', 'r')
      })
    })
  })

  // ================================================================
  // Markdown format commands (markdownCommand wrapper)
  // ================================================================
  describe('markdown format commands', () => {
    it('returns false when historyPreviewActive', () => {
      const { editorKeymaps } = mount({ historyPreviewActive: true, activeIsMarkdown: true })
      const binding = getKeyBinding(editorKeymaps(), 'Mod-b')
      expect(binding.run(makeView())).toBe(false)
    })

    it('returns false when not markdown', () => {
      const { editorKeymaps } = mount({ activeIsMarkdown: false })
      const binding = getKeyBinding(editorKeymaps(), 'Mod-b')
      expect(binding.run(makeView())).toBe(false)
    })

    it('returns false when read-only', () => {
      const { editorKeymaps } = mount({ activeIsMarkdown: true, activeTabReadOnly: true })
      const binding = getKeyBinding(editorKeymaps(), 'Mod-b')
      expect(binding.run(makeView())).toBe(false)
    })

    it('calls toggleBold on Mod-b when markdown and editable', () => {
      const { editorKeymaps } = mount({ activeIsMarkdown: true })
      const view = makeView()
      const binding = getKeyBinding(editorKeymaps(), 'Mod-b')
      const result = binding.run(view)

      expect(result).toBe(true)
      expect(toggleBold).toHaveBeenCalledWith(view)
    })

    it('calls toggleItalic on Mod-i', () => {
      const { editorKeymaps } = mount({ activeIsMarkdown: true })
      const view = makeView()
      const binding = getKeyBinding(editorKeymaps(), 'Mod-i')
      binding.run(view)
      expect(toggleItalic).toHaveBeenCalledWith(view)
    })

    it('calls toggleStrikethrough on Mod-Shift-x', () => {
      const { editorKeymaps } = mount({ activeIsMarkdown: true })
      const view = makeView()
      const binding = getKeyBinding(editorKeymaps(), 'Mod-Shift-x')
      binding.run(view)
      expect(toggleStrikethrough).toHaveBeenCalledWith(view)
    })

    it('calls toggleBulletList on Mod-Shift-8', () => {
      const { editorKeymaps } = mount({ activeIsMarkdown: true })
      const view = makeView()
      const binding = getKeyBinding(editorKeymaps(), 'Mod-Shift-8')
      binding.run(view)
      expect(toggleBulletList).toHaveBeenCalledWith(view)
    })

    it('calls toggleNumberedList on Mod-Shift-7', () => {
      const { editorKeymaps } = mount({ activeIsMarkdown: true })
      const view = makeView()
      const binding = getKeyBinding(editorKeymaps(), 'Mod-Shift-7')
      binding.run(view)
      expect(toggleNumberedList).toHaveBeenCalledWith(view)
    })

    it('calls toggleBlockquote on Mod-Shift-.', () => {
      const { editorKeymaps } = mount({ activeIsMarkdown: true })
      const view = makeView()
      const binding = getKeyBinding(editorKeymaps(), 'Mod-Shift-.')
      binding.run(view)
      expect(toggleBlockquote).toHaveBeenCalledWith(view)
    })
  })

  // ================================================================
  // onFormat
  // ================================================================
  describe('onFormat', () => {
    it('no-ops when historyPreviewActive', () => {
      const { onFormat } = mount({ historyPreviewActive: true, activeIsMarkdown: true })
      onFormat('bold')
      expect(toggleBold).not.toHaveBeenCalled()
    })

    it('no-ops when read-only', () => {
      const { onFormat } = mount({ activeTabReadOnly: true, activeIsMarkdown: true })
      onFormat('bold')
      expect(toggleBold).not.toHaveBeenCalled()
    })

    it('no-ops when getEditorView returns null', () => {
      const result = useEditorFormatting({
        activeIsMarkdown: computed(() => true),
        activeTabReadOnly: computed(() => false),
        historyPreviewActive: computed(() => false),
        activeFilePath: computed(() => 'doc.md'),
        getEditorView: () => null,
        saveActiveFile: vi.fn(),
      })
      result.onFormat('bold')
      expect(toggleBold).not.toHaveBeenCalled()
    })

    it('focuses the editor view then dispatches the bold action', () => {
      const view = makeView()
      const result = useEditorFormatting({
        activeIsMarkdown: computed(() => true),
        activeTabReadOnly: computed(() => false),
        historyPreviewActive: computed(() => false),
        activeFilePath: computed(() => 'doc.md'),
        getEditorView: () => view,
        saveActiveFile: vi.fn(),
      })

      result.onFormat('bold')

      expect(view.focus).toHaveBeenCalled()
      expect(toggleBold).toHaveBeenCalledWith(view)
    })

    it('dispatches italic action', () => {
      const view = makeView()
      const result = useEditorFormatting({
        activeIsMarkdown: computed(() => true),
        activeTabReadOnly: computed(() => false),
        historyPreviewActive: computed(() => false),
        activeFilePath: computed(() => 'doc.md'),
        getEditorView: () => view,
        saveActiveFile: vi.fn(),
      })

      result.onFormat('italic')
      expect(toggleItalic).toHaveBeenCalledWith(view)
    })

    it('dispatches code action', () => {
      const view = makeView()
      const result = useEditorFormatting({
        activeIsMarkdown: computed(() => true),
        activeTabReadOnly: computed(() => false),
        historyPreviewActive: computed(() => false),
        activeFilePath: computed(() => 'doc.md'),
        getEditorView: () => view,
        saveActiveFile: vi.fn(),
      })

      result.onFormat('code')
      expect(toggleCode).toHaveBeenCalledWith(view)
    })

    it('dispatches strikethrough action', () => {
      const view = makeView()
      const result = useEditorFormatting({
        activeIsMarkdown: computed(() => true),
        activeTabReadOnly: computed(() => false),
        historyPreviewActive: computed(() => false),
        activeFilePath: computed(() => 'doc.md'),
        getEditorView: () => view,
        saveActiveFile: vi.fn(),
      })

      result.onFormat('strikethrough')
      expect(toggleStrikethrough).toHaveBeenCalledWith(view)
    })

    it('dispatches heading-1 action with level', () => {
      const view = makeView()
      const result = useEditorFormatting({
        activeIsMarkdown: computed(() => true),
        activeTabReadOnly: computed(() => false),
        historyPreviewActive: computed(() => false),
        activeFilePath: computed(() => 'doc.md'),
        getEditorView: () => view,
        saveActiveFile: vi.fn(),
      })

      result.onFormat('heading-1')
      expect(toggleHeading).toHaveBeenCalledWith(view, 1)
    })

    it('dispatches heading-2 action with level', () => {
      const view = makeView()
      const result = useEditorFormatting({
        activeIsMarkdown: computed(() => true),
        activeTabReadOnly: computed(() => false),
        historyPreviewActive: computed(() => false),
        activeFilePath: computed(() => 'doc.md'),
        getEditorView: () => view,
        saveActiveFile: vi.fn(),
      })

      result.onFormat('heading-2')
      expect(toggleHeading).toHaveBeenCalledWith(view, 2)
    })

    it('dispatches heading-3 action with level', () => {
      const view = makeView()
      const result = useEditorFormatting({
        activeIsMarkdown: computed(() => true),
        activeTabReadOnly: computed(() => false),
        historyPreviewActive: computed(() => false),
        activeFilePath: computed(() => 'doc.md'),
        getEditorView: () => view,
        saveActiveFile: vi.fn(),
      })

      result.onFormat('heading-3')
      expect(toggleHeading).toHaveBeenCalledWith(view, 3)
    })

    it('dispatches bullet-list action', () => {
      const view = makeView()
      const result = useEditorFormatting({
        activeIsMarkdown: computed(() => true),
        activeTabReadOnly: computed(() => false),
        historyPreviewActive: computed(() => false),
        activeFilePath: computed(() => 'doc.md'),
        getEditorView: () => view,
        saveActiveFile: vi.fn(),
      })

      result.onFormat('bullet-list')
      expect(toggleBulletList).toHaveBeenCalledWith(view)
    })

    it('dispatches numbered-list action', () => {
      const view = makeView()
      const result = useEditorFormatting({
        activeIsMarkdown: computed(() => true),
        activeTabReadOnly: computed(() => false),
        historyPreviewActive: computed(() => false),
        activeFilePath: computed(() => 'doc.md'),
        getEditorView: () => view,
        saveActiveFile: vi.fn(),
      })

      result.onFormat('numbered-list')
      expect(toggleNumberedList).toHaveBeenCalledWith(view)
    })

    it('dispatches checkbox action', () => {
      const view = makeView()
      const result = useEditorFormatting({
        activeIsMarkdown: computed(() => true),
        activeTabReadOnly: computed(() => false),
        historyPreviewActive: computed(() => false),
        activeFilePath: computed(() => 'doc.md'),
        getEditorView: () => view,
        saveActiveFile: vi.fn(),
      })

      result.onFormat('checkbox')
      expect(toggleCheckbox).toHaveBeenCalledWith(view)
    })

    it('dispatches blockquote action', () => {
      const view = makeView()
      const result = useEditorFormatting({
        activeIsMarkdown: computed(() => true),
        activeTabReadOnly: computed(() => false),
        historyPreviewActive: computed(() => false),
        activeFilePath: computed(() => 'doc.md'),
        getEditorView: () => view,
        saveActiveFile: vi.fn(),
      })

      result.onFormat('blockquote')
      expect(toggleBlockquote).toHaveBeenCalledWith(view)
    })

    it('dispatches link action', () => {
      const view = makeView()
      const result = useEditorFormatting({
        activeIsMarkdown: computed(() => true),
        activeTabReadOnly: computed(() => false),
        historyPreviewActive: computed(() => false),
        activeFilePath: computed(() => 'doc.md'),
        getEditorView: () => view,
        saveActiveFile: vi.fn(),
      })

      result.onFormat('link')
      expect(insertLink).toHaveBeenCalledWith(view)
    })

    it('dispatches image action', () => {
      const view = makeView()
      const result = useEditorFormatting({
        activeIsMarkdown: computed(() => true),
        activeTabReadOnly: computed(() => false),
        historyPreviewActive: computed(() => false),
        activeFilePath: computed(() => 'doc.md'),
        getEditorView: () => view,
        saveActiveFile: vi.fn(),
      })

      result.onFormat('image')
      expect(insertImage).toHaveBeenCalledWith(view)
    })

    it('dispatches horizontal-rule action', () => {
      const view = makeView()
      const result = useEditorFormatting({
        activeIsMarkdown: computed(() => true),
        activeTabReadOnly: computed(() => false),
        historyPreviewActive: computed(() => false),
        activeFilePath: computed(() => 'doc.md'),
        getEditorView: () => view,
        saveActiveFile: vi.fn(),
      })

      result.onFormat('horizontal-rule')
      expect(insertHorizontalRule).toHaveBeenCalledWith(view)
    })

    it('dispatches citation action for "cite"', () => {
      const view = makeView()
      const result = useEditorFormatting({
        activeIsMarkdown: computed(() => true),
        activeTabReadOnly: computed(() => false),
        historyPreviewActive: computed(() => false),
        activeFilePath: computed(() => 'doc.md'),
        getEditorView: () => view,
        saveActiveFile: vi.fn(),
      })

      result.onFormat('cite')
      expect(insertCitation).toHaveBeenCalledWith(view)
    })

    it('dispatches citation action for "citation"', () => {
      const view = makeView()
      const result = useEditorFormatting({
        activeIsMarkdown: computed(() => true),
        activeTabReadOnly: computed(() => false),
        historyPreviewActive: computed(() => false),
        activeFilePath: computed(() => 'doc.md'),
        getEditorView: () => view,
        saveActiveFile: vi.fn(),
      })

      result.onFormat('citation')
      expect(insertCitation).toHaveBeenCalledWith(view)
    })
  })

  // ================================================================
  // Mod-s (saveActiveFile)
  // ================================================================
  describe('Mod-s save binding', () => {
    it('calls saveActiveFile and returns true', () => {
      const saveActiveFile = vi.fn()
      const result = useEditorFormatting({
        activeIsMarkdown: computed(() => false),
        activeTabReadOnly: computed(() => false),
        historyPreviewActive: computed(() => false),
        activeFilePath: computed(() => 'script.R'),
        getEditorView: () => makeView(),
        saveActiveFile,
      })

      const binding = getKeyBinding(result.editorKeymaps(), 'Mod-s')
      expect(binding.run(makeView())).toBe(true)
      expect(saveActiveFile).toHaveBeenCalled()
    })
  })
})
