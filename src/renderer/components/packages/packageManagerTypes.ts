import type { PackageViewDefinition } from '../../services/workbench/packageViews.js'
import type { JobInputSchema } from './packageManagerLogic.js'

export interface PackagePermissions {
  workspace?: { read?: boolean; write?: boolean }
  ai?: boolean
  http?: string[]
  secrets?: string[]
}

export interface PackageSummary {
  id: string
  name: string
  icon?: string
  description?: string
  version?: string
  views?: PackageViewDefinition[]
  backend?: string
  permissions?: PackagePermissions
  enabled: boolean
  source: string
  hasReadme?: boolean
}

export interface PackageDiagnostic {
  path: string
  message: string
  packageId?: string
}

export type CapabilityInputSchema = JobInputSchema & Record<string, unknown>

export interface CapabilityJob {
  id: string
  label: string
  inputSchema?: CapabilityInputSchema
  concurrency: 'single' | 'parallel'
}

export interface CapabilityTool {
  name: string
  id: string
  packageId: string
  label: string
  description: string
  inputSchema: Record<string, unknown>
}

export interface CapabilitySkill {
  id: string
  label: string
}

export interface PackageCapabilities {
  packageId: string
  jobs: CapabilityJob[]
  tools: CapabilityTool[]
  skills?: CapabilitySkill[]
  diagnostics: string[]
}
