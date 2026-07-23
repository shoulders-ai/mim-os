// A Team connection changes several live catalogs at once. Keep their refresh
// order explicit so newly connected apps exist before their tools and routines
// resolve against the current tool surface.

export interface LiveTeamRefreshOptions {
  syncMount: () => void | Promise<void>
  rescanApps?: () => void | Promise<void>
  syncNamedTools?: () => void | Promise<void>
  refreshRoutines?: () => void | Promise<void>
  refreshSlack?: () => void | Promise<void>
  notifyRoutines?: () => void
}

export async function refreshLiveTeamContributions(
  options: LiveTeamRefreshOptions,
): Promise<void> {
  await options.syncMount()
  await options.rescanApps?.()
  await options.syncNamedTools?.()
  await options.refreshRoutines?.()
  await options.refreshSlack?.()
  options.notifyRoutines?.()
}
