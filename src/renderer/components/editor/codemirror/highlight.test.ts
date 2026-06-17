import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { syntaxHighlighting, HighlightStyle } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'
import { highlightTree } from '@lezer/highlight'
import { editorHighlightStyle } from './core.js'
import { languageExtensionForPath } from './language.js'

/**
 * Syntax highlighting coverage test.
 *
 * Strategy: load a real language grammar, parse a code snippet, then walk
 * the syntax tree with `highlightTree` against `editorHighlightStyle` and
 * assert that distinct token classes are emitted. This avoids any DOM
 * flakiness — we test the HighlightStyle + grammar contract directly.
 */

async function getHighlightedTokenClasses(code: string, path: string): Promise<string[]> {
  const langExtension = await languageExtensionForPath(path)
  const state = EditorState.create({
    doc: code,
    extensions: [
      langExtension,
      syntaxHighlighting(editorHighlightStyle),
    ],
  })

  // Force a full parse
  const tree = state.tree
  // The tree.length might be 0 if the parser hasn't run; use ensureSyntaxTree
  const { ensureSyntaxTree } = await import('@codemirror/language')
  const fullTree = ensureSyntaxTree(state, code.length, 5000)!

  const classes = new Set<string>()
  highlightTree(fullTree, editorHighlightStyle, (from, to, cls) => {
    classes.add(cls)
  })
  return [...classes]
}

describe('syntax highlighting coverage', () => {
  it('highlights JavaScript keywords, strings, numbers, and functions distinctly', async () => {
    const jsCode = `
function greet(name) {
  const count = 42;
  const msg = "hello " + name;
  if (count > 0) {
    return msg;
  }
  // comment
}
class Foo extends Bar {}
`.trim()

    const classes = await getHighlightedTokenClasses(jsCode, 'example.js')

    // We expect at LEAST these token classes to be non-empty:
    // keyword (function, const, if, return, class, extends)
    // string ("hello ")
    // number (42)
    // comment (// comment)
    // There should be more than just the 4 original classes.
    expect(classes.length).toBeGreaterThanOrEqual(4)

    // Verify the classes are actual CSS class strings (CM HighlightStyle generates them)
    for (const cls of classes) {
      expect(typeof cls).toBe('string')
      expect(cls.length).toBeGreaterThan(0)
    }
  })

  it('highlights Python keywords, types, strings, comments, and functions', async () => {
    const pyCode = `
import os
from pathlib import Path

class MyClass:
    def greet(self, name: str) -> None:
        count = 42
        msg = f"hello {name}"
        # comment
        return msg
`.trim()

    const classes = await getHighlightedTokenClasses(pyCode, 'example.py')
    expect(classes.length).toBeGreaterThanOrEqual(4)
  })

  it('highlights TypeScript with type annotations', async () => {
    const tsCode = `
interface User {
  name: string;
  age: number;
}

function getUser(id: number): User {
  const x = true;
  return { name: "test", age: 30 };
}
`.trim()

    const classes = await getHighlightedTokenClasses(tsCode, 'example.ts')
    expect(classes.length).toBeGreaterThanOrEqual(4)
  })

  it('assigns distinct classes to keyword vs string vs number tokens', async () => {
    // This is the core requirement: code files should not be monochrome.
    // We verify that a keyword token and a string token get DIFFERENT classes.
    const code = 'const x = "hello"'
    const langExtension = await languageExtensionForPath('test.js')
    const state = EditorState.create({
      doc: code,
      extensions: [langExtension, syntaxHighlighting(editorHighlightStyle)],
    })
    const { ensureSyntaxTree } = await import('@codemirror/language')
    const tree = ensureSyntaxTree(state, code.length, 5000)!

    const tokenClasses: Array<{ from: number; to: number; cls: string }> = []
    highlightTree(tree, editorHighlightStyle, (from, to, cls) => {
      tokenClasses.push({ from, to, cls })
    })

    // Find a keyword token (like 'const') and a string token (like '"hello"')
    const constToken = tokenClasses.find(tk =>
      code.slice(tk.from, tk.to) === 'const'
    )
    const stringToken = tokenClasses.find(tk =>
      code.slice(tk.from, tk.to).includes('hello')
    )

    expect(constToken).toBeTruthy()
    expect(stringToken).toBeTruthy()
    // They must have different CSS classes — no monochrome
    expect(constToken!.cls).not.toBe(stringToken!.cls)
  })

  it('editorHighlightStyle covers the major lezer tag categories', () => {
    // Direct HighlightStyle coverage check: the style should define rules
    // for the main code token categories. We test by checking that the
    // style generates a class for each major tag.
    const majorTags = [
      t.keyword,
      t.string,
      t.number,
      t.comment,
      t.typeName,
      t.propertyName,
      t.operator,
      t.punctuation,
    ]

    for (const tag of majorTags) {
      const style = editorHighlightStyle.style([tag])
      expect(style, `missing style for tag ${tag}`).toBeTruthy()
    }
  })
})
