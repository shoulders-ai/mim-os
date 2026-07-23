import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { readLogbook } from '@main/logbook.js'
import { userHomeDir } from '@main/platform.js'
import { createSkillLoader } from '@main/skills.js'
import { loadUserConfig } from '@main/userConfig.js'
import { DEFAULT_AGENTS_MD } from '@main/workspace/workspaceContract.js'
import { renderWorkspaceTree } from '@main/ai/workspaceTree.js'

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

export const PROJECT_LOG_MAX_CHARS = 6000

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
- bash(command, terminal?, timeout_ms?, capture_plots?) — run a shell command with captured output (exit code, stdout/stderr tails, products). Set terminal:true to type into the visible terminal instead (no capture). Running \`Rscript file.R\` captures plots automatically.

Search:
- search(query, scope?, file_pattern?, max_results?) — full-text search across workspace files and/or session message history. scope: "files", "sessions", or "all" (default). file_pattern: glob filter like "*.md".

Inline review comments:
- comments_list(path) — list inline review comment threads in a file
- comments_add(path, anchor_text, text) — add a comment anchored to a short exact passage copied from the visible text; the anchor must be unique in the document
- comments_reply(path, id, text) — append a reply to an existing thread
- comments_resolve(path, id?, all?) — resolve one thread by id, or every thread with all=true; removes the comment markup and keeps the anchored text

Markdown files store comments inline as pseudo-HTML: <comment id="x1">anchored text<note by="author" at="2026-06-13T09:14">note text</note></comment>. Code and plain-text files store them as whole-line markers in the file's own comment syntax above the anchored line, e.g. "# @mim(x1) author 2026-06-13T09:14: note text" (replies stack as more marker lines with the same id). fs_read returns this markup raw and the editor hides it. Read it for context, but never create, rewrite, or strip comment markup with fs_write/fs_edit — always go through the comments_* tools so anchors, ids, and escaping stay valid.

Project log:
- log_append(message) — append a short durable activity note to .mim/log.md.

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
- web_search(query, max_results?) — search the web via Exa and return results with title, URL, and snippet. Requires an Exa API key in Settings → Models → Integrations. Use web_read to fetch full content from ordinary web results.
- web_read(url, stateful?, max_chars?, start_from_char?, extract_links?, extract_images?, timeout_ms?) — read a URL and return cleaned Markdown. Selectable PDF URLs use local PDF text extraction; ordinary pages render in Chromium so JavaScript-hydrated content is captured. Returns url, final_url, title, content, content_length, source, elapsed_ms, and optional chunk continuation fields. Only http/https URLs; private/loopback addresses and blocked redirects are refused.
- browser_open(url, stateful?, visible?, timeout_ms?, max_chars?, start_from_char?) — open Mim's Markanywhere-style live browser for interactive websites or localhost development servers and return one bounded observation field with compact short refs. Set visible=true only when the user needs to watch or interact with the exact AI-controlled browser session.
- browser_act(action, ref?, text?, direction?, amount?, ms?, wait_ms?, max_chars?, start_from_char?) — operate the live browser. action is one of observe, click, type, scroll, wait, extract, show, hide, close. Observations regenerate refs; refs are valid only for the latest observation. Use start_from_char with max_chars to continue through large pages without reopening.

Use web_read with stateful=false by default for ordinary read-only pages, docs, articles, PDFs, and search-result follow-up. Use browser_open directly when the task requires clicking, typing, scrolling, waiting for lazy-loaded content, dismissing a non-legal cookie banner, or operating a web app. If the page needs sign-in, cookies, or consent already set up through Website Access, use stateful=true; the per-domain approval can be granted directly from chat. If user-assisted login, MFA, CAPTCHA, legal/account consent, or explicit human verification is required, show the live browser with visible=true or browser_act(action="show"), pause, and ask the user to complete the step in that window. Do not ask the user to copy/paste, screenshot, export, or manually browse elsewhere unless browser reading is unavailable or the user explicitly chooses that path.

App management:
- package_create(id, name, description, html, js?) — create a new app
- package_edit(id, file, content) — edit an app file
- package_delete(id) — remove an app
- package_list() — list installed apps

Registry and install:
- registry_list() — list apps available in the registry, with install state. Always shows the effective registry URL.
- package_install(id?, version?, repo?, ref?) — install globally to ~/.mim/packages/<id>/<version>/, by registry id or direct repo URL. Verifies the pinned commit, manifest id, engines, and permissions against the registry entry before copying.
- package_update(id) — install the latest registry version side-by-side and repoint the workspace pin if one exists.
- package_uninstall(id, version) — remove an installed version from the global dir.

Integrations (Slack, Google):
- connections_status() — check connection state for all integrations, including Slack bot accounts referenced by workspace routines. Returns what is configured, authenticated identity, granted scopes, and policy flags. Always available.
- google_set_oauth_client(file?, client_id?, client_secret?, account?) — store a Google OAuth client in the OS keychain. Prefer file: pass the path to a Google Cloud Console JSON download so credentials never enter chat.
- google_connect(oauth?, capabilities?, file?, access_token?, account?) — connect Google. Set oauth=true for browser sign-in (recommended). Or pass a file path to a token bundle JSON.
- google_disconnect(account?) — remove Google tokens from the OS keychain.
- slack_connect(file?, token?, account?) — connect Slack data tools with a user/personal token. Prefer file: pass the path to a token file so the token never enters chat.
- slack_disconnect(account?) — remove a Slack user/personal token from the OS keychain.
- slack_bot_connect(file?, bot_token?, app_token?, account?) — connect a Slack bot listener. Prefer file: pass a JSON file containing bot_token and app_token so credentials stay out of chat.
- slack_bot_disconnect(account?) — remove Slack bot listener tokens from the OS keychain.
- slack_bot_setup(channel, file?, bot_token?, app_token?, account?, mode?, body?) — one-shot workspace Slack bot setup. Creates or updates the Slack routine, enables it locally, stores/verifies credentials when provided, and returns a readiness checklist.
- slack_bot_check(account?, channel?, name?) — check Slack bot readiness without inspecting hidden files: routine binding, local enablement, credentials, and live listener availability.
- connections_configure(integration, aiEnabled?, gmailEnabled?, calendarEnabled?, driveEnabled?, sendEnabled?, ...) — enable or disable Settings > Tools integration capability rows for the AI.

Integration credentials are stored in the OS keychain, not in workspace files. Never write tokens or secrets to settings.json, .mim/, or any file — use the tools above. After connecting, use connections_configure to enable capabilities through the tool policy, then the data tools (gmail_search, calendar_events, drive_search, slack_search, etc.) become available from the next message.

Enablement:
- The committed mim.yaml apps map shares/pins workspace apps for collaborators, but does not enable anyone's sidebar. Local .mim/packages/enabled.json controls the current user's sidebar/capability enablement for this workspace. Use app.add to install/add personally, and app.share to share a registry app with the workspace.`

