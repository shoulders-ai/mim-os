# Headless CLI

The `mim` CLI is the Tier 1 headless interface over the same main-process tool registry used by the app.

It boots `src/main/headless.ts`, registers safe non-UI tools, opens a workspace, and runs generic `mim tool` calls as the `ai` actor through the headless permission gate. It does not start Electron, the package iframe server, PTY tabs, or renderer bridge tools.

## Running

Build first:

```bash
npm run build
node bin/mim.mjs help
```

When installed through npm, the binary name is `mim`.

## Workspace Resolution

Commands resolve the workspace in this order:

1. `--workspace path`
2. nearest parent containing `mim.yaml`
3. current working directory

`mim init [path]` initializes the target path, creates the workspace contract, and uses `--name` when provided. `--workspace` must be followed by a path.

## Commands

```bash
mim init [path] [--name name]
mim status [--workspace path]
mim orient [--workspace path] [--json]
mim log <message> [--workspace path]
mim log --read [--workspace path] [--json]
mim list-tools [--json]
mim tool <name> [json|--stdin] [--workspace path] [--json] [--yes]
mim go [--workspace path] [-- command ...]
mim mcp
mim shared-workspace token set <id> <token|--stdin> [--json]
mim shared-workspace token status <id> [--json]
mim shared-workspace token clear <id> [--json]
mim serve [--host host] [--port port] [--workspace path]
mim serve token create --name name [--workspace path] [--json]
mim serve token list [--workspace path] [--json]
mim serve token rotate <id> [--workspace path] [--json]
mim serve token revoke <id> [--workspace path]
mim serve invite create --name name [--url url] [--expires 7d] [--workspace path] [--json]
mim serve invite list [--workspace path] [--json]
mim serve invite revoke <id> [--workspace path]
mim serve denials list [--workspace path] [--json]
mim serve state migrate --from workspace [--apps ids] [--workspace path] [--json]
mim serve backup create --output dir [--workspace path] [--json]
mim serve backup restore --from dir [--workspace path] [--json]
```

`mim orient` regenerates `.mim/agent-context.md` and prints it by default.

`mim log` appends or reads the human logbook at `.mim/log.md`.

`mim tool` is the generic tool entrypoint. It accepts one JSON object argument or reads the object from standard input:

```bash
node bin/mim.mjs tool workspace.info '{}' --json
printf '{}\n' | node bin/mim.mjs tool workspace.info --stdin --json
```

For secret-bearing calls, prefer `--stdin` from a trusted local shell so tokens do not need to be typed directly into the command line.

Approval-required `mim tool` calls are denied by default in non-interactive mode. On an interactive TTY the CLI prompts on stderr. `--yes` is the explicit escape hatch for trusted local automation and auto-approves the headless gate.

`mim go` refreshes agent context, then runs an external command in the workspace. With no command it runs `claude`.

`mim mcp` starts the MCP stdio bridge to the running desktop app. It does not
boot a headless workspace. It uses `MIM_PORT`/`MIM_TOKEN` when present, otherwise
reads `~/.mim/server.json`. See [mcp.md](mcp.md).

`mim shared-workspace token` stores client-side bearer tokens for
`sharedWorkspace` mounts in `~/.mim/keys.env`. `set` writes or replaces the
token without echoing it and can read the token from `--stdin`, `status`
reports whether an id is configured, and `clear` removes the id's token. The
key name is deterministic: `team-server` maps to
`MIM_SHARED_WORKSPACE_TEAM_SERVER_TOKEN`.

`mim serve` starts a headless shared-workspace host over authenticated MCP HTTP.
Create at least one serve token or redeemable invite before starting. Serve
invite commands are for humans with the desktop app: `create` prints a
`mim://join/...` link and `mim-invite-...` paste string, `list` omits secrets,
and `revoke` cancels an unused invite. Serve token commands are for CLI agents
and automation: they manage shown-once bearer tokens. Denials list the remote
requests that failed grants; state migration copies selected app data from an
existing workspace; backup and restore round-trip served structured `.mim`
state plus serve config. See
[serve.md](serve.md).

