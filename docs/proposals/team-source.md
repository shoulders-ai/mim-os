# Mim Restructure: Project, You, and Team

Status: core product direction accepted; Settings and implementation plan under
review; not yet implemented.

Mim is a local, file-native workbench where humans and agents work together on
real project files. Collaboration is local-first: every human and agent works
from its own checkout, Git provides durable shared state and history, and an
optional always-on Mim client handles Slack, schedules, and overnight runs.

This direction supersedes the shared-workspace model in
[mim-serve.md](mim-serve.md) and the remote team-space shell in
[web-shell.md](web-shell.md).

## Product model

Mim has three scopes with deliberately different jobs:

- **Project** contains the current project's files and project-specific
  capabilities.
- **Team** supplies reusable files, skills, and apps across projects.
- **Personal** holds individual preferences, reusable skills and instructions,
  plus local runtime state. It is local, not a second external source or an
  organisational content tree.

The UI uses the Team's actual name, such as **Shoulders**, wherever provenance
matters.

## One Team source

A Mim installation connects to exactly one external Team source. There are no
separate user-facing app registries, skill sources, or organisational-resource
sources. The source maintainer is responsible for presenting one Git repository
in Mim's fixed shape:

```text
shoulders/
  team.yaml
  files/
  skills/
  apps/
```

`team.yaml` supplies the Team identity. Mim discovers all three contribution
types from the fixed directories and presents one connection, one sync state,
and one update flow. Apps and skills may retain different internal runtime
lifecycles; that distinction is not a source-management concept in the UI.

The Team source is writable. Team members edit its files and authored skills
through Mim, and Mim synchronises those changes through Git. Team material does
not have a special read-only policy or write-policy toggle; it behaves like
ordinary project material.

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

Settings -> Apps uses the same Team connection and labels catalog entries by
origin. Enabled apps continue to appear in the Navigator's existing Apps
section without a redundant Team prefix. Project-local apps can override Team
apps.

## Concrete UI placement

- The Navigator's workspace switcher continues to show only the current
  Project.
- Settings gains a **Team** section for the single connection, displaying the
  actual Team name, repository, sync state, and an action to open it.
- Files uses the actual Team name as the organisational-files section label.
- Settings -> Skills and Settings -> Apps use the actual Team name as origin.
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
occupying an About tab.

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

Files 42   Skills 8   Apps 4

[Open] [Sync now]
```

There are no invites, hosts, namespaces, entitlement tokens, source lists, or
per-source trust controls. Team files, skills, and apps are managed on their
natural surfaces; this tab manages only the one source.

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
Creating an app chooses only **Project** or **Team** as its destination.

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

## Implementation programme

1. **Retire the abandoned direction.** Remove Serve/shared-workspace UI and
   plumbing, the Web Shell charter, and unfinished remote collaboration tracks
   without removing the headless kernel or local MCP.
2. **Make scopes real.** Separate Personal settings from local Project state;
   define the fixed Team-source contract and ordered capability resolution.
3. **Build one Team resolver.** Clone/open/sync the single Git repository and
   discover `files/`, `skills/`, and `apps/` through one service and status.
4. **Simplify Files.** Reuse the existing resource mount/index paths for the
   fixed writable Team files root; remove arbitrary collections and read-only
   policy logic.
5. **Unify Skills.** Replace skill-source management with Team discovery, a
   flat catalog, origin labels, toggles, and editor handoff.
6. **Unify Apps.** Replace multi-registry source management with Team discovery
   while retaining installation, updates, project enablement, app runtime, and
   project overrides.
7. **Restructure Settings.** Apply the navigation and control moves above,
   including Personal persistence and removal of superseded settings.
8. **Finish invisible Git.** Bundle the required Git/LFS runtime, automate Team
   and Project pull/commit/push, preserve conflicting versions, and expose only
   plain-language sync state and recovery.
9. **Add lightweight awareness.** Report recent file opens/changes without hard
   locks or shared mutable worktrees.
10. **Harden the optional always-on client as a client.** Make Slack, schedules,
    and unattended routines reliable without making that machine the owner of
    Team or Project state.

## Collaboration decisions

- There is no multi-user server filesystem and no mandatory Mim home server.
- Humans and agents are clients with their own local checkouts and offline use.
- Git/GitHub supplies shared state, history, and background synchronisation.
- Normal use does not expose Git commands, commits, pulls, pushes, or merges.
- Files are not hard-locked. Awareness may report who recently opened or
  changed a file; conflicts preserve both versions for resolution.
- An always-on Mim is an optional client for external triggers and unattended
  work, not the canonical owner of project state.
