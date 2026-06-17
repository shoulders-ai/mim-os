import type { PackageViewDefinition } from '../workbench/packageViews.js'

export interface LoadedPackage {
  manifest: {
    id: string
    name: string
    icon?: string
    description?: string
    views?: PackageViewDefinition[]
  }
  dir: string
  source: string
  hasReadme?: boolean
}
