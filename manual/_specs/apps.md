# Spec: apps (order 9)

Purpose: extending Mim — using apps from the catalog, sharing them with
collaborators, and making your own.

## Outline

- What an app is: an installable unit that can add views to the sidebar, tools the
  agent can call, skills, and background jobs. Apps run sandboxed and call the same
  permissioned tools as everyone else — one sentence, calm.
- The catalog: apps live in the mim-apps registry; name the shipped set with one
  line each (Board, Knowledge, Slides, DOCX Review, Scholar, References, Import-MD —
  verify the current list against the mim-apps repo or registry source; do not
  invent descriptions).
- Adding an app: Settings > Apps (verify exact flow: `app.add`, trust prompt,
  enable/disable/remove). Trust: you acknowledge an app before it runs — user-level.
- Sharing: `app.share` pins an app in the workspace so collaborators get it;
  missing-apps banner on their side (verify).
- Making your own: Settings > Apps creates a starter app from a template into the
  workspace; edit, validate, reload. Workspace skills as the lighter option —
  point back to [agents](agents) for what skills are, forward to
  docs/custom-apps.md-derived /develop content for the full authoring story.
- Trapdoor: manifest, SDK, named tools → /develop (app SDK & API).

## Boundaries

No SDK detail, no manifest fields, no job API (→ /develop). No skill-usage
explanation (→ agents).

## Sources

- README.md (Apps)
- docs/custom-apps.md
- src/main/tools/install.ts (app.add / app.share)
- src/main/tools/coreApps.ts
- src/renderer/components/settings/AppsSettingsPanel.vue
- src/renderer/components/MissingAppsBanner.vue

## Length

800–1200 words.
