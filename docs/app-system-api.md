# App System API

Status: implemented core API.

This is the internal contract for the Mim app system. It describes how
apps are discovered, enabled, loaded, authorized, served, and executed. It
also documents the author-facing API for app UIs, backend jobs, AI tools,
and app-scoped data.

The goal is simple: an app should feel like normal JavaScript with a small
manifest, clear runtime identity, and predictable guardrails.

## Start Here

An app is an installable capability bundle. UI is optional.

Apps can contribute:

- Views: iframe UI served from the app `ui/` directory.
- Jobs: cancellable backend work with progress events and persisted run records. Ephemeral jobs skip the record.
- AI tools: app-owned tools that chat can call once the app is enabled.
- Skills: filesystem `skills/<name>/SKILL.md` instruction bundles under the app's own namespace (see [skills.md](skills.md)).
- Data: app-scoped JSON KV and collection storage.

The app system has five separate states:

| State | Meaning |
|---|---|
| Installed | The app exists on disk and has a valid `package.json` `mim` block. |
| Shared | The workspace declares the app in committed `mim.yaml` so collaborators can install the same app/version. |
| Enabled | The current user has added the app to this workspace's sidebar/capability set in local `.mim/packages/enabled.json`. |
| Loaded | The backend module has been imported and descriptors are available. |
| Active | A view, job, or tool call is currently using the runtime. |

Installed does not imply shared or enabled. Shared does not enable an app for
any collaborator. Enabled does not imply visible UI. Headless apps are
first-class.

## System Map

The core runtime is made of small, explicit pieces.

| Component | Source | Responsibility |
|---|---|---|
| App manifest | `src/main/packages/packageManifest.ts` | Validates `package.json.mim`, paths, ids, permissions. |
| App loader | `src/main/packages/packages.ts` | Discovers global and workspace apps; precedence workspace > global; two-level global layout; pinned-version selection. |
| Enablement store | `src/main/packages/packageEnablement.ts` | Personal enablement in local `.mim/packages/enabled.json`, wildcard trust ledger for vendored workspace apps, registry trust ledger. |
| Semver | `src/main/packages/semver.ts` | Minimal strict-semver validate + compare, no new dependency. |
| Registry index | `src/main/packages/registryIndex.ts` | Registry `index.json` parser/validator (manifestVersion 1, HTTPS-only repo URLs, optional repo-relative `path`, local `dir` entries behind `allowLocalDirs`). |
| Registry sources | `src/main/packages/registrySources.ts` | Multi-source resolution: ordered source list (workspace > machine > account > user > default), `readSourceIndex`, `lookupRegistryEntry` with ownership/anti-dependency-confusion rule. |
| Cache layout | `src/main/packages/cacheLayout.ts` | Mirror dirs under `~/.mim/cache/` (not Electron userData) for CLI parity. |
| User config | `src/main/userConfig.ts` | `registry.url` override for private registries. |
| App tools | `src/main/tools/coreApps.ts` | `app.status/enable/disable/remove/trust` — local sidebar enablement, workspace sharing removal, trust acknowledgement. |
| Registry tools | `src/main/tools/registryTools.ts` | `registry.list` — walk all configured sources, per-source status/stale fallback, enrich entries with install state and shadowing. `registry.trust` — ack trust for workspace-declared registries. |
| Install tools | `src/main/tools/install.ts` | `package.install/update/uninstall`, `app.add`, `app.share` — global layout, provenance, security checks, personal add, workspace share, local-dir installs with `file://` provenance. |
| App runtime | `src/main/packages/packageRuntime.ts` | Imports backend modules and builds app-scoped `ctx`. |
| Job runner | `src/main/packages/packageJobs.ts` | Starts, cancels, tracks, emits, and persists app job runs. |
| App data | `src/main/packages/packageData.ts` | Provides app-scoped JSON KV and collections. |
| Runtime tools | `src/main/tools/packageRuntime.ts` | Exposes app APIs through the tool registry. |
| App server | `src/main/server/server.ts` | Serves app UI and SDK, authenticates launch tokens, routes RPC. |
| Browser SDK | `sdk/mim.js` | UI-facing `runtime` object for app iframes. |
| Permission gate | `src/main/security/gate.ts` | Enforces manifest permissions and user approval policy. |

## Trust Model

App identity is injected by the runtime. App UI and backend code do not
get to choose their own app identity.

For UI apps:

1. Renderer asks main for a launch URL.
2. Main creates a short-lived launch token bound to `{ packageId, viewId }`.
3. The iframe loads `/packages/:id/.../index.html?launch=...`.
4. `sdk/mim.js` identifies over WebSocket with the launch token.
5. The server binds the socket to `package_id`.
6. Runtime RPC calls execute with `actor: "package"` and the authenticated
   `package_id`.

Launch tokens are short-lived and reusable while valid so iframe reloads and SDK
reconnects do not break the view. They are not an authorization model by
themselves. The permission gate still enforces app permissions on every
tool call.

Backend jobs and app AI tools receive a runtime context built from the
enabled app descriptor. They never receive caller-supplied app identity.

## Permissions

Permissions are declared in the manifest because the shell must know them before
loading app code.

```json
{
  "permissions": {
    "workspace": { "read": true, "write": false },
    "ai": false,
    "http": ["api.openalex.org", "*.crossref.org"],
    "secrets": []
  }
}
```

Current enforcement:

| Permission | Enforced behavior |
|---|---|
| `workspace.read` | Required for app file reads and file search. |
| `workspace.write` | Required for app file writes. |
| `ai` | Required for app use of AI-category tools. |
| `http` | Host allowlist for `ctx.http` requests. Exact host, `*.` subdomain wildcard, or `*` for any host. HTTPS only, default port only. |
| `secrets` | Names the keychain secrets reachable through `ctx.secrets` and the `package.secrets.*` tools. |

`ctx.ai`, `ctx.http`, and `ctx.secrets` follow the same consent model: the
manifest declaration is checked at call time, and enabling the app is the
user's consent. There is no per-call approval prompt (apps have no
interactive approval surface); every HTTP request is audited as
method + host + path + status (status 0 for failed or aborted requests) —
never headers, bodies, or query strings, and long path segments are redacted,
because all of those can carry tokens.

Apps cannot directly use:

