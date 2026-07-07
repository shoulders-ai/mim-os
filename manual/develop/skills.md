---
id: skills
title: skills
order: 3
sources:
  - docs/skills.md
  - docs/custom-apps.md
verified: bf1358ebd68b1348a9fd85c6576c5b71e5f11880
---

# skills

A skill is a folder with a `SKILL.md` file plus optional bundled resources (scripts, reference files, assets). Skills are markdown instruction bundles the agent loads on demand, gating tools until the skill activates.

## SKILL.md format

`SKILL.md` starts with YAML frontmatter:

```markdown
---
name: issue-work
description: Use when the user wants to plan, triage, or update issues.
tools: [issues.list, issues.update]
unlocks: [issues.list, issues.update]
---

# Issue Work
...
```

::: rows
- `name` -- required. Must match the skill folder name.
- `description` -- required. The activation signal shown in the catalog.
- `tools` -- descriptive. Tells the catalog what the skill commonly uses.
- `unlocks` -- the gating list. Tools named here are hidden from chat until the skill activates.
:::

Activation unions `tools` and `unlocks` for backward compatibility. New skills should put gating intent in `unlocks`.

## Discovery and precedence

`createSkillLoader` scans authored roots in this order (last wins):

::: rows
- Built-in -- `<dist>/../../skills/`. Read-only.
- Added source -- local folder or git mirror from `~/.mim/config.yaml`.
- Personal -- `~/.mim/skills/`.
- Workspace -- `{workspace}/skills/`.
:::

A higher-precedence skill with the same name shadows the lower copy. Diagnostics retain the shadow chain.

Git skill sources are cloned under `~/.mim/skill-sources/<sourceId>/`. Local path sources are read in place. Sources must be inspected and confirmed before they are written to config.

## Global config

Skill library state lives in `~/.mim/config.yaml`:

```yaml
skillSources:
  team:
    name: Team skills
    git: https://github.com/acme/mim-skills.git
    trusted: true
skills:
  disabled:
    - issue-work
```

`skills.disabled` contains authored skill names only. It does not target app-qualified skill ids.

## App-bundled skills

An enabled app can ship skills at `{package}/skills/<name>/SKILL.md`, same format as authored skills. The activation id is `package:<packageId>/<skillName>`. App skills are in a separate namespace from authored skills -- they do not shadow or get shadowed by authored skills with the same folder name. They appear in Settings > Apps under "Teaches the agent", not in Settings > Skills.

The `unlocks` frontmatter list names AI tools that stay hidden from the model until the skill activates. Dotted app tool names are matched in their chat form (e.g. `unlocks: [issues_list]` or `unlocks: [issues.list]` both gate the `issues.list` named tool).

## Progressive tool gating

The gating mechanism works in three steps:

1. `skill.list` returns enabled skills with their `unlocks` lists.
2. `createSkillActiveToolPolicy` removes controlled tools from the visible chat tool set.
3. `skill(name_or_id)` or composer pre-activation adds the skill's `tools` and `unlocks` to `activeTools`, making the gated tools available.

The `skill` activation tool itself is never gated.

## Progressive disclosure

The skill system loads content in tiers. Tier 0 (every chat turn): id, name, description, and descriptive tool/unlocks lists via `skill.list`. Tier 1 (on activation): the full `SKILL.md` body plus unlocked tools. Tier 2 (when the skill instructs): referenced files, assets, and scripts through ordinary file and terminal tools.

## Tools

- `skill.list` -- returns active authored and app skills for chat. With `{ detailed: true }`, returns Settings metadata for authored skills including disabled rows and shadow chains.
- `skill.get` -- activates an authored name or app-qualified id and returns the skill body.
- `skill.create` -- creates a Personal skill in `~/.mim/skills/<name>/`.
- `skill.delete` -- deletes a Personal skill.
- `skill.setDisabled` -- writes global `skills.disabled`.
- `skill.templateList` / `skill.templateContent` -- built-in Personal skill starters.
- `skill.inspectImport` / `skill.import` -- inspect and import a skill folder into Personal.
- `skillSource.list` / `skillSource.inspect` / `skillSource.add` / `skillSource.refresh` / `skillSource.remove` -- manage trusted user-added sources.

All `skill.*` and `skillSource.*` tools are denied to app actors.
