# Mim Restructure: Project, You, and Team

Status: product direction, scope model, UX, and implementation programme
accepted; implementation is in progress, with phases 1 through 7 complete.

Mim is a local, file-native workbench where humans and agents work together on
real project files. Collaboration is local-first: every human and agent works
from its own checkout, Git provides durable shared state and history, and an
optional always-on Mim client handles Slack, schedules, and overnight runs.

This direction supersedes and removes the former shared-workspace host and
remote team-space shell.

## Product model

Mim has three scopes with deliberately different jobs:

- **Project** contains the current project's files, instructions, and
  project-specific capabilities.
- **Team** supplies reusable files, instructions, skills, apps, and routines
  across projects.
- **Personal** holds individual preferences, reusable skills and instructions,
  credentials, transcripts, and local runtime choices. It is local, not a
  second external source or an organisational content tree.

The UI uses the Team's actual name, such as **Shoulders**, wherever provenance
matters.

The scopes are intentionally not symmetrical. Project and Team provide work;
Personal adapts Mim to one person. There is no generic Personal Files tree and
no Personal app catalog. Personal is still essential for things such as email
voice, model defaults, credentials, and the apps one person has enabled in a
particular project.

## One Team source

A Mim installation connects to exactly one external Team source. There are no
separate user-facing app registries, skill sources, or organisational-resource
sources. The source maintainer is responsible for presenting one Git repository
in Mim's fixed shape:

```text
shoulders/
  team.yaml
  instructions.md
  files/
  skills/
  apps/
  routines/
```

`team.yaml` supplies the Team identity. Mim discovers the fixed contributions
and presents one connection, one sync state, and one update flow. Apps, skills,
files, instructions, and routines retain their natural runtime lifecycles;
those differences are not source-management concepts in the UI.

The Team source is writable. Team members edit its files and authored skills
through Mim, and Mim synchronises those changes through Git. Team material does
not have a special read-only policy or write-policy toggle; it behaves like
ordinary project material.

## Scope contract

| Material | Availability | Individual choice |
|---|---|---|
| Files | Project files belong to the current Project. Team files are present in every Project. | Project and Team files are ordinary writable files. There is no Personal Files root. |
| Instructions | Personal, Team, and Project instructions compose automatically, with the Project as the most specific context. | Personal instructions are editable only by that person; Project and Team instructions are shared ordinary files. |
| Skills | Mim, Team, Project, and Personal skills resolve into one catalog. | Each person can enable or disable authored skills without changing Team or Project state. |
| Apps | Mim and Team apps are available in every Project; Project apps are available in that Project. | Each person enables apps independently for each local Project checkout. The choice is local and gitignored. |
| Routines | Team routines are available in every Project; Project routines stay with their Project. | Activation and schedule ownership are local to a chosen machine, including an optional always-on client. |

Availability and activation are separate. A Team or Project can provide an app
without enabling it for anybody. Mim's existing
`.mim/packages/enabled.json` is already the right shape for app activation: it
records one user's choices for one local checkout and is never committed. A
toggle therefore does not mutate `team.yaml`, `mim.yaml`, or another person's
state.

## Files

The existing resource-mount, indexing, search, `@` mention, and editor plumbing
is reused and simplified around the single Team source. The Files root shows
two sections:

```text
ACME PROPOSAL
  proposal.docx
  research/

SHOULDERS
  Brand/
  Templates/
  Knowledge/
```

The Team section exposes only the source's `files/` directory. Search results,
mentions, and open documents retain a small Team-name provenance label.

## Skills

Settings -> Skills is one flat list, not a matrix of source groups. Each row
shows:

- skill name and description;
- a small origin label: the current project, the Team name, You, or Mim;
- an enable/disable toggle;
- an action to open the skill.

Personal skills remain supported for individual behaviour that crosses
projects, such as writing email in the user's own voice. They appear in the
same flat list with a **You** origin label rather than in a separate Personal
section. New authored skills can belong to You, the current Project, or the
Team.

Opening a skill opens its `SKILL.md` in Mim's existing editor. Project and Team
skills are editable; Mim's built-in skills are readable. An activated skill is
shown in Chat as a clickable chip with its origin, and opens the same document.
Project definitions override Personal definitions, which override Team
definitions, which override Mim's built-ins.

## Apps

Settings -> Apps & agents uses the same Team connection and labels catalog
entries by origin. Team apps are available in every Project, but each user
independently enables or disables them for the current local Project checkout.
Enabled apps continue to appear in the Navigator's existing Apps section
without a redundant Team prefix. Project-local apps can override Team apps.
Mim-shipped apps remain a built-in origin and do not create another external
source.

