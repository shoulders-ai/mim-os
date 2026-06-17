import { existsSync, readFileSync, readdirSync, rmSync } from 'fs'
import { join } from 'path'
import { isValidPackageId } from '@main/packages/packageManifest.js'
import { atomicWriteJson } from '@main/atomicJson.js'

export interface PackageDataApi {
  kv: {
    get(key: string): unknown | null
    set(key: string, value: unknown): void
    delete(key: string): void
    keys(): string[]
  }
  collection(name: string): PackageCollectionApi
}

export interface PackageCollectionApi {
  get(id: string): unknown | null
  put(id: string, value: unknown): void
  delete(id: string): void
  list(): Array<{ id: string; value: unknown }>
}

export function createPackageDataApi(workspacePath: string, packageId: string): PackageDataApi {
  if (!isValidPackageId(packageId)) throw new Error(`Invalid package id: ${packageId}`)
  const root = join(workspacePath, '.mim', 'packages', packageId, 'data')

  return {
    kv: {
      get(key) {
        return readJson(jsonPath(join(root, 'kv'), key))
      },
      set(key, value) {
        writeJsonAtomic(jsonPath(join(root, 'kv'), key), value)
      },
      delete(key) {
        removeJson(jsonPath(join(root, 'kv'), key))
      },
      keys() {
        return listJsonKeys(join(root, 'kv'))
      },
    },

    collection(name) {
      assertSafeName(name, 'collection')
      const dir = join(root, 'collections', name)
      return {
        get(id) {
          return readJson(jsonPath(dir, id))
        },
        put(id, value) {
          writeJsonAtomic(jsonPath(dir, id), value)
        },
        delete(id) {
          removeJson(jsonPath(dir, id))
        },
        list() {
          return listJsonKeys(dir).map(id => ({ id, value: readJson(jsonPath(dir, id)) }))
        },
      }
    },
  }
}

export function packageRunsDir(workspacePath: string, packageId: string): string {
  if (!isValidPackageId(packageId)) throw new Error(`Invalid package id: ${packageId}`)
  return join(workspacePath, '.mim', 'packages', packageId, 'runs')
}

function jsonPath(dir: string, key: string): string {
  assertSafeName(key, 'key')
  return join(dir, `${key}.json`)
}

function assertSafeName(value: string, label: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/.test(value)) {
    throw new Error(`Invalid package data ${label}: ${value}`)
  }
}

function readJson(path: string): unknown | null {
  if (!existsSync(path)) return null
  return JSON.parse(readFileSync(path, 'utf-8'))
}

function writeJsonAtomic(path: string, value: unknown): void {
  atomicWriteJson(path, value)
}

function removeJson(path: string): void {
  if (existsSync(path)) rmSync(path, { force: true })
}

function listJsonKeys(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter(name => name.endsWith('.json'))
    .map(name => name.slice(0, -5))
    .sort((a, b) => a.localeCompare(b))
}
