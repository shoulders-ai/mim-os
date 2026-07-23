---
id: team
title: team
order: 4
sources:
  - docs/team.md
  - docs/git.md
  - src/main/team/teamSource.ts
  - src/main/team/teamFiles.ts
  - src/renderer/components/settings/TeamSettingsPanel.vue
verified: direct-team-source
---

# team

A Team is one shared Git repository that adds the same files, instructions,
skills, apps, and routines to every Project you open. You connect it once in
Mim. It is independent of any individual Project.

::: note
Connecting a Team does not move or delete Project data. A Project's `issues/`,
`knowledge/`, documents, chats, and `.mim/` state stay where they are.
:::

## Connect an existing Team

You need access to the repository through Git on your computer. Mim accepts
credential-free HTTPS and SSH locations:

```text
https://github.com/organisation/team.git
git@github.com:organisation/team.git
```

For a private HTTPS repository, configure your normal Git credential helper
first. For SSH, configure your normal SSH key. If this command works in a
terminal, Mim can use the same credentials:

```bash
git ls-remote <repository>
```

Then open Settings > Team, paste the repository location, and select
**Connect Team source**. Mim clones and validates it before saving the
connection. Once connected, the Team's real name and a summary of its
contributions appear in Settings.

## Create a Team folder

A minimal Team repository contains:

```text
team.yaml
files/
skills/
apps/
```

`team.yaml` is the only required item:

```yaml
name: My Team
```

Git does not keep empty folders, so use an empty `.gitkeep` if `files/` should
exist before it contains anything. The complete layout is:

```text
team.yaml             # Team name
instructions.md       # optional instructions used in every Project
files/                # shared writable files
skills/<name>/        # standalone skills, each with SKILL.md
apps/<id>/             # apps, each with package.json
routines/              # shared routine definitions
```

Commit and push this folder as a normal Git repository, then connect its remote
URL from Settings > Team.

## What happens after connection

Each contribution appears on its natural surface:

::: rows
- Files — `files/` appears in Files under the Team's actual name.
- Instructions — `instructions.md` is added automatically to the agent's
  instructions.
- Skills — standalone Team skills appear in Settings > Skills.
- Apps — Team apps appear in Settings > Apps & agents.
- Routines — Team routines appear alongside Project routines.
:::

Available and active are different. Connecting a Team makes its apps available,
but does not enable them or grant their permissions. Open
Settings > Apps & agents, expand an app, review its access, and enable it for
the current Project. Only enabled apps with a view receive a Navigator
launcher.

That choice is local. Another teammate can enable a different set of apps
without changing the repository or your settings. An app's source is also
separate from its data: the Team-provided Board and Knowledge apps continue to
read the open Project's `issues/` and `knowledge/` folders.

## Editing and sync

Team files and authored capabilities are ordinary writable files. Mim keeps one
checkout at `~/.mim/team/`, syncs it in the background, and gives every open
Project a safe mount at `.mim/team/`.

Use **Sync now** in Settings > Team to retry immediately or confirm that the
repository is current. If two people edit the same Team file, Mim preserves
local and remote sibling copies and waits for a person to resolve them. It does
not silently choose one version.

## Troubleshooting

::: rows
- No app launcher — open Settings > Apps & agents and enable the app for this
  Project. Availability alone does not add a launcher.
- No apps in Settings — select Sync now, then select **Refresh apps** in
  Settings > Apps & agents. Check that each app is directly under
  `apps/<id>/` and has a valid `package.json`.
- Private repository cannot clone — make `git ls-remote <repository>` work in a
  terminal first. Never put a token into the repository URL.
- Board or Knowledge is empty — confirm that the intended Project is open.
  Team sync does not copy Project data.
:::

More on app activation is in [apps](apps).

::: under-the-hood
The repository location is Personal state in `~/.mim/config.yaml`. The checkout
uses system Git and normal credential helpers; Mim stores no Team token. Only
`.mim/team/files/` is exposed as a Files root. App activation and permission
acknowledgements live in the open Project's gitignored
`.mim/packages/enabled.json`.
:::