export const PACKAGES_SECTION = `Apps are UI extensions that run in sandboxed iframes. Each app lives in packages/{id}/ and contains:
- package.json — manifest with id, name, description, icon, ui path
- ui/index.html — the UI entry point

Apps use the SDK at /sdk/mim.js to interact with the kernel:

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

When the user asks you to build a UI, create an app. Use plain HTML + JS with the SDK. The tokens.css file provides design tokens (--color-ink, --color-accent, --font-sans, etc.) so apps match the Mim aesthetic.`

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
- mim.yaml — Project config (name, app pins, skills, registries, sync)
- AGENTS.md — the durable contract for any agent working here
- CLAUDE.md — contract pointer (usually references AGENTS.md)
- issues/ — issue records, one markdown file each (present when the issues app is enabled)
- knowledge/ — knowledge records, one markdown file each (present when the knowledge app is enabled)
- packages/ — installed apps (UI extensions)

Runtime (gitignored, not committed):
- .mim/ — runtime config, Team checkout mount, event log, chat sessions, and agent-context.md (the volatile current-state digest)

Attached-file context blocks with a path attribute identify a workspace-relative file path; use that path with fs.* tools when you need to inspect or edit the file. Direct attachments may only have a name.

You can read, write, and manage files within the workspace. File mutation tools perform the real filesystem action after the system permission gate allows them. If approval is required, the tool call pauses until the user approves or denies it.


# TOOLS

${TOOL_CATALOG}


# APPS

${PACKAGES_SECTION}`
}

export function buildPromptTemplateVars(
  workspacePath: string | undefined,
  options: { skillCatalog?: string } = {},
): Record<string, string> {
  const now = new Date()
  const weekday = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][now.getDay()]
  const date = now.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
  const agentContext = workspacePath
    ? readFileSafe(join(workspacePath, '.mim', 'agent-context.md')) ?? ''
    : ''
  return {
    DATE_TODAY: `${weekday}, ${date}`,
    TOOL_SET: TOOL_CATALOG,
    SKILL_CATALOG: options.skillCatalog ?? '',
    AGENT_CONTEXT: agentContext,
    WORKSPACE_TREE: workspaceTreeContext(workspacePath),
    PROJECT_LOG: projectLogContext(workspacePath),
  }
}

export function getSystemPrompt(workspacePath?: string, options: SystemPromptOptions = {}): string {
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
    const vars = buildPromptTemplateVars(workspacePath, { skillCatalog: skillCatalogValue })
    return resolveTemplateVars(template, vars)
  }

  const now = new Date()
  const weekday = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][now.getDay()]
  const date = now.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })

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

function projectLogContext(workspacePath?: string): string {
  if (!workspacePath) return 'No project log yet.'
  try {
    const log = readLogbook(workspacePath, { maxChars: PROJECT_LOG_MAX_CHARS })
    const content = log.content.trim()
    if (!log.exists || !content) return 'No project log yet.'
    return log.truncated ? `[Most recent entries from .mim/log.md]\n${content}` : content
  } catch {
    return 'No project log yet.'
  }
}

function workspaceTreeContext(workspacePath?: string): string {
  try {
    return renderWorkspaceTree(workspacePath)
  } catch {
    return '# Workspace tree\n\nNo workspace tree available.'
  }
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
