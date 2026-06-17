// Single source of truth for the Settings dialog's section protocol.
//
// The ids are a cross-file string contract — App.vue deep links
// (openSettings('apps')), ShellSidebar's Apps-header gear, and the settings
// test suites all pass them around as plain strings. Labels, order, and
// grouping are free to change; ids must stay stable. 'ai' keeps its historic
// id even though the label is now "AI" (it was "Models").

export type SettingsSection = 'appearance' | 'editor' | 'ai' | 'apps' | 'agents' | 'skills' | 'resources' | 'storage' | 'about'

export interface SettingsNavItem {
  id: SettingsSection
  label: string
}

// Nav order: personal preferences first, workspace/domain concerns second,
// About last. Rendered with a divider between groups.
export const SETTINGS_NAV_GROUPS: SettingsNavItem[][] = [
  [
    { id: 'appearance', label: 'Appearance' },
    { id: 'editor', label: 'Editor' },
  ],
  [
    { id: 'ai', label: 'AI' },
    { id: 'storage', label: 'Storage' },
    { id: 'resources', label: 'Resources' },
    { id: 'apps', label: 'Apps' },
    { id: 'skills', label: 'Skills' },
    { id: 'agents', label: 'CLI tools' },
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
