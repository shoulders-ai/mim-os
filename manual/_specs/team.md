# Spec: team (order 4)

Purpose: explain in plain language how to create, connect, use, and troubleshoot
one Team source.

## Outline

- A Team is one Git repository that contributes reusable files, instructions,
  skills, apps, and routines to every Project.
- Explicit safety boundary: connecting or syncing does not move or delete
  Project data such as `issues/` or `knowledge/`.
- Setup: system Git access, credential-free HTTPS or SSH URL, Settings > Team.
- Minimal and complete folder structures, including `team.yaml`.
- What appears where.
- Availability versus activation, local permission review, and why an app may
  be available without a Navigator launcher.
- Writable checkout and conflict-safe sync.
- Short troubleshooting section.

## Boundaries

No internal implementation tour beyond the under-the-hood block. Do not teach
Git fundamentals or imply that Team Git backs up Project files.

## Sources

- docs/team.md
- docs/git.md
- src/main/team/teamSource.ts
- src/main/team/teamFiles.ts
- src/renderer/components/settings/TeamSettingsPanel.vue

## Length

700–1100 words.