## Instructions and routines

Personal, Team, and Project instructions are normal readable documents and are
composed automatically. Settings links open them in Mim's editor; there is no
standalone Instructions settings form.

Team routines appear alongside Project routines in the existing Routines
surface. Definitions travel with their source, while activation, schedules,
and ownership stay local to the machine that should run them. An always-on Mim
client can activate the Team's Slack or overnight routines without becoming a
server or the canonical owner of Team state.

## Concrete UI placement

- The Navigator's workspace switcher continues to show only the current
  Project.
- Settings gains a **Team** section for the single connection, displaying the
  actual Team name, repository, sync state, and an action to open it.
- Files uses the actual Team name as the organisational-files section label.
- Settings -> Skills and Settings -> Apps & agents use the actual Team name as
  origin.
- Search, `@` results, skill chips, and document provenance use the actual Team
  name only when the distinction is useful.

## Settings restructuring plan

The current Settings navigation exposes implementation history: app registries
and skill sources are managed separately; Workspace combines Serve, Resources,
Git sync, local recovery, and telemetry; About contains an organisation-registry
login; and personal appearance choices are persisted per workspace. The target
navigation gives every control one understandable home:

```text
YOU
  General
  AI & Models
  Connections

WORK
  Team
  Project
  Apps & agents
  Skills

ADVANCED
  Tools
```

Mim's version and update information move into the Settings footer instead of
occupying an About tab. The footer reads **Mim 0.x · Check for updates** and
changes to **Mim 0.y ready · Restart** after an update downloads. Individual
app updates remain on their rows in Apps & agents.

### General

General applies to the person across every project:

- name, email, timezone, and an action to open personal instructions;
- theme, editor font, text size, wrapping, line numbers, spell check, and live
  preview;
- anonymous usage-data preference;
- app-level recents and other display preferences where exposed.

These settings move out of per-project `.mim/settings.json` into the Personal
configuration layer. Personal instructions cover durable individual behaviour
such as email voice; editing opens the normal Mim editor.

### AI & Models

AI & Models also applies to the person:

- provider credentials and connection status;
- model defaults for Chat, inline work, and background assistance;
- one plain-language preference for when agents ask before acting.

Per-chat model selection remains in Chat. Project switching does not change the
person's theme, default models, or general agent preference.

### Connections

Connections contains external accounts and browser/search state:

- Slack;
- Google;
- browser sign-in/profile state;
- web-search provider configuration.

Normal connection flows lead with Connect, Reconnect, and Disconnect. OAuth
client setup and manual tokens remain behind an Advanced disclosure. Each Mim
client, including an always-on client, holds its own credentials.

### Team

Team replaces shared-workspace connection, organisational registry, resource
source, app source, and skill source management. Before connection it contains
one action: **Connect Team source**. After connection it shows:

```text
Shoulders
github.com/shoulders-ai/shoulders-mim
Synced just now

Files · Skills · Apps · Routines

[Open] [Sync now]
```

The contribution summary also includes routines when the source provides them;
it does not expose source-management detail.

There are no invites, hosts, namespaces, entitlement tokens, source lists, or
per-source trust controls. Team files, instructions, skills, apps, and routines
are managed on their natural surfaces; this tab manages only the one source.

### Project

Project replaces the useful remainder of Workspace:

- current project name and local location;
- project Git/remote status and a manual **Sync now** escape hatch;
- an action to open project instructions in Mim's editor;
- local file recovery and run records;
- advanced local storage budgets and cleanup.

Git URLs and implementation detail stay behind Advanced or the initial project
connection flow. Shared workspace, Resources, and Analytics disappear from
this tab; analytics belongs in General.

### Apps & agents

Apps and CLI agents remain project capabilities and Navigator launchers. The
tab contains:

- apps active in the current Project;
- apps available from the Team or Mim;
- project-local app overrides;
- detected CLI agents and their launcher toggles.

Every app row carries a small origin label. App documentation, capabilities,
updates, enablement, and developer details remain. Registry groups, Add source,
organisation entitlements, and registry connection/trust flows disappear.
Creating an app chooses only **Project** or **Team** as its destination. App
enablement always writes private local state for the current user and Project;
it never edits the Project or Team source.

### Skills

Skills is one searchable flat list. Rows show name, description, origin, and an
enable/disable toggle. Clicking a row opens `SKILL.md` in Mim's editor. Add
offers three destinations only when needed: **You**, **Project**, or **Team**.

Skill-source groups, Add source, source refresh/removal, Finder-only editing,
and import-as-a-separate-source disappear. The Team tab owns source syncing.

