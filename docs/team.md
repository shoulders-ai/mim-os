# Team Source

Mim connects each Personal installation to at most one writable, Git-backed
Team source. The connection is independent of the current Project.

## Repository contract

The repository root has one required manifest and five fixed contribution
locations:

```text
team.yaml
instructions.md
files/
skills/
apps/
routines/
```

`team.yaml` is required and must contain a non-empty `name`. That real Team name
is the provenance label shown elsewhere in Mim. `instructions.md` and all four
directories are optional; an absent optional location contributes nothing.
When present, `instructions.md` must be a regular file and each contribution
directory must be a real directory rather than a symlink.

The resolver in `src/main/team/teamSource.ts` is the only code that interprets
this layout. It returns the Team identity, absolute fixed paths, and a
contribution summary. Skills, apps, routines, instructions, Files, and Chat use
that resolved contract rather than parsing `team.yaml` independently.

## Personal connection and checkout

The credential-free repository location is Personal state:

```yaml
team:
  repository: git@github.com:organisation/team.git
```

It lives in `~/.mim/config.yaml`. The one checkout lives at
`~/.mim/team/`. No Team connection or checkout path is written to a Project.
Repository URLs containing HTTP credentials are rejected.

Mim requires the system `git` binary for Team operations. This is deliberate:
SSH keys and the user's normal Git credential helper are the single
authentication path. Mim does not accept, persist, inject, or maintain a
separate Team token. The status result includes a platform-specific Git
installation action when Git is unavailable.

Git LFS remains optional. Mim scans tracked attribute files for `filter=lfs`
after cloning with smudging deferred. Only a repository that actually requests
the filter requires Git LFS; Mim then reports one platform-specific install
action and runs `git lfs pull` once the capability is available.

## Lifecycle

The `team.status`, `team.connect`, `team.open`, and `team.sync` tools all share
one Team-source instance:

- `team.status` reports connection, contract, local Git state, and contribution
  summary without fetching.
- `team.connect` checks Git, clones to a temporary location, validates the
  contract, atomically installs the checkout, and only then persists the
  Personal connection.
- `team.open` resolves the validated checkout and fixed paths for downstream
  surfaces.
- `team.sync` stages and commits Team edits as `Mim Team sync`, rebases on the
  remote, validates the pulled contract, and pushes. Conflicts stop sync for
  explicit resolution; Mim never auto-resolves them.

The checkout is writable ordinary Git state, not a pull-only mirror. If a
connected checkout is missing, `team.sync` clones and validates it again.

Apps cannot access the Personal Team connection or its management tools.
Team-provided capabilities are exposed through their natural scoped runtime
surfaces in later resolution layers.
