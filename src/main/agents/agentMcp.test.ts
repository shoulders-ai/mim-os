import { describe, expect, it, vi } from 'vitest'
import { getAgentMcpSetup, checkMimMcpConfigured, addMimMcp, removeMimMcp } from './agentMcp.js'

describe('agentMcp', () => {
  describe('getAgentMcpSetup', () => {
    it('returns add/remove/list args for claude-code', () => {
      const setup = getAgentMcpSetup('claude-code')!
      expect(setup).toBeTruthy()
      expect(setup.addArgs).toEqual(['mcp', 'add', 'mim', '--', 'mim', 'mcp'])
      expect(setup.removeArgs).toEqual(['mcp', 'remove', 'mim'])
      expect(setup.listArgs).toEqual(['mcp', 'list'])
    })

    it('returns add/remove/list args for codex', () => {
      const setup = getAgentMcpSetup('codex')!
      expect(setup).toBeTruthy()
      expect(setup.addArgs).toEqual(['mcp', 'add', 'mim', '--', 'mim', 'mcp'])
      expect(setup.removeArgs).toEqual(['mcp', 'remove', 'mim'])
    })

    it('returns positional args for gemini-cli (no -- separator)', () => {
      const setup = getAgentMcpSetup('gemini-cli')!
      expect(setup).toBeTruthy()
      expect(setup.addArgs).toEqual(['mcp', 'add', 'mim', 'mim', 'mcp'])
      expect(setup.removeArgs).toEqual(['mcp', 'remove', 'mim'])
    })

    it('returns null for unknown agents', () => {
      expect(getAgentMcpSetup('cursor')).toBeNull()
    })
  })

  describe('checkMimMcpConfigured', () => {
    it('returns true when mim appears in mcp list output', async () => {
      const exec = vi.fn(async () => ({ stdout: '  mim: command=mim args=mcp (stdio)\n', stderr: '' }))
      expect(await checkMimMcpConfigured('/usr/bin/claude', ['mcp', 'list'], exec)).toBe(true)
    })

    it('returns false when mim does not appear in output', async () => {
      const exec = vi.fn(async () => ({ stdout: 'No MCP servers configured\n', stderr: '' }))
      expect(await checkMimMcpConfigured('/usr/bin/claude', ['mcp', 'list'], exec)).toBe(false)
    })

    it('returns false when the command fails', async () => {
      const exec = vi.fn(async () => { throw new Error('command not found') })
      expect(await checkMimMcpConfigured('/usr/bin/claude', ['mcp', 'list'], exec)).toBe(false)
    })

    it('does not match mim as a substring of another word', async () => {
      const exec = vi.fn(async () => ({ stdout: 'optimism: command=opt (stdio)\n', stderr: '' }))
      expect(await checkMimMcpConfigured('/usr/bin/claude', ['mcp', 'list'], exec)).toBe(false)
    })
  })

  describe('addMimMcp', () => {
    it('runs the agent binary with add args', async () => {
      const exec = vi.fn(async () => ({ stdout: 'Added mim\n', stderr: '' }))
      await addMimMcp('/usr/bin/claude', ['mcp', 'add', 'mim', '--', 'mim', 'mcp'], exec)
      expect(exec).toHaveBeenCalledWith('/usr/bin/claude', ['mcp', 'add', 'mim', '--', 'mim', 'mcp'])
    })

    it('throws when the command fails', async () => {
      const exec = vi.fn(async () => { throw new Error('permission denied') })
      await expect(addMimMcp('/usr/bin/claude', ['mcp', 'add', 'mim'], exec)).rejects.toThrow('permission denied')
    })
  })

  describe('removeMimMcp', () => {
    it('runs the agent binary with remove args', async () => {
      const exec = vi.fn(async () => ({ stdout: 'Removed mim\n', stderr: '' }))
      await removeMimMcp('/usr/bin/claude', ['mcp', 'remove', 'mim'], exec)
      expect(exec).toHaveBeenCalledWith('/usr/bin/claude', ['mcp', 'remove', 'mim'])
    })
  })
})