### Tools

Tools remains an advanced, current-Project capability list. It answers only:
"What can agents use in this project?" Connections and apps contribute tools;
this tab allows individual capabilities to be disabled and manages locally
installed code interpreters. It does not manage Team sources or credentials.

## Adjacent surface changes

### Files

The current Shared resources section already proves the mount, traversal,
indexing, search, `@` mention, and editor paths. It becomes one fixed Team root:

- **Shared resources** becomes the actual Team name, for example **Shoulders**;
- arbitrary collection rows and mount-path details disappear;
- the root maps only to the Team source's `files/` directory;
- read-only badges and write-policy toggles disappear;
- Team files use ordinary create, edit, rename, move, and delete interactions;
- breadcrumbs and search results display Project or Team provenance without
  exposing `.mim/resources/...` paths.

### Chat and editor

- Selected and activated skills appear as clickable chips with their origin.
- Opening a Team, Project, Personal, or built-in skill uses the normal document
  editor; writable origins save normally.
- Team-file and skill edits participate in the same background Git sync as
  other Team changes.

## Clean-break removal inventory

Backward compatibility is explicitly not required for the abandoned sharing
model. The restructure removes old concepts instead of preserving aliases,
migrations, or hidden compatibility paths.

Remove:

- network `mim serve`, HTTP MCP/SSE serving, member tokens, invites, remote
  shared-workspace links, remote tool mounts, and their Settings flows;
- the Web Shell and the browser-hosted shared team-space direction;
- arbitrary Resources/Collections, mount lists, read-only/write policy, and
  committed collection configuration;
- separate skill sources, app registry source lists, organisation-registry
  accounts and entitlements, registry trust/source management, and their
  configuration fields;
- shared-workspace, collection, registry-source, and skill-source parsers,
  tools, tests, docs, and stale UI copy once their reusable internals have been
  moved behind the fixed Team source.

Keep:

- the headless kernel, local MCP bridge, CLI agents, apps runtime, skills,
  routines, Slack/Google/Granola connections, editor handoff, search, and
  document tooling;
- project Git tools, managed sync, local file recovery, traces, transcripts,
  package/app updates, and the resource indexer and file-mount internals reused
  for Team files;
- the ordinary desktop client as the same executable used interactively,
  offline, or as an always-on client.

The clean break does not delete ordinary Project or Personal material. It
means obsolete Serve, Resources, registry-source, and skill-source settings are
no longer read or migrated.

## Git and Git LFS for beta

Mim will not bundle Git or Git LFS during the beta. Bundling would enlarge each
platform installer and add platform-specific binary acquisition, verification,
licensing, signing, packaging, and release tests before beta usage proves that
the convenience is needed.

Instead:

- Team connection and managed Project sync perform a friendly Git capability
  check before setup;
- when Git is missing, Mim gives one exact platform-specific installation
  action and a **Try again** button;
- ordinary DOCX, XLSX, PDF, image, and other binary files use normal Git during
  beta;
- Git LFS is optional and requested only when a repository's attributes
  actually use LFS; Mim then gives one exact installation action and verifies
  it;
- normal operation still hides commits, pulls, pushes, and merges. This is a
  dependency check, not a Git UI.

This keeps the beta installer and release pipeline unchanged. Bundling can be
reconsidered when actual beta users are blocked by installation, with a
one-time managed download as a smaller alternative to permanently embedding
every binary in Mim.

## Implementation programme

Each phase starts with co-located contract tests and finishes with obsolete
paths removed rather than left beside the replacement.

1. **Characterise the reusable seams — complete.** Contract tests protect app
   enablement, skill resolution, file mount/index/search, settings persistence,
   routine activation, and Git sync. The tests keep activation and runtime
   state local, pin Project > Personal > Team > Mim skill precedence, exercise
   the real file mount-to-search path, and prove managed sync across two
   checkouts. The external-source fixture is self-contained rather than tied to
   one developer machine.
2. **Retire Serve and shared workspace — complete.** The network command and
   transport, remote membership and mounts, Web Shell charter, shared-workspace
   UI/config, remote actor/grant paths, and remote-only tests are removed.
   Headless execution, local MCP, Slack, routines, and CLI-agent paths remain.
3. **Make Personal and Project state honest — complete.** Theme, editor and
   layout preferences, model defaults, identity, approval preference, and
   global skill toggles resolve from Personal persistence. Transcripts, app and
   agent enablement, routine activation, recovery, traces, Navigator order,
   tool policy, and other per-checkout runtime remain under gitignored `.mim/`.
   Superseded Personal keys in Project settings are ignored without migration
   or compatibility readers.
