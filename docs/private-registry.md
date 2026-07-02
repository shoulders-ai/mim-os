# Private Registry

The private registry delivers proprietary or personal apps to authenticated
Mim clients. It runs alongside the public `mim-apps` registry, which anyone
can access without credentials.

This document covers the developer/operator workflow. For the app authoring
API itself (manifests, tools, skills, backend), see
[custom-apps.md](custom-apps.md) and [app-system-api.md](app-system-api.md).


## Architecture

```
mim-web (Nuxt, mim.shoulde.rs)
  packages/<id>/                   Source app directories
  scripts/build-packages.js        Tarball builder + SQLite upsert
  server/api/v1/registry/          REST API (Bearer-authenticated)
    index.get.js                   GET /api/v1/registry — filtered package list
    packages/[id]/[version].get.js GET — tarball download
    validate.post.js               POST — token validation

mim-os (Electron)
  registrySources.ts               Multi-source registry resolution
  tools/account.ts                 account.setToken / account.clearToken
  tools/install.ts                 Archive download + hash verification
```

The registry is a dynamic API, not a static `index.json`. Each client gets a
response filtered to only the packages they are entitled to.


## Source Precedence

`registrySources()` builds an ordered list. The first source whose index
contains a package ID **owns** that ID — lower sources cannot supply it (the
ownership rule prevents dependency confusion):

1. **Workspace** — `mim.yaml` `registries:` entries (require trust).
2. **Machine** — `.mim/registries.json` (local folder or HTTPS URL).
3. **Account** — `mim.shoulde.rs/api/v1/registry`, present only when
   `MIM_ACCOUNT_TOKEN` exists in `~/.mim/keys.env`.
4. **Default** — public `mim-apps` index on GitHub.


## How To Add A Private App

All private apps live in `mim-web/packages/<id>/`. The structure is identical
to public apps — a directory with `package.json` containing a `mim` manifest,
plus optional `backend/`, `ui/`, and `skills/` subdirectories.

1. Create the app under `mim-web/packages/<id>/`.
2. Write the `package.json` with a valid `mim` manifest.
3. Add backend, skills, UI as needed (same contract as workspace/public apps).
4. Commit and push to `main`.

The CI pipeline (`.github/workflows/deploy.yml`) handles the rest:
rsyncs to the VPS, runs `scripts/build-packages.js` (tarballs each package
into `data/packages/<id>-<version>.tar.gz`, computes SHA-256, upserts into
SQLite), and restarts the service.


## Client Management

The admin panel at `mim.shoulde.rs/admin/` manages clients and entitlements.

- **Create client** — generates a one-time bearer token. The token is shown
  once; only its SHA-256 hash is stored.
- **Entitlements** — per-client checkbox list of which package IDs the client
  can see and install.
- **Last seen** — the registry middleware updates `updated_at` on every
  authenticated request.

Login uses `NUXT_ADMIN_KEY` (env var) with a 24-hour HMAC-signed session
cookie.


## Client Setup (User Side)

A user who receives a token runs:

```bash
mim tool account.setToken '{"token":"<token>"}' --yes
```

Or sets `MIM_ACCOUNT_TOKEN=<token>` in `~/.mim/keys.env` directly.

Once set, `registry.list` includes private packages the client is entitled to.
`app.add` or `package.install` downloads and verifies the tarball.

To verify the token:

```bash
mim tool account.validate '{}' --json
```


## Versioning And Updates

Bump the `version` in the app's `package.json`, push, and the build script
upserts a new `(id, version)` row. The registry API returns the latest
version per package. The mim-os update checker (`updateCheck.ts`) detects
version mismatches for installed account packages.


## Local Development

Set `MIM_ACCOUNT_REGISTRY_URL=http://localhost:3000/api/v1/registry` in the
environment (or use `setAccountRegistryDev(true)` in code) to point at a local
mim-web dev server instead of production.


## What Goes Here vs. mim-apps

| Criterion | mim-apps (public) | mim-web (private) |
|---|---|---|
| Access | Open GitHub URL, no auth | Bearer token, per-client entitlements |
| Use case | Shared apps for all Mim users | Proprietary, personal, or client-specific apps |
| Install format | Git clone with ref/commit pin | `.tar.gz` archive with SHA-256 hash |
| Index | Static `index.json` in repo | Dynamic API filtered by entitlements |


## Existing Private Apps

- **test-private** — canary package that validates the pipeline end to end.
- **granola** — private Granola meeting notes integration.
  Docs: [granola-private-app.md](granola-private-app.md).
