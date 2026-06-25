// Single source of truth for the Settings dialog's section protocol.
//
// The ids are a cross-file string contract — App.vue deep links
// (openSettings('apps')), ShellSidebar's Apps-header gear, and the settings
// test suites all pass them around as plain strings. Labels, order, and
// grouping are free to change; ids must stay stable. 'ai' keeps its historic
// id even though the label is now "AI & Models" (it was "Models", then "AI").

export type SettingsSection =
  | 'appearance'
  | 'ai'
  | 'instructions'
  | 'connections'
  | 'apps'
  | 'skills'
  | 'workspace'
  | 'about'

export interface SettingsNavItem {
  id: SettingsSection
  label: string
}

// Nav order: look-and-feel, then AI/services, then extensibility/workspace,
// then meta. Rendered with a divider between groups.
export const SETTINGS_NAV_GROUPS: SettingsNavItem[][] = [
  [
    { id: 'appearance', label: 'Appearance' },
  ],
  [
    { id: 'ai', label: 'AI & Models' },
    { id: 'instructions', label: 'Instructions' },
    { id: 'connections', label: 'Connections' },
  ],
  [
    { id: 'apps', label: 'Apps' },
    { id: 'skills', label: 'Skills' },
    { id: 'workspace', label: 'Workspace' },
  ],
  [
    { id: 'about', label: 'About' },
  ],
]

export const SETTINGS_NAV_ITEMS: SettingsNavItem[] = SETTINGS_NAV_GROUPS.flat()

// Where a bare "open settings" (footer gear, Cmd+,) lands. Deep links that
// intentionally target a section (chat's missing-key banner -> 'ai') pass it
// explicitly.
export const DEFAULT_SETTINGS_SECTION: SettingsSection = 'appearance'

export function settingsSectionLabel(id: SettingsSection): string {
  return SETTINGS_NAV_ITEMS.find(item => item.id === id)?.label ?? ''
}
