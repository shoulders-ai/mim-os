import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { atomicWriteJson } from '@main/atomicJson.js'
import {
  parseMimYaml,
  serializeMimYaml,
  type MimSharedWorkspaceConfig,
} from './workspaceContract.js'

export type SharedWorkspaceConfigSource = 'folder-link' | 'mim-yaml'

export interface SharedWorkspaceConfigRead {
  config: MimSharedWorkspaceConfig
  source: SharedWorkspaceConfigSource
  path: string
}

export interface SharedWorkspaceFolderLinkOptions {
  now?: () => Date
}

interface SharedWorkspaceFolderLinkFile {
  version: 1
  linkedAt: string
  sharedWorkspace: MimSharedWorkspaceConfig
}

export function sharedWorkspaceFolderLinkPath(workspacePath: string): string {
  return join(workspacePath, '.mim', 'shared-workspace.json')
}

export function readSharedWorkspaceConfig(workspacePath: string): MimSharedWorkspaceConfig | null {
  return readSharedWorkspaceConfigWithSource(workspacePath)?.config ?? null
}

export function readSharedWorkspaceConfigWithSource(workspacePath: string): SharedWorkspaceConfigRead | null {
  const linkPath = sharedWorkspaceFolderLinkPath(workspacePath)
  const folderLink = readSharedWorkspaceFolderLink(workspacePath)
  if (folderLink) {
    return {
      config: folderLink,
      source: 'folder-link',
      path: linkPath,
    }
  }

  const mimYamlPath = join(workspacePath, 'mim.yaml')
  if (!existsSync(mimYamlPath)) return null
  try {
    const config = parseMimYaml(readFileSync(mimYamlPath, 'utf-8')).sharedWorkspace ?? null
    return config
      ? {
          config,
          source: 'mim-yaml',
          path: mimYamlPath,
        }
      : null
  } catch {
    return null
  }
}

export function readSharedWorkspaceFolderLink(workspacePath: string): MimSharedWorkspaceConfig | null {
  const path = sharedWorkspaceFolderLinkPath(workspacePath)
  if (!existsSync(path)) return null
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const source = parsed as Record<string, unknown>
    return normalizeSharedWorkspaceConfig(source.sharedWorkspace)
  } catch {
    return null
  }
}

export function writeSharedWorkspaceFolderLink(
  workspacePath: string,
  sharedWorkspace: MimSharedWorkspaceConfig,
  options: SharedWorkspaceFolderLinkOptions = {},
): MimSharedWorkspaceConfig {
  const normalized = normalizeSharedWorkspaceConfig(sharedWorkspace)
  if (!normalized) throw new Error('Invalid shared workspace folder link')
  const file: SharedWorkspaceFolderLinkFile = {
    version: 1,
    linkedAt: (options.now?.() ?? new Date()).toISOString(),
    sharedWorkspace: normalized,
  }
  atomicWriteJson(sharedWorkspaceFolderLinkPath(workspacePath), file)
  return normalized
}

export function normalizeSharedWorkspaceConfig(raw: unknown): MimSharedWorkspaceConfig | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const source = raw as Record<string, unknown>
  const candidate: MimSharedWorkspaceConfig = {
    id: typeof source.id === 'string' ? source.id : '',
    url: typeof source.url === 'string' ? source.url : '',
    namespaces: Array.isArray(source.namespaces)
      ? source.namespaces.filter((item): item is string => typeof item === 'string')
      : [],
    ...(typeof source.name === 'string' ? { name: source.name } : {}),
  }
  return parseMimYaml(serializeMimYaml({ name: 'x', sharedWorkspace: candidate })).sharedWorkspace ?? null
}
