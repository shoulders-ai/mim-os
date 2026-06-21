import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { userHomeDir } from '@main/platform.js'
import { createSkillLoader } from '@main/skills.js'
import { loadUserConfig } from '@main/userConfig.js'
import { DEFAULT_AGENTS_MD } from '@main/workspace/workspaceContract.js'

export interface SystemPromptOptions {
  includeSkillCatalog?: boolean
  skillCatalog?: string
}

export interface PromptSkillMetadata {
  id?: string
  name: string
  description: string
  tools?: string[]
}

function readFileSafe(path: string): string | null {
  try {
    if (!existsSync(path)) return null
    return readFileSync(path, 'utf-8')
  } catch {
    return null
  }
}

export const TOOL_CATALOG = `File operations:
- fs_read(path, start_line?, limit?, max_chars?) — returns content plus total_lines, total_chars, full-file hash/version, and truncated
- fs_write(path, content) — overwrite an entire file (creates parent directories) after permission approval when required
- fs_edit(path, old_text, new_text) — search-and-replace after permission approval when required; exactly one match required
- fs_create(path, content?) — create a new file after permission approval when required; fails if exists
- fs_delete(path) — delete a file after permission approval when required; directories are refused
- fs_list(path?, recursive?, pattern?, max_entries?, include_last_changed_by?) — capped directory listing with size, modifiedAt, createdAt, and optional best-effort git lastChangedBy metadata; recursive mode skips heavy/generated directories
- fs_mkdir(path) — create directory recursively
- fs_rename(old_path, new_path) — rename/move; fails if destination exists

Cross-surface actions:
- editor_open(path) — open a file in the Editor
- terminal_run(command) — run a shell command in the Terminal

Search:
- search(query, scope?, file_pattern?, max_results?) — full-text search across workspace files and/or session message history. scope: "files", "sessions", or "all" (default). file_pattern: glob filter like "*.md".

Local recovery and sync:
- history_list(path, include_folded?) — list local recovery versions for one file; folded by default so noisy save histories stay usable
- history_preview(path, version_id) — preview a recovery version; text returns content, binary returns metadata
- history_restore(path, version_id) — restore a file to a recovery version; the restore is captured so it can be undone
- sync_status() — plain-language workspace backup/sync state
- sync_now() — run managed sync only when managed mode is enabled; stops on conflicts

Advanced git:
- git_status(), git_diff(path?, staged?), git_log(limit?) — read repository state when the user asks for git-level detail
- git_commit(message), git_pull(), git_push() — mutate the real repository through the permission gate. Do not use these for ordinary recovery; prefer local history.

Web:
- web_search(query, max_results?) — search the web via Exa and return results with title, URL, and snippet. Requires an Exa API key in Settings → Models → Integrations. Use web_read to fetch full content of interesting results.
- web_read(url, max_chars?, timeout_ms?) — fetch a URL and return cleaned, readable markdown content. Extracts the article via Mozilla Readability and strips navigation, ads, and boilerplate. Returns title, content, excerpt, byline, siteName. Only http/https URLs.

Package management:
- package_create(id, name, description, html, js?) — create a new package
- package_edit(id, file, content) — edit a package file
- package_delete(id) — remove a package
- package_list() — list installed packages

Registry and install:
- registry_list() — list packages available in the registry, with install state. Always shows the effective registry URL.
- package_install(id?, version?, repo?, ref?) — install globally to ~/.mim/packages/<id>/<version>/, by registry id or direct repo URL. Verifies the pinned commit, manifest id, engines, and permissions against the registry entry before copying.
- package_update(id) — install the latest registry version side-by-side and repoint the workspace pin if one exists.
- package_uninstall(id, version) — remove an installed version from the global dir.

Enablement:
- Packages are enabled per workspace via the committed mim.yaml apps map (keyed by package id) or the local .mim/packages/enabled.json layer. Global (registry-installed) packages in ~/.mim/packages/ are shared across workspaces; enablement is per workspace.`

export const PACKAGES_SECTION = `Packages are UI extensions that run in sandboxed iframes. Each package lives in packages/{id}/ and contains:
- package.json — manifest with id, name, description, icon, ui path
- ui/index.html — the UI entry point

Packages use the SDK at /sdk/mim.js to interact with the kernel:

\`\`\`html
<!DOCTYPE html>
<html>
<head>
  <link rel="stylesheet" href="/sdk/tokens.css">
</head>
<body>
  <script type="module">
    import { runtime } from '/sdk/mim.js'

    // Call any tool
    const files = await runtime.call('fs.list', { path: '.' })

    // Listen for events
    runtime.on('packages:changed', (data) => { /* ... */ })
  </script>
</body>
</html>
\`\`\`

When the user asks you to build a UI, create a package. Use plain HTML + JS with the SDK. The tokens.css file provides design tokens (--color-ink, --color-accent, --font-sans, etc.) so packages match the Mim aesthetic.`

