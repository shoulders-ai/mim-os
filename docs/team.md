# Team Source

A Team source is one ordinary Git repository that gives every Project the same
shared files, instructions, skills, apps, and routines. Each Mim installation
can connect to at most one Team source. The connection belongs to the person
using Mim, not to the open Project.

Connecting a Team does not move, merge, or delete Project files. For example,
`issues/` and `knowledge/` remain in the Project that owns them. The Team
repository supplies the app code that reads those folders; it does not become
their data store.

## Set up an existing Team

Before opening Mim, make sure the repository works with normal system Git:

```bash
git ls-remote https://github.com/organisation/team.git
```

SSH works too:

```bash
git ls-remote git@github.com:organisation/team.git
```

For a private HTTPS repository, configure the operating system's Git credential
helper first. Do not put a username, password, or token in the URL.

Then:

1. Open **Settings > Team**.
2. Paste the credential-free HTTPS or SSH repository location.
3. Select **Connect Team source**.
4. Wait for the Team name and contribution summary to appear.
5. Open **Settings > Apps & agents** to review and enable the apps you want in
   the current Project.

Connecting makes Team apps *available*. It deliberately does not enable them or
grant their permissions. App activation is Personal and Project-local, so two
people can use different Team apps without changing the Team repository.

The private Mim Team source created for this project can be connected with:

```text
https://github.com/shoulders-ai/mim-team.git
```

## Create a Team repository

A minimal Team repository looks like this:

```text
team.yaml
files/
skills/
apps/
```

Only `team.yaml` is required:

```yaml
name: My Team
```

Git does not retain empty directories. Add an empty `.gitkeep` when the Team
should begin with an empty Files folder:

```bash
mkdir -p files skills apps
touch files/.gitkeep
git add team.yaml files/.gitkeep
git commit -m "Create Team source"
git push
```

The complete fixed contract is:

```text
team.yaml             # required Team identity
instructions.md       # optional instructions for every Project
files/                # optional shared, writable files
skills/<name>/        # optional standalone Team skills
  SKILL.md
apps/<id>/             # optional Team apps
  package.json
routines/              # optional Team routine definitions
```

`team.yaml` must define a non-empty `name`. When present,
`instructions.md` must be a regular file, and each contribution location must
be a real directory rather than a symlink. An absent optional directory simply
contributes nothing.

A standalone skill needs a `SKILL.md` whose frontmatter `name` matches its
folder. An app needs a valid `package.json` directly under `apps/<id>/`. See
[skills.md](skills.md) and [custom-apps.md](custom-apps.md) for those contracts.

## What appears where

| Team content | Where it appears | Activation |
| --- | --- | --- |
| `files/` | Files, grouped under the Team's real name | Always available |
| `instructions.md` | Composed into every chat after Mim instructions | Automatic |
| `skills/` | Settings > Skills and Chat | Each person may disable a skill |
| `apps/` | Settings > Apps & agents | Each person reviews and enables per Project |
| `routines/` | Routines | Each machine reviews and activates independently |

Project apps override Team apps with the same id. Team apps override Mim apps.
Project skills override Personal skills, which override Team skills, which
override Mim skills. App-bundled skills remain attached to their owning app.

## Personal connection and checkout

The repository location is stored as Personal state in `~/.mim/config.yaml`:

```yaml
team:
  repository: https://github.com/organisation/team.git
```

The writable checkout lives at `~/.mim/team/`. Each open Project receives one
managed mount:

```text
<project>/.mim/team  ->  ~/.mim/team
```

Only the Team's `files/` directory is exposed in Files and content search.
Instructions, skills, apps, and routines use the same checkout internally but
do not appear as extra file roots.

Mim accepts credential-free HTTPS, SSH, and local Git repository locations.
Plain HTTP is rejected. HTTPS URLs containing credentials are rejected. Team
operations always use the system `git` binary so normal SSH keys and credential
helpers remain the only authentication path; Mim never stores a separate Team
token.

Git LFS is required only if a `.gitattributes` file requests `filter=lfs`.
Mim checks this after cloning and reports a platform-specific setup action when
Git LFS is missing.

## Sync and safety

The `team.status`, `team.connect`, `team.open`, and `team.sync` tools share one
Team-source instance:

- `team.status` reports connection, contract, Git state, and contributions
  without fetching.
- `team.connect` clones into a temporary directory, validates the contract, and
  persists the connection only after validation succeeds.
- `team.open` returns the validated fixed paths.
- `team.sync` stages Team changes, commits them as `Mim Team sync`, rebases,
  validates the pulled contract, and pushes.

The desktop syncs on Project open, after Team mutations, and before quit.
Connecting or syncing touches the Team checkout only. Project files and
Project-local state under `<project>/.mim/` are not staged into Team Git.

Offline failures pause and retry. If both sides edit the same Team path, Mim
keeps the local working path and writes timestamped `conflict-local` and
`conflict-remote` sibling copies. Automatic retries stop until a person keeps
the desired content and selects **Sync now**.

`src/main/team/teamSource.ts` is the sole contract resolver.
`src/main/team/teamFiles.ts` owns the safe Project mount. It creates,
retargets, or removes only the `.mim/team` symlink or junction and never
replaces a real path at that location.

## Troubleshooting

**The Team connects, but no app launcher appears.** Open
**Settings > Apps & agents**. Available apps do not appear in the Navigator
until you review their permissions and enable them for this Project. Headless
apps with no view never receive a Navigator launcher.

**No Team apps appear in Settings.** Select **Sync now**, then reload the app
catalog. Inspect Developer details for manifest diagnostics. Apps must be
direct children of `apps/`, and each child needs a valid `package.json`.

**A private repository cannot clone.** Run `git ls-remote <repository>` in a
terminal. Fix the system Git credential helper or SSH key until that succeeds;
Mim uses the same credentials.

**Files are missing from the Team section.** Team Files come only from
`files/`. Files beside `team.yaml` or inside `apps/` are not shown in the Files
surface.

**Board or Knowledge looks empty.** Confirm the intended Project is open.
Those apps read that Project's `issues/` and `knowledge/` directories; Team
sync does not copy Project data between Projects.
