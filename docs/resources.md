# Shared Resource Collections

Mounted company libraries (templates, guidance, reference files) that humans, agents, and packages all access through normal workspace paths. Mim points at folders teams already maintain — it never becomes a second copy they have to keep in sync.

## Using it (for humans)

- **Add**: Settings → Resources → "Choose folder…" mounts a local folder (incl. OneDrive/Drive-synced folders) read-only in one step; or paste a git URL for a pull-only mirror. Click the badge on a collection's row to flip it between read-only and writable. A collection declared in `mim.yaml` but not yet bound on this machine shows its own "Choose folder…" action.
- **Use**: collections appear under a **Shared resources** section in the Files view (unavailable ones greyed out with their status), in search, and via `@` in chat. Agents read them like any workspace file.
- **Safety**: read-only collections can never be modified through Mim — by anyone. Writable ones go through the normal write-approval flow. Git collections are always read-only (pull-only mirrors). Work products belong in the workspace, not in collections.

## Model

A **collection** is a named pointer to a backing folder, mounted into the workspace as a symlink:

```text
<workspace>/.mim/resources/<id>  ->  backing root
```

Backing root by source kind:

- `local_folder` — the user's folder, referenced in place (no copy). Covers SharePoint/Drive/Dropbox via their desktop sync clients.
- `git_repo` — a pull-only mirror cloned once per machine into `<userData>/resources/<sha256(url)[0..12]>/repo`, shared across workspaces.

Because mounts are symlinks inside the workspace, all existing `fs.*` tools, the editor, search, and chat attachments work on collection files with ordinary workspace-relative paths (`.mim/resources/<id>/...`). No parallel file API exists. `resolveWorkspacePath` in `tools/fs.ts` is untouched: paths stay lexically inside the workspace.

## Configuration (two halves)

**Committed — `mim.yaml` `collections:`** (the team contract; parsed in `src/main/workspace/workspaceContract.ts`):

```yaml
collections:
  journal-guidance:           # id: kebab-case slug
    name: Journal guidance
    git: https://github.com/acme/guidance.git   # portable source
  templates:
    name: Company templates    # no git => expectation, satisfied per machine
    write: direct              # readonly (default) | direct; git is always readonly
```

**Machine-local — `.mim/resources.json`** (gitignored; never committed):

```json
{
  "collections": {
    "templates": { "path": "/Users/alice/OneDrive/Templates" },
    "my-notes": { "path": "/Users/alice/notes", "name": "My notes", "write": "direct" }
  }
}
```

Merge rules (in `src/main/resources/resourceModel.ts` → `resolveCollections`):

1. `mim.yaml` entry **with** `git` → `git_repo` collection. `write` is forced `readonly`.
2. `mim.yaml` entry **without** `git` → an *expectation*: each machine satisfies it with a binding of the same id. Unsatisfied → status `missing-binding`. Committed `write` wins over binding `write`.
3. Binding with no `mim.yaml` entry → personal `local_folder` collection (binding's `write`, default `readonly`).
4. Binding path that doesn't exist → status `missing-source`. Git mirror not yet cloned → `not-synced`. Otherwise `ok`.

Local-folder paths never go into `mim.yaml` (they don't travel between machines).

## Write policy (enforced in `src/main/security/gate.ts`)

`classifyPermissionPath` (`src/main/security/gate-paths.ts`) returns kind `resource` for any path under `.mim/resources/`, carrying the collection id. The gate then applies, **before** the user/system early-allow:

- `readonly` (or unknown collection): write-category tools are denied for **all actors**. This is the hard invariant.
- `direct`: user writes allowed; AI writes require approval ("Shared resource write"); developer mode bypasses as usual.
- The mount roots themselves (`.mim/resources`, `.mim/resources/<id>`) are protected from `fs.delete`/`fs.rename`/`fs.write` regardless of policy — mounts are managed only via `resources.*` tools.
- `fs.rename` checks `new_path` too, so files can't be moved *into* a read-only mount.

Reads are never gated by collection policy (they follow normal read rules).

## Tools (`tools/resources.ts`)

```text
resources.collections                       list with source, write policy, status, mount path
resources.add { id, name, git | path, write? }   git → mim.yaml entry; path → .mim/resources.json binding.
                                            A path with the id of a committed non-git entry binds that expectation.
resources.setPolicy { id, write }           flip readonly|direct in place (always rejected for git collections)
resources.remove { id }                     removes binding and/or mim.yaml entry, unlinks mount
resources.sync { id? }                      git clone/pull mirrors, refresh mounts, re-resolve status
resources.resolvePath { id }                mount path + backing root
```

Package rules: `resources.collections`/`resolvePath` need `workspace.read`; `add`/`setPolicy`/`remove`/`sync` are denied for packages. File reads inside mounts follow existing `fs.*` package rules.

## Integration map

| Concern | Where |
| --- | --- |
| Config schema | `src/main/workspace/workspaceContract.ts` (`collections:` is a known key — the serializer drops unknown keys, so it must stay declared there) |
| Model: merge, mounts, mirrors, sync | `src/main/resources/resourceModel.ts` (no Electron imports; mirrorsDir injected) |
| Enforcement | `src/main/security/gate.ts` + `src/main/security/gate-paths.ts` (kind `resource`) |
| Tools | `src/main/tools/resources.ts` |
| Search over mounts | `src/main/search/fileSearch.ts` (mount traversal; results tagged `collection`) |
| Wiring: mount sync on open, mirrorsDir, events | `src/main/index.ts` (`resources:changed` to renderer) |
| Agent orientation | `src/main/ai/agentContext.ts` renders a "Shared resources" section into `.mim/agent-context.md` on every `writeAgentContext` trigger (`workspace.open`, `session.create`, `workspace.orient`); the resource reader is bound at boot in `index.ts` via `setAgentContextResourceReader` |
| Settings UI | `src/renderer/components/settings/ResourcesSettingsPanel.vue` |
| Files tree + @-mentions | `src/renderer/components/files/` (`FilesWorkView.vue`, `FilesTable.vue`), `services/workspaceFileIndex.ts` |
| Approval note | `src/renderer/components/chat/approvalLogic.ts` (`approvalNote` for pathKind `resource`, surfaced by `InlineApproval.vue`) |

## Invariants worth keeping

- The source folder stays the source of truth; Mim stores only the symlink, mirrors, and index data.
- `.mim/` is gitignored, so mounts and bindings never leak into the repo; `mim.yaml` carries only portable pointers.
- Everything an agent can do to a collection goes through paths the gate can classify — there is no resource access path that bypasses `classifyPermissionPath`.
