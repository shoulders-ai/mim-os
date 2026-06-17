import { describe, expect, it } from 'vitest'
import {
  buildAtItems,
  canSendMessage,
  filterAtItems,
  getAtMentionState,
  groupAtItems,
  modelSupportsVision,
  removeAtMention,
  upsertContextChip,
} from './composerLogic.js'

describe('composer send eligibility', () => {
  it('allows sending when enabled and text has non-whitespace content', () => {
    expect(canSendMessage({
      canSend: true,
      busy: false,
      draft: '  hello  ',
      attachments: [],
      contextChips: [],
      showAtDropdown: false,
    })).toBe(true)
  })

  it('allows sending with attachments or context chips when text is empty', () => {
    expect(canSendMessage({
      canSend: true,
      busy: false,
      draft: '',
      attachments: [{ filename: 'notes.md' }],
      contextChips: [],
      showAtDropdown: false,
    })).toBe(true)

    expect(canSendMessage({
      canSend: true,
      busy: false,
      draft: '   ',
      attachments: [],
      contextChips: [{ type: 'skill', id: 'web-search' }],
      showAtDropdown: false,
    })).toBe(true)
  })

  it('blocks sending while busy, externally disabled, component-disabled, empty, or selecting an @ item', () => {
    const base = {
      canSend: true,
      disabled: false,
      busy: false,
      draft: 'hello',
      attachments: [],
      contextChips: [],
      showAtDropdown: false,
    }

    expect(canSendMessage({ ...base, busy: true })).toBe(false)
    expect(canSendMessage({ ...base, canSend: false })).toBe(false)
    expect(canSendMessage({ ...base, disabled: true })).toBe(false)
    expect(canSendMessage({ ...base, draft: '   ' })).toBe(false)
    expect(canSendMessage({ ...base, showAtDropdown: true })).toBe(false)
  })
})

describe('composer @ mention logic', () => {
  it('builds dynamic @ items from composer context sources', () => {
    const items = buildAtItems({
      skills: [{ id: 'review', name: 'Review', description: 'Review changes' }],
      projectFiles: [{ path: 'docs/plan.md', mediaType: 'text/markdown' }],
      packageTools: [{ name: 'citations.find', description: 'Find citations', packageName: 'Knowledge' }],
      hasDocument: true,
      documentName: 'Draft.md',
    })

    expect(items.map(item => `${item.group}:${item.type}:${item.label}`)).toEqual([
      'Skills:skill:Review',
      'Document:document:Draft.md',
      'Files:project-file:plan.md',
      'Tools:package-tool:citations.find',
    ])
    expect(items.find(item => item.type === 'project-file')).toMatchObject({
      id: 'docs/plan.md',
      path: 'docs/plan.md',
      mediaType: 'text/markdown',
    })
  })

  it('groups @ items by display section while preserving order', () => {
    const groups = groupAtItems([
      { type: 'skill', id: 'a', label: 'A', group: 'Skills' },
      { type: 'project-file', id: 'b', label: 'B', group: 'Files' },
      { type: 'project-file', id: 'c', label: 'C', group: 'Files' },
    ])

    expect(groups).toEqual([
      { label: 'Skills', items: [{ type: 'skill', id: 'a', label: 'A', group: 'Skills' }] },
      {
        label: 'Files',
        items: [
          { type: 'project-file', id: 'b', label: 'B', group: 'Files' },
          { type: 'project-file', id: 'c', label: 'C', group: 'Files' },
        ],
      },
    ])
  })

  it('detects @ at the start of a message and after whitespace', () => {
    expect(getAtMentionState('@test', 5)).toEqual({
      active: true,
      query: 'test',
      atIndex: 0,
    })

    expect(getAtMentionState('hello @test', 11)).toEqual({
      active: true,
      query: 'test',
      atIndex: 6,
    })
  })

  it('does not activate @ mentions embedded in a word or followed by whitespace', () => {
    expect(getAtMentionState('hello@test', 10)).toMatchObject({
      active: false,
      query: '',
    })

    expect(getAtMentionState('@hello world', 12)).toMatchObject({
      active: false,
      query: '',
    })
  })

  it('filters @ items by label or description', () => {
    const items = buildAtItems({
      skills: [
        { id: 'issue-work', name: 'issue-work', description: 'Plan and triage Mim issues' },
        { id: 'docx-review', name: 'docx-review', description: 'Peer review DOCX manuscripts' },
      ],
    })
    expect(filterAtItems('', true, items)).toHaveLength(items.length)
    expect(filterAtItems('triage', true, items).map(item => item.id)).toEqual(['issue-work'])
    expect(filterAtItems('docx', true, items).map(item => item.id)).toEqual(['docx-review'])
    expect(filterAtItems('triage', false, items)).toEqual([])
  })

  it('filters dynamic @ items by path and package name', () => {
    const items = buildAtItems({
      projectFiles: [{ path: 'src/renderer/App.vue' }],
      packageTools: [{ name: 'lookup', packageName: 'Knowledge Base' }],
    })

    expect(filterAtItems('renderer', true, items).map(item => item.id)).toEqual(['src/renderer/App.vue'])
    expect(filterAtItems('knowledge', true, items).map(item => item.id)).toEqual(['lookup'])
  })

  it('removes the active @ query while preserving surrounding text', () => {
    expect(removeAtMention('before @alp after', 11)).toEqual({
      text: 'before  after',
      cursorPos: 7,
      removed: true,
    })
  })

  it('deduplicates context chips and allows multiple skill chips', () => {
    const first = upsertContextChip([], { type: 'skill', id: 'web-search', label: 'Web Search' })
    expect(first).toEqual([{ type: 'skill', id: 'web-search', label: 'Web Search' }])

    const twoSkills = upsertContextChip(first, { type: 'skill', id: 'code-review', label: 'Code Review' })
    expect(twoSkills).toEqual([
      { type: 'skill', id: 'web-search', label: 'Web Search' },
      { type: 'skill', id: 'code-review', label: 'Code Review' },
    ])
    expect(upsertContextChip(twoSkills, { type: 'skill', id: 'web-search', label: 'Web Search' })).toHaveLength(2)

    const oneFile = upsertContextChip([], { type: 'file', id: 'readme', label: 'README.md' })
    expect(upsertContextChip(oneFile, { type: 'file', id: 'readme', label: 'README.md' })).toHaveLength(1)
    expect(upsertContextChip(oneFile, { type: 'file', id: 'package', label: 'package.json' })).toEqual([
      { type: 'file', id: 'readme', label: 'README.md' },
      { type: 'file', id: 'package', label: 'package.json' },
    ])
  })

  it('preserves file metadata on context chips', () => {
    const chips = upsertContextChip([], {
      type: 'project-file',
      id: 'docs/plan.md',
      label: 'plan.md',
      path: 'docs/plan.md',
      mediaType: 'text/markdown',
    })

    expect(chips).toEqual([{
      type: 'project-file',
      id: 'docs/plan.md',
      label: 'plan.md',
      path: 'docs/plan.md',
      mediaType: 'text/markdown',
    }])
  })
})

describe('composer model capability logic', () => {
  it('detects model vision support from capabilities', () => {
    expect(modelSupportsVision({ capabilities: { vision: true } })).toBe(true)
    expect(modelSupportsVision({ capabilities: { vision: false } })).toBe(false)
    expect(modelSupportsVision(null)).toBe(false)
  })
})