4. **Introduce the Team contract — complete.** One Personal, credential-free
   repository connection resolves to the deterministic writable
   `~/.mim/team/` checkout. The shared resolver validates required
   `team.yaml`, optional `instructions.md`, and optional `files/`, `skills/`,
   `apps/`, and `routines/` directories. Status, clone/connect, open, and
   commit/rebase/push sync use system Git as the sole credential path; invalid
   clones never become connected state.
5. **Replace Resources with Team Files — complete.** Repoint the existing mount, watcher,
   index, search, `@` mention, editor, and native-open flows to the Team
   `files/` root. Make the root writable and remove collections, path bindings,
   read-only badges, write policies, and Resources Settings.
6. **Compose instructions and unify Skills — complete.** Load Personal, Team, Project, and
   Mim origins with explicit precedence. Build the flat Skills list, origin
   chips, per-user toggles, create destinations, editor opening, and normal
   save/sync for writable `SKILL.md` files. Replace the Settings textarea for
   instructions with editor links.
7. **Unify Apps and agents — complete.** Discover Team apps directly from the Team source,
   Project apps from the Project, and Mim apps from the build. Preserve runtime,
   validation, updates, developer information, overrides, and the existing
   per-user/per-Project enablement file. Delete registry browse/source/account
   flows and merge CLI agents into Apps & agents.
8. **Add Team routines — complete.** Resolve Team and Project routine definitions in one
   surface, retain machine-local activation and schedule ownership, and make
   the chosen owner visible. Verify that two clients can make different
   activation choices without writing shared state.
9. **Restructure Settings and updater UX — complete.** Implement the accepted YOU / WORK /
   ADVANCED navigation, move every retained control to its new owner, delete
   Workspace/Instructions/About remnants, and add the version/update footer.
   Settings remains a dense fixed-size dialog using existing UI primitives.
10. **Finish invisible Git for beta — complete.** Git/LFS preflight reports
    exact platform setup actions only when required. Managed Team and Project
    sync runs on open, after successful file mutations, and before quit, with
    offline retry and plain-language paused/stopped states. Rebase collisions
    restore the local path and preserve timestamped local and remote sibling
    copies; automatic retry then waits for the explicit **Sync now** escape
    hatch. Local history remains independent, and Git is not bundled.
11. **Add useful awareness in two cuts.** First show fetched Git-derived recent
    changes and authors. Later, if still valuable, add ephemeral open-file
    presence through a tiny online relay; do not introduce locks, authoritative
    remote worktrees, or shared editor state.
12. **Exercise the always-on client.** Run the same Mim client on an always-on
    machine with its own Team and Project checkouts. Make Slack, external
    triggers, schedules, and overnight loops reliable while keeping activation
    and credentials local to that machine.
13. **Close the restructure.** Remove dead dependencies and vocabulary, update
    current-state docs and `_MAP.md`, run the full repository and external app
    compatibility suites, build every supported target, and perform a visual
    walkthrough of each accepted Settings and Files flow.

## Acceptance checks

- A person connects **Shoulders** once and its files, instructions, skills,
  apps, and routines appear in their natural surfaces.
- A Team file or skill can be edited in Mim and synchronised like an ordinary
  file; offline edits remain possible.
- Two people can enable different Team apps in the same Project without either
  toggle appearing in Git or affecting the other person.
- A Project app or skill overrides the same Team contribution while retaining
  clear origin.
- A chosen always-on client runs a Team routine while another person's client
  leaves it inactive.
- Conflicting edits never silently overwrite one version, and no file is left
  permanently locked because somebody once opened it.
- Settings exposes only the accepted YOU / WORK / ADVANCED structure and the
  update footer; there is no Serve, Shared workspace, Resources, source-list,
  registry-account, or entitlement surface.
- Headless execution, local MCP, editor handoff, connections, routines, apps,
  recovery, and traces still work after the removal pass.

## Collaboration decisions

- There is no multi-user server filesystem and no mandatory Mim home server.
- Humans and agents are clients with their own local checkouts and offline use.
- Git/GitHub supplies shared state, history, and background synchronisation.
- Normal use does not expose Git commands, commits, pulls, pushes, or merges.
- Files are not hard-locked. Awareness may report who recently opened or
  changed a file; conflicts preserve both versions for resolution.
- Team and Project determine app availability. Per-user/per-Project local state
  determines app activation; collaborators never share toggles.
- Git-derived recent changes ship before any live open-file presence.
- An always-on Mim is an optional client for external triggers and unattended
  work, not the canonical owner of project state.