## Trace Tools

The CLI can inspect the same local trace stream used by chat observability:

```bash
# Aggregate recent tool, model, gate, job, package, day, and outcome health
node bin/mim.mjs tool trace.stats '{"days":7}' --json

# Return capped redacted digest events; payload blobs stay referenced by pointer
node bin/mim.mjs tool trace.query '{"days":1,"status":"error","limit":20}' --json

# Regenerate .mim/agent-context.md, including Observability health when signals exist
node bin/mim.mjs orient --json
```

## Registry, Install, and Enablement

On workspace open, the headless kernel registers the same package loader,
enablement store, app tools, registry tools, and install tools as the Electron
app. All of these are available through `mim tool`:

```bash
# List all registry sources and their entries (returns { registries: [...], entries: [...] })
mim tool registry.list '{}' --json

# Acknowledge trust for a workspace-declared registry
mim tool registry.trust '{"id":"acme"}' --yes

# Install a package globally from the registry
mim tool package.install '{"id":"github-monitor"}' --yes

# Install a specific version
mim tool package.install '{"id":"github-monitor","version":"1.2.0"}' --yes

# Install from a direct repo URL (optional "path" selects a subdirectory in a multi-package repo)
mim tool package.install '{"repo":"https://github.com/shoulders-ai/mim-apps","path":"packages/github-monitor","ref":"v1.2.0"}' --yes

# Update to the latest registry version (repoints workspace pin if one exists)
mim tool package.update '{"id":"github-monitor"}' --yes

# Uninstall a version
mim tool package.uninstall '{"id":"github-monitor","version":"1.0.0"}' --yes

# View resolved enablement state for all packages
mim tool app.status '{}' --json

# Add an installed package to my sidebar/capability set
mim tool app.enable '{"id":"github-monitor"}' --yes

# Share a registry app with collaborators by writing a committed mim.yaml pin
mim tool app.share '{"id":"github-monitor"}' --yes

# Remove from my sidebar/capability set
mim tool app.disable '{"id":"some-addon"}' --yes
```

Registry and install tools (`registry.list`, `package.install`,
`package.update`, `app.share`) are `network`-category (external effect), so they require
`--yes` or TTY confirmation. `package.uninstall`, `app.enable`/`app.disable`
are `settings`-category (mutate effect), same rule.

`app.trust` and `registry.trust` are user-only and hard-denied to the `ai`
actor. They are not available through `mim tool` (which runs as `ai`). Trust
acknowledgement for vendored workspace packages and workspace-declared
registries is an interactive-only action.

### Sharing and enablement

Apps have separate sharing and personal-enable states:

- **shared** — the committed `mim.yaml` `apps:` entry, keyed by package id.
  It travels through git and tells collaborators which app/source/version the
  workspace uses. It does not enable the app for anyone.
- **enabled** — the gitignored `.mim/packages/enabled.json` entry for this
  workspace. It controls the current user's sidebar/capability set.

`app.enable` and `app.disable` are always personal/local. Explicit
`layer:"workspace"` is rejected; use `app.share` for workspace sharing and
`app.remove` to remove a workspace share.

Activation order: local enabled entry plus the vendored-app trust gate, else
disabled. A committed `mim.yaml` app pin never activates app code by itself.

## Source

- CLI entrypoint: `src/main/cli.ts`
- Headless registry: `src/main/headless.ts`
- MCP stdio bridge: `src/main/mcp/stdio.ts`
- Shared workspace client token helpers: `src/main/workspace/sharedWorkspaceTokens.ts`
- Shared workspace invite join: `src/main/workspace/sharedWorkspaceInvite.ts`
- Serve helpers: `src/main/serve/`
- Binary wrapper: `bin/mim.mjs`
- Build output: `out/main/cli.js`
- Tests: `src/main/cli.test.ts`
