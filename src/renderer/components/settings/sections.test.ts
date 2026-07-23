import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS_SECTION, SETTINGS_NAV_GROUPS } from './sections.js'

describe('Settings navigation', () => {
  it('uses the accepted YOU, WORK, and ADVANCED ownership structure', () => {
    expect(DEFAULT_SETTINGS_SECTION).toBe('general')
    expect(SETTINGS_NAV_GROUPS).toEqual([
      {
        label: 'YOU',
        items: [
          { id: 'general', label: 'General' },
          { id: 'ai', label: 'AI & Models' },
          { id: 'connections', label: 'Connections' },
        ],
      },
      {
        label: 'WORK',
        items: [
          { id: 'team', label: 'Team' },
          { id: 'project', label: 'Project' },
          { id: 'apps', label: 'Apps & agents' },
          { id: 'skills', label: 'Skills' },
        ],
      },
      {
        label: 'ADVANCED',
        items: [{ id: 'tools', label: 'Tools' }],
      },
    ])
  })
})
