# Skills

Filesystem skill system for the Mim AI agent. **Status: implemented.**

Skills are markdown instruction folders. Authored skills are managed in
Settings -> Skills. App-bundled skills are owned by their apps and are managed in
Settings -> Apps.

## What a skill is

A skill is a folder with a required `SKILL.md` file plus optional bundled
resources:

```text
skills/
  issue-work/
    SKILL.md
    references/
    scripts/
    assets/
```

`SKILL.md` starts with YAML frontmatter:

```markdown
---
name: issue-work
description: Use when the user wants to plan, triage, reference, create, update, or continue work tracked in Mim issues.
tools: [issues.list, issues.update]
unlocks: [issues.list, issues.update]
---

# Issue Work
...
```

## Frontmatter

- `name` is required and must match the skill folder name for loaded roots.
- `description` is required and is the activation signal shown in the catalog.
- `tools` is descriptive. It tells the catalog what the skill commonly uses.
- `unlocks` is the gating list. Tools named here are hidden from chat until the
  skill activates.

Activation still unions `tools` and `unlocks` for compatibility with older
skills, but new skills should put gating intent in `unlocks`.

## Discovery and identity

`createSkillLoader` scans authored roots in this precedence order:

| Source | Path | Managed in Settings |
|---|---|---|
| Built-in | `<dist>/../../skills/` | yes, read-only |
| Added source | local folder or git mirror from `~/.mim/config.yaml` | yes, source-managed |
| Personal | `~/.mim/skills/` | yes, owned |
| Workspace | `{workspace}/skills/` | yes, override escape hatch |

Authored skills use `id === name`. Precedence is last-wins:
`built-in < added sources < personal < workspace`. A higher-precedence skill
with the same name shadows the lower copy; diagnostics retain the shadow chain.

The built-in `build-app` skill teaches the agent to create or debug workspace
skills and apps. It gates app authoring tools such as
`package_create`, `package_validate`, `package_reload`, `app_status`,
`app_enable`, and app runtime test tools until the skill is active.

Enabled apps can also ship `skills/<name>/SKILL.md`. App skills do
not participate in authored-skill shadowing and do not appear in Settings ->
Skills. Their activation id is:

```text
package:<packageId>/<skillName>
```

An app skill cannot be activated by bare name. This prevents an app skill and
a Personal/Workspace skill with the same folder name from silently hijacking
each other.

## Global config

Skill library state lives in `~/.mim/config.yaml`:

```yaml
skillSources:
  team:
    name: Team skills
    git: https://github.com/acme/mim-skills.git
    trusted: true
  local-lab:
    name: Local lab
    path: /Users/me/lab-skills
    trusted: true
skills:
  disabled:
    - issue-work
```

`skills.disabled` contains authored skill names only. It does not target
`package:<packageId>/<skillName>` ids; app skills are controlled by app
enablement/trust.

Git skill sources are cloned/refreshed under
`~/.mim/skill-sources/<sourceId>/`. Local path sources are read in place.
Sources must be inspected and confirmed before they are written to config.

## Progressive disclosure

| Tier | Content | Loaded when | Code path |
|---|---|---|---|
| 0 | `id`, `name`, `description`, descriptive `tools`/`unlocks` | each chat turn | `skill.list` -> `formatSkillCatalogSection` |
| 1 | full `SKILL.md` body plus unlocked tools | model calls `skill(name_or_id)` or composer sends selected `skills[]` | `skill.get`, `activateSelectedSkillsFromRegistry` |
| 2 | referenced files/assets/scripts | when the active skill instructs the agent to read/run them | ordinary file and terminal tools |

Composer skill chips are one-send context and can include multiple skills.
Authored chips use bare names; app-bundled chips use app-qualified ids.

## Tools

- `skill.list` returns active authored skills plus app skills for chat.
  With `{ detailed: true }`, it returns Settings metadata for authored skills
  only, including disabled rows and shadow chains.
- `skill.get` activates an authored name or an app-qualified id and returns
  the skill body.
- `skill.setDisabled` writes global `skills.disabled`.
- `skill.create` creates a Personal skill in `~/.mim/skills/<name>/`.
- `skill.inspectImport` inspects one `SKILL.md` folder before import.
- `skill.import` copies an inspected folder into Personal after
  `confirmed: true`.
- `skill.delete` deletes a Personal skill.
- `skillSource.list` lists trusted user-added sources.
- `skillSource.inspect` previews a local folder or git repo before trust.
- `skillSource.add` writes a trusted source after `confirmed: true`.
- `skillSource.refresh` refreshes a source; git sources fetch and checkout the
  remote default branch, local path sources are re-scanned on demand.
- `skillSource.remove` removes the source config. Git mirrors are deleted;
  local source folders are untouched.

`skill.*` and `skillSource.*` are denied to app actors.

## Tool gating

1. `skill.list` returns enabled skills.
2. `listSkillUnlocks` builds the controlled set from every enabled skill's
   `unlocks`.
3. `createSkillActiveToolPolicy` removes controlled tools from the visible chat
   tool set.
4. `skill(name_or_id)` or composer pre-activation adds that skill's
   `tools ∪ unlocks` to `activeTools`.

The `skill` activation tool itself is never gated.

## Settings panel

Settings -> Skills is a management and audit surface, not an authoring editor.

It shows authored skills grouped as Personal, added sources, Workspace
overrides, and Built-in. App-bundled skills remain in Settings -> Apps under
"Teaches the agent".

Row actions:

- Reveal folder: all authored skills.
- Edit: Personal only, opens `SKILL.md` with the OS default handler.
- Delete: Personal only, after inline confirmation.
- Toggle: all authored skills, writing global `skills.disabled`.

The Add menu is ordered by common intake jobs: Add a source, Import skill from
folder, New Personal skill. Import and source add both show inspection results
before the operation becomes active. Creating a Personal skill reveals the
folder; it does not auto-open an editor.

## App capability display

`package.capabilities.list` scans `{package.dir}/skills/` and returns
`skills: [{ id, label }]` beside jobs and tools. Settings -> Apps renders this
as "Teaches the agent". The scan is lightweight and does not import app backend
code.

## Implementation map

- `src/main/skills.ts` - filesystem loader, source/app identity,
  precedence, shadow diagnostics, disabled filtering.
- `src/main/userConfig.ts` - global `skillSources` and `skills.disabled`
  parsing/writing.
- `src/main/tools/skills.ts` - skill and skill-source tools.
- `src/main/ai/aiRuntime.ts` - skill activation tool, composer
  pre-activation, gated-tool derivation.
- `src/main/ai/systemPrompt.ts` - catalog formatter and standalone prompt path.
- `src/main/tools/packageRuntime.ts` - app capability skill summaries.
- `src/renderer/components/settings/SkillsSettingsPanel.vue` - Settings ->
  Skills.
- `src/renderer/components/settings/AppsSettingsPanel.vue` - app skills
  under app capabilities.
- `src/renderer/components/chat/ChatView.vue` and
  `src/renderer/components/chat/ChatComposer.vue` - composer skill suggestions
  and one-send selected skills.

## Pending

- Agent-authored "save this as a skill" flow.
- Richer source health timestamps in Settings.