export function resolveTemplateVars(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => key in vars ? vars[key] : match)
}

function buildLegacyPreamble(weekday: string, date: string): string {
  return `# ROLE

You are the AI agent in Mim, a workspace kernel for research teams. Mim runs as an Electron desktop app with three core surfaces: Chat (you), Editor (document viewer/editor), and Terminal (shell).

Be precise and concise. Flag uncertainty. Never fabricate citations.

Mim may show progress while you work. After finishing, progress may be collapsed. Make the final response stand on its own, including anything important the user needs to know.

Today is ${weekday}, ${date}.


# WORKSPACE

The workspace is a directory on the user's machine. Committed layout:
- mim.yaml — workspace config (name, enabled core apps)
- AGENTS.md — the durable contract for any agent working here
- CLAUDE.md — contract pointer (usually references AGENTS.md)
- issues/ — issue records, one markdown file each (present when the issues app is enabled)
- knowledge/ — knowledge records, one markdown file each (present when the knowledge app is enabled)
- packages/ — installed packages (UI extensions)

Runtime (gitignored, not committed):
- .mim/ — runtime config, event log, chat sessions, and agent-context.md (the volatile current-state digest)

You can read, write, and manage files within the workspace. File mutation tools perform the real filesystem action after the system permission gate allows them. If approval is required, the tool call pauses until the user approves or denies it.


# TOOLS

${TOOL_CATALOG}


# PACKAGES

${PACKAGES_SECTION}`
}

export function getSystemPrompt(workspacePath?: string, options: SystemPromptOptions = {}): string {
  const now = new Date()
  const weekday = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][now.getDay()]
  const date = now.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })

  const agentsContent = workspacePath
    ? readFileSafe(join(workspacePath, 'AGENTS.md'))
    : null

  const isTemplateMode = agentsContent !== null
    ? agentsContent.includes('{{TOOL_SET}}')
    : DEFAULT_AGENTS_MD.includes('{{TOOL_SET}}')

  if (isTemplateMode) {
    const template = agentsContent ?? DEFAULT_AGENTS_MD
    const skillCatalogValue = options.skillCatalog
      ?? (options.includeSkillCatalog !== false ? skillCatalogSection(workspacePath) : null)
      ?? ''
    const agentContext = workspacePath
      ? readFileSafe(join(workspacePath, '.mim', 'agent-context.md')) ?? ''
      : ''
    const vars: Record<string, string> = {
      DATE_TODAY: `${weekday}, ${date}`,
      TOOL_SET: TOOL_CATALOG,
      SKILL_CATALOG: skillCatalogValue,
      AGENT_CONTEXT: agentContext,
    }
    return resolveTemplateVars(template, vars)
  }

  const preamble = buildLegacyPreamble(weekday, date)
  const sections: string[] = [preamble]

  if (options.skillCatalog) {
    sections.push(options.skillCatalog)
  } else if (options.includeSkillCatalog !== false) {
    const skills = skillCatalogSection(workspacePath)
    if (skills) sections.push(skills)
  }

  if (!workspacePath) return sections.join('\n\n\n')

  if (agentsContent !== null) {
    sections.push(`# WORKSPACE CONTRACT (AGENTS.md)\n\n${agentsContent}`)
  }

  const context = readFileSafe(join(workspacePath, '.mim', 'agent-context.md'))
  if (context !== null) {
    sections.push(`# WORKSPACE CONTEXT (.mim/agent-context.md)\n\n${context}`)
  }

  return sections.join('\n\n\n')
}

function skillCatalogSection(workspacePath?: string): string | null {
  const home = userHomeDir()
  const loader = createSkillLoader({
    personalDir: join(home, '.mim', 'skills'),
    getSourceSkillRoots: () => Object.entries(loadUserConfig(home).skillSources)
      .filter(([, source]) => source.trusted === true)
      .map(([id, source]) => ({
        id,
        name: source.name,
        dir: source.path ?? join(home, '.mim', 'skill-sources', id),
      })),
    getWorkspacePath: () => workspacePath,
    getDisabledSkillNames: () => new Set(loadUserConfig(home).skills.disabled),
  })
  const skills = loader.list()
  return formatSkillCatalogSection(skills)
}

export function formatSkillCatalogSection(skills: PromptSkillMetadata[]): string | null {
  if (!skills.length) return null
  return [
    '# SKILLS',
    '',
    'Use skill(name_or_id) when a skill description matches the user request. The skill call returns the full instructions and unlocks its declared tools for the rest of the run.',
    '',
    ...skills.map(skill => `- ${skill.id ?? skill.name}: ${skill.description}${skill.tools?.length ? ` Tools: ${skill.tools.join(', ')}` : ''}`),
  ].join('\n')
}