- registry tools (`registry.list`, `registry.trust`).
- install and sharing tools (`package.install`, `package.update`, `package.uninstall`, `app.add`, `app.share`).
- trust acknowledgement (`app.trust`, `registry.trust`).
- enablement of other apps (`app.enable`/`app.disable` are scoped to the calling app's own id).
- app installation or scaffolding tools (`app.templateList`/`app.templateContent`/`package.create`/`package.edit`/`package.delete`).
- account token tools (`account.status`, `account.validate`, `account.setToken`, `account.clearToken`).
- workspace settings tools.
- provider key tools.
- terminal/system tools.
- chat session storage tools.
- chat session search.

All app tool calls still pass through the normal approval gate. For example,
an app with `workspace.write: true` may still prompt in strict mode before a
write happens.

## Manifest V1

Apps use normal `package.json` with a `mim` block.

```json
{
  "name": "@mim/stats-checker",
  "version": "0.1.0",
  "type": "module",
  "mim": {
    "manifestVersion": 1,
    "id": "stats-checker",
    "name": "Stats Checker",
    "description": "Statistical review tools for chat and data workflows.",
    "icon": "SC",
    "views": [
      { "id": "main", "label": "Stats", "src": "./ui/index.html", "role": "work" }
    ],
    "backend": "./backend/index.mjs",
    "permissions": {
      "workspace": { "read": true, "write": false },
      "ai": false
    },
    "engines": { "mim": "runtime-v1" }
  }
}
```

Fields:

| Field | Required | Notes |
|---|---:|---|
| `manifestVersion` | Yes | Must be `1`. |
| `id` | Yes | Lowercase letters, numbers, hyphens, underscores. Max 60 chars. |
| `name` | Yes | Human-facing app name. |
| `description` | No | Used in app lists and review UI. |
| `icon` | No | Navigator token. Either a short text token (commonly one or two letters, e.g. `"B"`), or an image asset path ending in `.svg`/`.png` placed under `ui/` (e.g. `"./ui/icon.svg"`). Image icons render as a theme-aware masked mark that inherits the nav-token color and follows the active grammar (ink-3 → accent) in both the expanded tray and the collapsed rail; text tokens render as-is. No `v-html` — image icons are served through `/packages/:id/<path>` and applied via a CSS mask, so app content never enters the privileged sidebar DOM as HTML. |
| `views` | No | Array. Empty means headless app. View files must live under `ui/`. |
| `views[].role` | Yes for views | `work`, `artifact`, or `either`. Work views open in the Work pane; Artifact views open only through explicit Artifact commands. |
| `backend` | No | Relative path to backend module. Must stay inside the app and exist. |
| `permissions` | No | Object. Missing means no declared permissions. |
| `provides.tools` | No | Named-tool grants — see "Named tools" below. String shorthand (`"issues.*"`) or `{ "name", "category", "risk" }`. |
| `dataFolder` | No | Single workspace-relative folder name (e.g. `"issues"`) the app stores data in. Created by `app.enable`; reported as `folderPresent` in `app.status`; never deleted by disable/remove. Reserved names (`packages`, `skills`, `node_modules`, `sessions`) are rejected. |
| `engines.mim` | No | Runtime marker. Current value: `runtime-v1`. |

Unknown keys inside `mim` fail validation unless they start with `x-`.
Normal `package.json` keys remain normal npm/package metadata.

### README.md convention

A `README.md` at the app root is auto-discovered (no manifest field). When
present, `hasReadme: true` is included in the loaded app data, and the app
surfaces a documentation door: a `?` icon next to the Work header title and a
"Documentation" link in Settings > Apps expanded detail. Both open the README
as a read-only text tab in the Artifact document pane via the `package.readme`
kernel tool. The AI can also call `package_readme` in chat to read app docs on
demand.

## App Locations

The loader scans two sources, in order of precedence (highest wins):

| Source | Location | Layout | Default enablement |
|---|---|---|---|
| Workspace | `{workspace}/packages/<id>/` | Flat (one level) | Never default-enabled |
| Global | `~/.mim/packages/<id>/<version>/` | Two-level (id dir -> version dirs) | Never default-enabled |

When an app id appears in more than one source, the higher-precedence copy
wins and the others are reported as shadow diagnostics (non-error, surfaces as
a "local override" badge in the UI). Within the global source, version
selection is: the active workspace's `mim.yaml` pin (if declared), else
highest by strict semver compare. Global version dir names must pass
`isValidSemver`; anything else is a diagnostic and skipped, including old flat
dirs (no migration).

### Global install layout

Registry installs land in `~/.mim/packages/<id>/<version>/` with a provenance
file at `~/.mim/packages/<id>/<version>/.mim-install.json`:

```json
{ "source": "https://...", "path": "packages/github-monitor", "ref": "v1.2.0", "commit": "<sha>", "installedAt": 1718000000000 }
```

No tokens in provenance. Install rejects source URLs carrying credentials.
Installs are side-by-side: updating to a newer version leaves older version
directories on disk until `package.uninstall` removes them. Update checks compare
the registry latest against the version selected for the active workspace
(workspace `mim.yaml` pin when that version is installed, otherwise highest
installed), so a newer side-by-side install does not hide a stale workspace pin.

### Multi-app repos (`path`)

A registry entry may declare an optional `path`: a repo-relative subdirectory
(validated, no "." or ".." segments) so one repo can host many apps. The
shoulders-ai/mim-apps monorepo works this way — one app per
`packages/<id>/`. When `path` is declared, install reads the manifest from,
scopes the symlink refusal to, and copies only that subdirectory; provenance
records `path`, and committed `mim.yaml` pins carry it so other machines
install from the same subdirectory.

### Mirror caches

Mirrors live under `~/.mim/cache/` (deliberately not Electron `userData`) so
the headless CLI shares them:

- Registry mirror: `~/.mim/cache/registry/<sha256(url)[0..12]>/repo`
- App mirrors: `~/.mim/cache/package-mirrors/<sha256(url)[0..12]>/repo`

## Enablement Model

The app system separates installation, workspace sharing, and personal sidebar
enablement.

### Shared workspace apps (mim.yaml)

The committed `mim.yaml` `apps:` map is keyed by **app id** (not app name —
the old `issues`/`knowledge` keys are dropped by the parser and resolve to
nothing). It declares apps that belong to the workspace and optionally pins how
to install them:

```yaml
apps:
  board: true                       # shared with the workspace, no install pin
  github-monitor:                   # shared app with install pin
    source: https://github.com/shoulders-ai/mim-apps
    path: packages/github-monitor
    version: 1.2.0
```

`mim.yaml` does **not** enable sidebar entries or app capabilities for every
collaborator. It is a shared availability/pinning layer: "this workspace uses
this app; install this version/source when needed."

Entry values are `boolean | { source?, path?, version?, enabled? }`. The
legacy `enabled` field is accepted for parser tolerance but is not an
activation switch. `path` is the repo-relative app subdirectory when the
source repo hosts many apps. When `mim.yaml` names apps that are not installed
on this machine, `MissingAppsBanner.vue` offers "Add all", installing by app
id/version through the registry/source lookup.

### Personal sidebar enablement (enabled.json)

Gitignored `.mim/packages/enabled.json` is the personal layer and trust ledger:

```json
{ "enabled": ["some-addon"], "disabled": ["docx-review"], "trusted": ["my-pkg@*"] }
```

`enabled` means "this user added the app to this workspace's sidebar/capability
set." `disabled` is a local negative override used by lower-level APIs. The
normal app-management flow removes a personal sidebar entry by clearing the
local override, so shared workspace apps remain visible in Settings without
being active.

### Resolution: "is app X active for this user"

1. Local `enabled.json` `enabled` list activates the app for the current user.
2. For workspace-source apps with a backend or effective permissions, the
   trust gate must also pass; a local enable does not execute untrusted
   vendored code.
3. Local `disabled` and the default state are inactive.

Committed `mim.yaml` entries never activate app code by themselves. A
committed-but-missing app is reported as `needsInstall` and `enabled: false`.

### Trust boundary

Local enablement must never execute cloned workspace code without local
consent. Workspace-source apps that declare a backend or any effective
permissions require a per-machine trust ack recorded in `enabled.json`:
`"id@*"`. Trust is binary and persists until the ledger entry is removed.
`app.trust` records the ack; it is hard-denied to `ai` and `package` actors.
The renderer calls it from the same plain-language permission confirmation
dialog used by registry Add.

### Freshness

The file watcher triggers package rescan on `mim.yaml` change, so shared app
pins and missing-install prompts update without workspace reopen. Local
enablement is read from `.mim/packages/enabled.json` and emitted through
`apps:changed` whenever app tools mutate it.

## Resolved App State

`app.status` returns the resolved state for every known app (loaded copies
plus committed-but-not-installed entries):

```typescript
interface AppStatus {
  id: string
  enabled: boolean
  layer: 'workspace' | 'local' | 'default' // workspace = shared in mim.yaml; local = personal-only
  installed: boolean
  installedVersions: string[]
  version?: string
  source?: string          // loader source or committed entry's declared source
  shadowed: boolean        // true when this loaded copy shadows duplicates of the same id from lower-ranked sources
  needsTrust: boolean      // vendored workspace app awaiting trust ack
  needsInstall: boolean    // committed entry with no installed copy
  folderPresent: boolean   // for apps with a registered data folder
}
```

## Backend Module API

Backend modules are ESM files. The runtime accepts plain object exports.

```js
export const jobs = {}
export const tools = {}
```

No helper library is required. Descriptor helper functions can be added later,
but v1 intentionally keeps app authoring close to normal JavaScript.

### Jobs

Jobs are cancellable units of backend work. They receive `ctx` and `input`.

```js
export const jobs = {
  inspectWorkspace: {
    label: 'Inspect workspace',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string' }
      }
    },
    concurrency: 'single',
    async run(ctx, input) {
      await ctx.progress.step('Listing files')
      const result = await ctx.tools.call('fs.list', {
        path: '.',
        recursive: true,
        pattern: input.pattern || '**/*',
        max_entries: 200
      })

      ctx.abort.throwIfAborted()

      const summary = {
        files: result.entries?.filter(entry => entry.type === 'file').length || 0,
        directories: result.entries?.filter(entry => entry.type === 'directory').length || 0
      }

      await ctx.data.collection('inspections').put(ctx.job.runId, summary)
      await ctx.progress.done('Workspace inspection complete')
      return summary
    }
  }
}
```

Job descriptor fields:

| Field | Required | Notes |
|---|---:|---|
| `label` | No | Defaults to job id. |
| `inputSchema` | No | JSON Schema object. |
| `concurrency` | No | Defaults to `single`. Use `parallel` to allow overlapping runs. |
| `ephemeral` | No | Defaults to `false`. Use `true` for internal housekeeping runs that leave no run record. |
| `run(ctx, input)` | Yes | May return any JSON-serializable result. |

Job lifecycle:

```txt
running -> completed
        -> failed
        -> cancelled
```

Events:

| Event | Emitted when |
|---|---|
| `job.started` | Run record is created. |
| `job.step` | `ctx.progress.step(name)` is called. |
| `job.log` | `ctx.progress.log(message)` is called. |
| `job.progress` | `ctx.progress.progress(value, label)` is called. |
| `job.done` | Job completes or `ctx.progress.done(summary)` is called. |
| `job.failed` | Job throws. |
| `job.cancelled` | Run is cancelled. |

Run records are persisted under:

```txt
{workspace}/.mim/packages/{packageId}/runs/{runId}.json
```

#### Ephemeral jobs

Mark a job `ephemeral: true` when it is internal housekeeping, such as a
background sync, whose feedback belongs inside the app UI rather than the
workspace record.

```js
export const jobs = {
  sync: {
    label: 'Sync',
    ephemeral: true,
    async run(ctx) {
      await ctx.progress.progress(0.5, 'Fetching')
      // ...
      await ctx.progress.done('Synced')
    }
  }
}
```

Ephemeral runs behave like normal runs while active, with three differences:

- No run record is written to `runs/`, so the run never appears in
  `package.jobs.list`, the Activity list, run history, or the archive.
- Every emitted job event carries `ephemeral: true`. App UIs still receive
  the events through `runtime.jobs.on(runId, cb)`; the app shell ignores them.
- `runtime.jobs.start()` does not open the run in Work, and `package.jobs.get`
  only resolves while the run is in flight. Once it finishes, the run is gone.

### AI Tools

App tools can be made available to chat.

```js
export const tools = {
  checkDataset: {
    label: 'Check dataset',
    description: 'Inspect a CSV for missing values and impossible numeric values.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' }
      },
      required: ['path']
    },
    audience: ['chat'],
    async execute(ctx, input) {
      const csv = await ctx.files.readWorkspaceText(input.path)
      return runChecks(csv)
    }
  }
}
```

Tool descriptor fields:

| Field | Required | Notes |
|---|---:|---|
| `label` | No | Defaults to tool id. |
| `description` | Yes | Used by the chat model. Write this like tool-use guidance. |
| `inputSchema` | No | JSON Schema object. Defaults to empty object schema. |
| `audience` | No | Defaults to `["chat"]`. A tool without the `chat` audience is omitted from the chat toolset **and refused at dispatch for AI callers** (including via `package.tools.execute`); it stays callable by the owning app's UI and the local user. Apps use `audience: ["ui"]` for human-only actions (approve, send). |
| `execute(ctx, input)` | Yes | Runs under app identity. |

The runtime validates tool input against the declared schema before calling
`execute`. Use native JSON values that match the schema; for example, array
fields must be arrays, not JSON-encoded strings.

Backend tool execution is serialized per app package. Two concurrent calls to
tools owned by the same app run one after the other, so `ctx.data` update
sequences cannot lose writes under multiple MCP callers. Different apps can
still run concurrently.

Public chat tool names are collision-safe by default:

```txt
pkg_<8-char app hash>__<toolId>
```

Example:

```txt
pkg_c97fd4d0__checkDataset
```

The model sees the public name. The app author writes the local id
`checkDataset`.

Tool results returned to the chat model (actor `ai`) are capped at 24,000
characters. App UIs, MCP clients, and the CLI receive results uncapped —
they consume structured data and must not get a truncation wrapper.

### Named tools

An app can register tools under stable dotted names instead of the hash-mangled
form, making them first-class ToolRegistry tools — callable by AI, app UIs
(`kernel.call`), other apps, and the CLI exactly like core tools.

Two declarations are required:

1. The manifest grants name patterns with a per-tool approval policy:

```json
"mim": {
  "provides": {
    "tools": [
      { "name": "issues.list", "category": "read", "risk": "low" },
      { "name": "issues.delete", "category": "write", "risk": "high" },
      "issues.*"
    ]
  }
}
```

2. The backend tool opts in with a `name` field matching a granted pattern:

```js
export const tools = {
  list: { name: 'issues.list', description: '...', async execute(ctx, input) { ... } }
}
```

Rules:

- Names are dotted lowercase, at least two segments. `*` is only valid as the
  entire final segment of a grant pattern.
- Categories `system`, `settings`, and `secrets` are core-only; declaring them
  coerces to `general` with a diagnostic. String-shorthand grants default to
  `general`/`medium`.
- **Risk floor**: a tool whose final segment is `delete`, `remove`, `purge`,
  `destroy`, `uninstall`, or `reset` is always at least risk `high`, whatever
  the manifest declares — including through wildcard grants.
- **Collisions**: core tool names can never be claimed. Between apps, the
  first enabled app wins; losers keep working under their mangled names and
  a diagnostic is recorded.
- Registration follows enablement: disable/remove unregisters on the next sync.
- A declared `name` that is invalid or not granted falls back to the mangled
  name with a diagnostic — the tool still works.
- In chat, dotted names appear with underscores (`issues.list` → `issues_list`).
  An app tool can never shadow a core chat tool.

### Agent context contribution

A backend may export an `agentContext` function. When the app is enabled, its
result is rendered as a section of `.mim/agent-context.md` (regenerated by
`workspace.orient` and on new chat sessions):

```js
export const agentContext = async (ctx) => {
  const items = ctx.data.collection('watches').list()
  return { title: 'GitHub monitor', body: `${items.length} repos watched.` }
}
```

Return a string (section titled with the app name) or `{ title, body }`.
Budgets are enforced by core: title 80 chars, body 1,500 chars, at most 8
sections across all apps, 3-second total timeout. Errors skip the section.

### Agents

A backend may export an `agents` object to mount specialised agents. Each key
becomes an agent scoped to the app's identity (`package:<packageId>/<key>`).

```js
export const agents = {
  referee: {
    name: 'Lancet Referee',
    icon: 'LR',
    model: 'claude-opus-4-8',
    tools: ['fs.read', 'search.files', 'stats.check'],
    skills: ['review-methods'],
    async instructions(ctx) {
      const prior = await ctx.data.collection('reviews').list()
      return `You are a statistics referee... {{WORKSPACE_TREE}}`
    }
  }
}
```

Agent id format: `package:<packageId>/<key>`.

Descriptor fields:

| Field | Required | Notes |
|---|---:|---|
| `instructions(ctx)` | Yes | Returns the system prompt string. See instructions context below. |
| `name` | No | Defaults to the object key. Sidebar label and session identity. |
| `icon` | No | Short text token, same rules as app icons. |
| `model` | No | Default model id. The user's model picker still wins. |
| `tools` | No | Canonical tool id allowlist. Present means scoped; absent means full chat tools. |
| `skills` | No | App skill names (not qualified ids) pre-activated each turn. |

Shape validation happens at parse time (`packageRuntime.ts`); semantic
validation (tool id resolution, model lookup, skill existence) happens at mount
time in `agentMounts.ts`.

#### Instructions context

`instructions(ctx)` receives a constrained `AgentInstructionsContext`, not the
full app runtime ctx. It is a read hook, not an execution hook.

| `ctx` field | Shape |
|---|---|
| `ctx.package` | `{ id, name, version, source }` |
| `ctx.data.kv` | `get(key)`, `keys()` — read-only |
| `ctx.data.collection(name)` | `get(id)`, `list()` — read-only |
| `ctx.files.readPackageText(path)` | Reads files inside the app directory |
| `ctx.abort` | `{ signal, aborted, throwIfAborted() }` |

Not available: `tools.call`, `http`, `secrets`, `ai`, workspace reads, writes.

The function runs under a 3-second budget (same as `agentContext`) and is
audited as an `agent.instructions` span under the turn trace. Failure or
timeout fails the turn with an error naming the app and agent — no silent
fallback prompt.

The returned string passes through `resolveTemplateVars` with the same
variables as `AGENTS.md` (`{{TOOL_SET}}`, `{{WORKSPACE_TREE}}`,
`{{SKILL_CATALOG}}`, `{{PROJECT_LOG}}`, etc.). The rule for richer context:
**compute at action time, read at prompt time** — the app's tools and jobs
(which run with full ctx, permissions, and audit) persist state into
`ctx.data`; `instructions` reads it back.

#### Tool allowlist

`tools` narrows: the visible set is the allowlist intersected with the
Settings > Tools policy. Omitted means the full chat tool set. The `skill`
activation tool is always present when the agent has skills; skill `unlocks`
gating still applies within the allowlist.

Entries must be canonical registry tool ids (core dotted names or the app's
own granted named tools). Unknown ids are load-time diagnostics, not silent
no-ops. An allowlisted tool that is missing at runtime (e.g. a disabled
dependency app) is a diagnostic and omitted. An agent can never see a tool
the user's policy disabled.

Settings > Apps shows the scope: "Full chat tools" vs "Scoped: N tools".

#### Trust

Agents are backend exports, and backends already require the workspace trust
ack — an installed prompt steers the AI as surely as code. App-mounted agents
run as actor `ai` through the normal permission gate. Agent sessions are
ordinary chat sessions carrying the app's identity.

#### Sessions

Agents run in the native chat surface. Sessions carry the agent id and show
the agent name and icon. History shows the app name, not "agent session".

### Skills

Backend modules do not export skills. App skills are filesystem skills:
`{package}/skills/<name>/SKILL.md` in the Anthropic Agent Skills format, loaded
only while the app is enabled. A legacy `export const skills` is ignored by
the runtime.

### App-shipped AI skills (SKILL.md)

Separate from backend-export skills, an enabled app can ship AI skills the
chat assistant activates by app-qualified id: put
`skills/<name>/SKILL.md` in the app, same format as authored skills.

The activation id is `package:<packageId>/<skillName>`. App skills are in a
separate namespace from authored skills, so an app skill does not shadow or get
shadowed by a Personal/Workspace skill with the same folder name. They appear in
Settings -> Apps ("Teaches the agent"), not Settings -> Skills.

The `unlocks:` frontmatter list names AI tools that stay hidden from the model
until the skill is activated (`tools:` remains informational). Dotted app tool
names are matched in their chat form, e.g. `unlocks: [issues_list]` or
`unlocks: [issues.list]` both gate the `issues.list` named tool.

## Runtime Context

Jobs and tools receive an app-scoped context.

```js
async function run(ctx, input) {}
async function execute(ctx, input) {}
```

Context fields:

| Field | Shape | Notes |
|---|---|---|
| `ctx.package` | `{ id, name, version, source }` | Injected from the enabled app. |
| `ctx.job` | `{ id, runId, startedAt } \| null` | Present for jobs, `null` for tools. |
| `ctx.inputs` | frozen object | Copy of job/tool inputs. |
| `ctx.data` | app data API | Scoped to this app id. |
| `ctx.files` | file helpers | App resource reads and workspace text reads. |
| `ctx.http` | HTTP API | Outbound HTTPS requests against the manifest host allowlist. |
| `ctx.secrets` | secret API | Keychain get/set/delete/has for manifest-declared secret names. |
| `ctx.ai` | AI helpers | Structured calls plus Anthropic/Gemini text/tool-loop calls through the main-process key resolver. |
| `ctx.documents` | document helpers | DOCX/PDF extraction plus DOCX read/comment/validate helpers routed through main-process tools. |
| `ctx.progress` | progress API | Emits normalized job events. |
| `ctx.audit` | audit API | Appends explicit app audit events. |
| `ctx.abort` | cancellation API | AbortSignal plus `throwIfAborted()`. |
| `ctx.tools` | tool registry bridge | Calls core tools with app actor and app id. |

### `ctx.files`

```js
await ctx.files.readPackageText('resources/template.md')
await ctx.files.readWorkspaceText('data/input.csv')
```

`readPackageText` reads files inside the app directory and rejects path
escapes. `readWorkspaceText` calls `fs.read` through the tool registry, so it
requires `workspace.read` and still goes through the approval gate.

### `ctx.http`

```js
const res = await ctx.http.request({
  url: 'https://api.github.com/orgs/acme/repos?per_page=100',
  headers: { Authorization: `token ${token}` },
})
const repos = await res.json()
```

Requests must be HTTPS on the default port, and the hostname must match the
manifest `http` allowlist (`api.github.com` exactly, or `*.github.com` for
subdomains only; `*` allows any host). The optional `method`, `headers`, and
`body` fields map to fetch. The job's abort signal is attached automatically
so cancelling a run cancels in-flight requests. Each request — including ones
that fail or abort in flight, which record status 0 — appends a
`package.http.request` audit event with method, host, path, and status. The
audit never includes headers, bodies, or query strings, and path segments
longer than 20 characters are replaced with `***` (paths can carry credentials
too: Telegram bot tokens, Slack webhook secrets, signed URLs).

The allowlist is checked on the request URL. It is declared intent and audit
for trusted apps, not a sandbox: backend modules run in the main process,
and redirects are not re-checked against the allowlist.

### `ctx.secrets`

```js
await ctx.secrets.set('github_token', 'ghp_...')
const token = await ctx.secrets.get('github_token')
const present = await ctx.secrets.has('github_token')
await ctx.secrets.delete('github_token')
```

Secrets live in the OS keychain (service `Mim`, account
`package:{packageId}:{name}`), never in app data or workspace files. Only
names declared in the manifest `secrets` list are reachable, and apps can
never read another app's secrets. Secret values are available only to
backend code; app UI manages secrets through `runtime.secrets`, which
never returns values.

### `ctx.ai`

```js
const result = await ctx.ai.generateObject({
  system: 'You return structured JSON.',
  prompt: 'Analyze this document.',
  schema: {
    type: 'object',
    properties: {
      summary: { type: 'string' }
    },
    required: ['summary']
  }
})
```

`generateObject` resolves provider keys in the main process and requires the
app manifest to declare `"ai": true`. It returns the generated object,
usage metadata, provider, and model id.

Apps that need old-style tool-loop agents can use the lower-level helpers:

```js
const review = await ctx.ai.callAnthropic({
  model: 'claude-sonnet-5',
  system: 'You must call submit_review.',
  messages: [{ role: 'user', content: 'Review this paper.' }],
  tools: [{
    name: 'submit_review',
    description: 'Submit comments.',
    input_schema: { type: 'object', properties: { comments: { type: 'array' } } },
    execute: async (input) => ({ accepted: input.comments?.length || 0 })
  }],
  maxSteps: 10
})

const gate = await ctx.ai.callGemini({
  model: 'gemini-3.1-flash-lite',
  system: 'Return JSON only.',
  messages: [{ role: 'user', content: 'Classify this document.' }]
})
```

### `ctx.documents`

```js
const extracted = await ctx.documents.docx.extract('manuscript.docx', { max_chars: 180000 })
const doc = await ctx.documents.docx.read('manuscript.docx', { max_chars: 180000 })
const worker = await ctx.documents.docx.workerStatus()
const pdf = await ctx.documents.pdf.extract('references/pdf/paper.pdf', { max_chars: 120000 })
const annotated = await ctx.documents.docx.annotate('manuscript.docx', [
  {
    type: 'add_comment',
    anchorText: 'exact text in the document',
    commentText: 'Review comment',
    author: 'Mim Review'
  }
], { output_path: 'manuscript_reviewed.docx' })
```

DOCX helpers route through `documents.docx.*` tools. PDF text extraction routes
through `documents.pdf.extract` and returns selectable text plus page count and
metadata when the PDF exposes it. Reads require `workspace.read`; annotation
requires `workspace.write`. The original DOCX is not modified.

### `ctx.data`

```js
await ctx.data.kv.set('settings', { threshold: 0.05 })
const settings = await ctx.data.kv.get('settings')
const keys = await ctx.data.kv.keys()
await ctx.data.kv.delete('settings')

const reports = ctx.data.collection('reports')
await reports.put('run-123', { ok: true })
const report = await reports.get('run-123')
const allReports = await reports.list()
await reports.delete('run-123')
```

Data storage lives under:

```txt
{workspace}/.mim/packages/{packageId}/data/
  kv/
  collections/
```

Keys, collection names, and record ids must match:

```txt
^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$
```

Writes use atomic JSON file replacement.

### `ctx.progress`

```js
await ctx.progress.step('Reading CSV')
await ctx.progress.log('Found 3 columns')
await ctx.progress.progress(0.5, 'Halfway')
await ctx.progress.done('Checks complete')
```

Progress events include `appId`, `jobId`, `runId`, timestamp, and sequence.

### `ctx.abort`

```js
if (ctx.abort.aborted) return
ctx.abort.throwIfAborted()
```

Long jobs should call `throwIfAborted()` between expensive steps.

### `ctx.tools.call`

```js
const files = await ctx.tools.call('fs.list', {
  path: '.',
  recursive: true,
  max_entries: 100
})
```

The runtime injects:

```js
{
  actor: 'package',
  package_id: ctx.package.id
}
```

The permission gate decides whether the call is allowed.

## Browser SDK

App UIs import the runtime SDK from the server.

```html
<script type="module">
  import { runtime } from '/sdk/mim.js'

  await runtime.ready
  console.log(runtime.package.id)
</script>
```

The SDK handles WebSocket connection, launch-token identification, reconnects,
request/response routing, and event listeners.

### SDK Reference

#### `runtime.ready`

Promise that resolves after the SDK has attempted launch-token identification.

```js
await runtime.ready
```

#### `runtime.package`

Current app identity.

```js
runtime.package.id
```

#### `runtime.jobs.start(jobId, inputs, options?)`

Starts an app-owned job. App UIs do not pass `packageId`; the server uses
the authenticated app identity. The default behavior is to open the new run
as Work after it starts; pass `{ openWork: false }` only for a deliberately
background job.

```js
const { runId } = await runtime.jobs.start('inspectWorkspace', {
  pattern: '**/*.md'
})
```

#### `runtime.jobs.cancel(runId)`

Cancels a running job.

```js
await runtime.jobs.cancel(runId)
```

#### `runtime.jobs.get(runId)`

Returns `{ run }`.

```js
const { run } = await runtime.jobs.get(runId)
```

#### `runtime.jobs.list()`

Lists runs for the current app.

```js
const { runs } = await runtime.jobs.list()
```

App run rename, archive, restore, and delete lifecycle tools exist at the
tool layer for Navigator and Archive UI. App UIs normally reopen concrete
runs with `runtime.workbench.openRun(runId)` and let the shell own rename,
archive, and delete affordances.

#### `runtime.jobs.on(runId, callback)`

Subscribes to events for one run. Returns an unsubscribe function.

```js
const off = runtime.jobs.on(runId, event => {
  console.log(event.type, event.data)
})

off()
```

#### `runtime.data.kv`

App-scoped key-value storage.

```js
await runtime.data.kv.set('viewState', { tab: 'runs' })
const state = await runtime.data.kv.get('viewState')
const keys = await runtime.data.kv.keys()
await runtime.data.kv.delete('viewState')
```

#### `runtime.data.collection(name)`

App-scoped record collection.

```js
const runs = runtime.data.collection('favorite-runs')
await runs.put('run-123', { pinned: true })
const record = await runs.get('run-123')
const records = await runs.list()
await runs.delete('run-123')
```

#### `runtime.tools.list()`

Lists enabled app tools available to chat.

```js
const tools = await runtime.tools.list()
```

#### `runtime.secrets.set(name, secret)`, `runtime.secrets.delete(name)`, and `runtime.secrets.status()`

Manage manifest-declared app secrets from app UI. Values go straight
to the OS keychain and are never returned to the iframe; `status()` reports
existence only. Backend code reads values through `ctx.secrets`.

```js
await runtime.secrets.set('github_token', tokenInput.value)
const secrets = await runtime.secrets.status() // [{ name: 'github_token', exists: true }]
await runtime.secrets.delete('github_token')
```

#### `runtime.workbench.openWork(viewId)`, `runtime.workbench.openRun(runId)`, and `runtime.workbench.openArtifact(viewId)`

Requests app-view navigation through the app Workbench. App UIs do not
pass `packageId`; the server uses the authenticated app identity and the
renderer applies the manifest view role before opening the view.

Starting an app job with `runtime.jobs.start()` opens the persisted run in
Work by default. Ephemeral jobs skip this because they have no run record. Use
`runtime.workbench.openRun(runId)` when an app UI needs to reopen a specific
run explicitly.

```js
await runtime.workbench.openWork('launch')
await runtime.workbench.openRun(runId)
await runtime.workbench.openArtifact('report')
```

#### `runtime.ai.registry()` and `runtime.ai.keyStatus()`

Returns the app model registry and provider key status for app UI controls.
These helpers do not expose API keys.

```js
const registry = await runtime.ai.registry()
const { statuses } = await runtime.ai.keyStatus()
```

#### `runtime.call(method, params)`

Low-level escape hatch for runtime RPC.

```js
await runtime.call('fs.read', { path: 'README.md' })
```

Use typed SDK helpers for jobs, data, tools, and Workbench navigation
whenever possible.

#### `runtime.on(event, callback)` and `runtime.off(event, callback)`

Subscribe to server events.

```js
function onWorkspaceChanged(event) {
  console.log(event.path)
}

runtime.on('workspace:changed', onWorkspaceChanged)
runtime.off('workspace:changed', onWorkspaceChanged)
```

#### Theme sync

The host injects the active theme's CSS custom properties into the iframe via `postMessage` on load and whenever the user switches themes. Apps that use `var(--color-*)` from `tokens.css` respond automatically. To react programmatically:

```js
runtime.on('theme:changed', (tokens) => {
  // tokens is a Record<string, string> of resolved CSS var values
  console.log(tokens['--color-accent'])
})
```

The `postMessage` only arrives after the iframe has loaded, so the first paint would otherwise use the light-theme defaults from `tokens.css`. To paint theme-correct from the first frame, the host also appends the same tokens to the launch URL as a `#mim-theme=<url-encoded JSON>` fragment. Apps that care about the first paint (anything with a static loading skeleton) should apply it with an inline script at the top of `<head>`:

```html
<script>
  try {
    const match = /mim-theme=([^&]+)/.exec(location.hash)
    if (match) {
      const tokens = JSON.parse(decodeURIComponent(match[1]))
      for (const [key, value] of Object.entries(tokens)) {
        document.documentElement.style.setProperty(key, value)
      }
    }
  } catch {}
</script>
```

## Enablement and Registry Tools

These are the tools for managing app enablement, trust, registry discovery,
and installation. Gate categories and actor restrictions are enforced in
`src/main/gate.ts`.

| Tool | Gate category | Actor restrictions | Behavior |
|---|---|---|---|
| `app.status` | `read` | none | Resolved state for every known app |
| `app.enable` | `settings` | app: own id only | Add an installed app to the current user's sidebar/capability set by writing local `.mim/packages/enabled.json`; explicit `layer: "workspace"` is rejected. Creates the registered data folder when needed |
| `app.disable` | `settings` | app: own id only | Remove an app from the current user's sidebar/capability set by clearing the local override; never touches data, install dirs, or workspace sharing |
| `app.remove` | `settings` | app: own id only | Remove workspace sharing by deleting the committed `mim.yaml` app pin. It keeps the local install, data folder, and any personal sidebar enablement |
| `app.trust` | `settings` (high) | **user-only** (hard-denied to ai and app) | Record trust ack for vendored workspace app |
| `app.templateList` / `app.templateContent` | `read` | denied to app actors | List and render workspace app starter templates as `package.create` params |
| `registry.list` | `network` (external) | denied to app actors | Walk all configured registry sources (workspace, machine, account, user, default), return `{ registries: [...per-source status], entries: [...enriched with registryId, shadowed, install state] }`. Per-source try/catch with stale-mirror fallback. Workspace sources gated on trust ack |
| `registry.trust` | `settings` (high) | **user-only** (hard-denied to ai and app) | Acknowledge trust for a workspace-declared registry source by id |
| `package.install` | `network` (external) | denied to app actors | Install by registry id or direct repo URL; commit/engines/id/permission verification; symlink/submodule/credential refusal; copies only the entry's `path` subdirectory when declared; archive entries verify `sha256:` hashes and authenticated account downloads pass `Bearer` auth; provenance write. For local-dir registry entries: skips git work and commit verification, provenance `source: file://...` |
| `app.add` | `network` (medium) | denied to app actors | Personal add: install from the registry if needed, then enable locally for the current user's sidebar. It does not write `mim.yaml` |
| `app.share` | `network` (medium) | denied to app actors | Workspace share: install/verify from the registry if needed, then write a committed `mim.yaml` pin (`source`, `path`, `version`). It does not enable anyone's sidebar and rejects local-dir sources |
| `package.update` | `network` (external) | denied to app actors | Install latest registry version side-by-side, repoint workspace pin if one exists |
| `package.uninstall` | `settings` | denied to app actors | Remove `~/.mim/packages/<id>/<version>/`; fix-forward (no refusal when enabled) |

AI may call registry and install tools with user approval ("install the github
monitor" in chat). `app.trust` and `registry.trust` are the only tools that
hard-deny the `ai` actor before any allow path.

### `registry.list` response shape

`registry.list` walks all configured sources and returns per-source status plus
enriched entries:

```ts
{
  registries: [{
    id: string,           // 'default' | 'user' | mim.yaml key | registries.json key
    kind: 'git' | 'local' | 'url',
    location: string,     // git HTTPS URL, absolute directory path, or index.json URL
    name?: string,
    origin: 'default' | 'user' | 'workspace' | 'machine' | 'account',
    status: 'ok' | 'stale' | 'error' | 'needs-trust',
    error?: string,
    diagnostics: string[]
  }],
  entries: [{
    ...RegistryEntry,     // id, name, description, repo?, archive?, hash?, path?, dir?, version, ref?, commit?, permissions, engines?
    registryId: string,   // which source this entry came from
    installedVersions: string[],
    enabledHere: boolean,
    permissionMismatch: boolean,
    shadowed?: boolean,
    shadowedBy?: string   // id of the owning source when shadowed
  }]
}
```

A failing git or url source serves its stale cache (`status: 'stale'`) or
reports `'error'` without breaking the others. Workspace sources that have not been
trusted report `status: 'needs-trust'` and contribute no entries.
Registries may contain multiple versions for the same app id; Settings > Apps
Browse collapses those to one row for the newest semver while keeping
`installedVersions` for update state.

### `registry.trust`

Acknowledges trust for a workspace-declared registry source. Params: `{ id }`.
Gate: `settings`/`high`, user-only (hard-denied to AI and app actors).
Machine-local, user, and default sources do not need trust acknowledgement.

### Local `dir` index entries

A local or path-source registry's `index.json` entries may use `dir` (a
registry-relative app directory) instead of `repo`/`ref`/`commit`. `dir`
entries are only accepted from sources where `allowLocalDirs` applies (local
and path sources; git registries reject them). Install runs the same content
checks but skips commit verification; provenance records
`source: file://<registry-location>`. `app.add` from a local source installs
and enables locally. `app.share` rejects local sources because a committed
`file://` workspace pin would break on other machines.

### `lookupRegistryEntry`

`lookupRegistryEntry(id, opts)` in `registrySources.ts` replaced the former
`lookupRegistryEntryFromMirror`. It walks sources in precedence order with
lazy clone, enforces the ownership rule (first trusted source claiming the id
owns it), and returns a `LookupResult` including `registryId`,
`registryKind`, `registryLocation`, and `localPackageDir` for local entries.

## Tool Registry API

These are main-process runtime tools. App UIs reach them through the SDK.
Chat and other internal surfaces reach them through `window.kernel.call()`.

| Tool | Caller | Result |
|---|---|---|
| `package.validate` | user/AI | `{ valid, errors, warnings, summary }` |
| `package.reload` | user/AI | `{ reloaded, packages, diagnostics }` |
| `package.capabilities.list` | any allowed caller | `{ packages }` |
| `package.tools.list` | chat/system/app UI | `{ tools }` |
| `package.tools.execute` | chat/system | app tool result |
| `package.jobs.start` | app UI/user/system | `{ runId, status }` |
| `package.jobs.cancel` | app UI/user/system | run record |
| `package.jobs.get` | app UI/user/system | `{ run }` |
| `package.jobs.list` | app UI/user/system | `{ runs }` |
| `package.jobs.rename` | app UI/user/system | `{ run }` |
| `package.jobs.archive` | app UI/user/system | `{ run }` |
| `package.jobs.restore` | app UI/user/system | `{ run }` |
| `package.jobs.delete` | app UI/user/system | `{ deleted }` |
| `workbench.openWork` | app UI/user/system | `{ opened, pane, kind, packageId, viewId? \| runId? }` |
| `workbench.openArtifact` | app UI/user/system | `{ opened, pane, packageId, viewId }` |
| `package.data.kv.get` | app UI | stored value or `null` |
| `package.data.kv.set` | app UI | `{ ok: true }` |
| `package.data.kv.delete` | app UI | `{ ok: true }` |
| `package.data.kv.keys` | app UI | `{ keys }` |
| `package.data.collection.list` | app UI | `{ records }` |
| `package.data.collection.get` | app UI | stored value or `null` |
| `package.data.collection.put` | app UI | `{ ok: true }` |
| `package.data.collection.delete` | app UI | `{ ok: true }` |
| `package.secrets.set` | app UI | `{ ok: true }` |
| `package.secrets.delete` | app UI | `{ ok: true }` |
| `package.secrets.status` | app UI | `{ secrets: [{ name, exists }] }` |

App data and secret tools require app identity. An app UI cannot
read or write another app's data by passing a different `packageId`, and
there is no tool that returns a secret value.

## Building An App

This section is the short, practical path.

For the user-facing "teach Mim a capability" workflow, start with
[custom-apps.md](custom-apps.md). This section is the lower-level app
contract path.

Agents should treat app authoring as teaching Mim a capability. Prefer
`app.templateList` and `app.templateContent` when a starter template fits.
`app.templateContent` returns `package.create` parameters with coupled package
ids, named-tool grants, backend code, bundled skills, and README text already
rewritten from the requested app id/name. For custom scaffolds, call
`package.create` directly, then run the dev loop:

```text
package.validate -> package.reload -> app.status/app.enable -> package.capabilities.list -> package.tools.execute or package.jobs.start
```

`app.trust` remains user-only. If a workspace app with a backend or
permissions needs trust, the agent must ask the user to review and trust it in
Settings -> Apps before enablement and testing can finish.

### 1. Create The App Directory

Workspace app:

```txt
{workspace}/packages/stats-checker/
  package.json
  backend/
    index.mjs
  ui/
    index.html
```

Headless app:

```txt
{workspace}/packages/stats-checker/
  package.json
  backend/
    index.mjs
```

`package.create` can create this headless shape directly by omitting `html` and
passing `backend`, `permissions`, `provides`, `skills`, and `readme` content in
one call.

### 2. Add A Manifest

```json
{
  "name": "@mim/stats-checker",
  "version": "0.1.0",
  "type": "module",
  "mim": {
    "manifestVersion": 1,
    "id": "stats-checker",
    "name": "Stats Checker",
    "description": "Statistical review tools.",
    "views": [],
    "backend": "./backend/index.mjs",
    "permissions": {
      "workspace": { "read": true, "write": false }
    },
    "engines": { "mim": "runtime-v1" }
  }
}
```

Use `views: []` for a headless app.

### 3. Add A Chat Tool

```js
export const tools = {
  summarizeFile: {
    label: 'Summarize file',
    description: 'Read a workspace text file and return a short structural summary.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' }
      },
      required: ['path']
    },
    async execute(ctx, input) {
      const text = await ctx.files.readWorkspaceText(input.path)
      return {
        path: input.path,
        characters: text.length,
        lines: text.split('\n').length
      }
    }
  }
}
```

Enable the app for the workspace. Chat will receive a public tool named like:

```txt
pkg_1a2b3c4d__summarizeFile
```

### 4. Add A Job

```js
export const jobs = {
  buildIndex: {
    label: 'Build index',
    concurrency: 'single',
    async run(ctx) {
      await ctx.progress.step('Listing markdown files')
      const listed = await ctx.tools.call('fs.list', {
        path: '.',
        recursive: true,
        pattern: '**/*.md',
        max_entries: 500
      })

      const files = listed.entries || []
      await ctx.data.collection('indexes').put(ctx.job.runId, {
        files: files.length,
        createdAt: new Date().toISOString()
      })

      return { files: files.length }
    }
  }
}
```

### 5. Add A UI

```html
<!doctype html>
<html>
  <body>
    <button id="run">Build index</button>
    <pre id="output"></pre>

    <script type="module">
      import { runtime } from '/sdk/mim.js'

      const output = document.querySelector('#output')
      const run = document.querySelector('#run')

      await runtime.ready

      run.addEventListener('click', async () => {
        const started = await runtime.jobs.start('buildIndex')
        output.textContent = `Started ${started.runId}`

        runtime.jobs.on(started.runId, event => {
          output.textContent += `\n${event.sequence}. ${event.type}`
        })
      })
    </script>
  </body>
</html>
```

Add the view to the manifest:

```json
{
  "views": [
    { "id": "main", "label": "Stats", "src": "./ui/index.html", "role": "work" }
  ]
}
```

### 6. Store App UI State

```js
await runtime.data.kv.set('filters', { status: 'failed' })
const filters = await runtime.data.kv.get('filters')
```

### 7. Add A Skill

Create `skills/review-methods/SKILL.md` inside the app, in the format
described in [skills.md](skills.md). Backend `export const skills` is ignored.

## Publishing

Apps are published through the
[mim-apps](https://github.com/shoulders-ai/mim-apps) repo. Bump
`version` in the app's `package.json` and push to `main` — CI regenerates
the registry `index.json` from every manifest and the current HEAD commit.
Apps hosted in other repos can be added via `external.json` in
mim-apps. On install, Mim verifies that manifest permissions exactly match
the registry declaration, checks commit integrity, and refuses symlinks and
submodules. See the mim-apps README for the full workflow.

## Diagnostics And Errors

App discovery returns diagnostics instead of crashing the shell.

Common manifest diagnostics:

| Diagnostic | Fix |
|---|---|
| `Missing package.json mim block` | Add `mim` to `package.json`. |
| `mim.manifestVersion must be 1` | Set `"manifestVersion": 1`. |
| `mim.id must be lowercase...` | Use a lowercase id with letters, numbers, `_`, or `-`. |
| `Unknown mim key: ...` | Remove the key or rename it to `x-...`. |
| `View file does not exist` | Create the file or fix `views[].src`. |
| `Backend file does not exist` | Create the backend file or fix `backend`. |

Common runtime errors:

| Error | Meaning |
|---|---|
| `Package not found: <id>` | The app is not installed or failed manifest validation. |
| `Package is disabled: <id>` | Enable the app before using jobs/tools. |
| `Package job not found: <id>.<job>` | Backend did not export that job. |
| `Job already running: <id>.<job>` | Default concurrency is `single`. |
| `Package data tools require package identity` | Data APIs must be called from app UI/runtime context. |
| `Permission denied: Package <id> did not declare workspace read permission` | Add manifest permission or remove the file read. |

## UX Rules

App APIs should be visible, reversible, and unsurprising.

- Enablement is explicit for workspace and global apps.
- Runtime errors should name the app, capability, and action.
- Long work should be a job, not a hidden UI request.
- Jobs should emit progress before and after expensive work.
- App tools should have clear `description` text because chat depends on it.
- App UI should prefer SDK helpers over `runtime.call()`.
- App data should store user-visible state and run artifacts, not secrets.

## Current Limits

The implemented core is designed for trusted or reviewed apps. Important
limits remain:

- Backend app modules run in the main process. True untrusted third-party
  apps need worker/process isolation. The `ctx.http` allowlist is declared
  intent and audit, not a sandbox; redirects are not re-checked.
- App tool settings are app-level today. Individual app-tool toggles
  should be added before a large app marketplace.

## Test Coverage

Primary tests:

| Area | Test file |
|---|---|
| Manifest validation | `src/main/packages/packageManifest.test.ts` |
| Enablement | `src/main/packages/packageEnablement.test.ts` |
| Package data | `src/main/packages/packageData.test.ts` |
| Runtime descriptors/context | `src/main/packages/packageRuntime.test.ts` |
| Job runner | `src/main/packages/packageJobs.test.ts` |
| Runtime tools | `src/main/tools/packageRuntime.test.ts` |
| Launch identity/server | `src/main/server/server.test.ts` |
| Permission enforcement | `src/main/security/gate.test.ts` |
| Chat tool integration | `src/main/ai/aiRuntime.test.ts`, `src/main/server/server-ai.test.ts` |
| Cross-repo app compatibility | `scripts/package-compat.test.ts` via `npm run test:packages:compat` |

Run:

```bash
npm run test
npm run build
```

When changing the app runtime contract, app manifests, backend exports, or
named app tools, also run:

```bash
MIM_PACKAGES_DIR=/path/to/mim-apps npm run test:packages:compat
```

The compatibility suite is intentionally outside the default test command. It
depends on a local `mim-apps` checkout and verifies that current external
apps load, enable, import, and register tools through the real Mim runtime.
When a staged app has a root `compat.mjs`, the suite also imports it and
runs `smoke({ tools, packageId, workspacePath, packageDir })`. Hooks should be
deterministic, local-only smoke workflows that exercise real app tools or
jobs without AI, network, secrets, or browser UI.
