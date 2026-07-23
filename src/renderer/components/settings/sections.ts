// Single source of truth for the Settings dialog's ownership-oriented
// navigation. Stable deep-link ids are retained for AI, Connections, Apps,
// Skills, and Tools.

export type SettingsSection =
  | 'general'
  | 'ai'
  | 'connections'
  | 'team'
  | 'project'
  | 'apps'
  | 'skills'
  | 'tools'

export interface SettingsNavItem {
  id: SettingsSection
  label: string
}

export interface SettingsNavGroup {
  label: 'YOU' | 'WORK' | 'ADVANCED'
  items: SettingsNavItem[]
}

export const SETTINGS_NAV_GROUPS: SettingsNavGroup[] = [
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
    items: [
      { id: 'tools', label: 'Tools' },
    ],
  },
]

export const SETTINGS_NAV_ITEMS: SettingsNavItem[] = SETTINGS_NAV_GROUPS.flatMap(group => group.items)
export const DEFAULT_SETTINGS_SECTION: SettingsSection = 'general'

export function settingsSectionLabel(id: SettingsSection): string {
  return SETTINGS_NAV_ITEMS.find(item => item.id === id)?.label ?? ''
}
