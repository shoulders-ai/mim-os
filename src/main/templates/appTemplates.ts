import { stringify as stringifyYaml } from 'yaml'

export interface AppTemplateSummary {
  id: string
  label: string
  summary: string
  defaultId: string
  defaultName: string
}

export interface PackageCreateTemplateParams {
  id: string
  name: string
  description?: string
  icon?: string
  html?: string
  js?: string
  backend?: string
  skills?: Array<{ name: string; content: string }>
  readme?: string
  permissions?: Record<string, unknown>
  provides?: Record<string, unknown>
  dataFolder?: string
  views?: Array<{ id: string; label: string; src: string; role: 'work' | 'artifact' | 'either' }>
}

interface AppTemplateDefinition extends AppTemplateSummary {
  render(input: { id: string; name: string }): PackageCreateTemplateParams
}

const APP_TEMPLATES: AppTemplateDefinition[] = [
  {
    id: 'word-count',
    label: 'Word Count',
    summary: 'Headless app with one chat-callable named tool.',
    defaultId: 'word-count',
    defaultName: 'Word Count',
    render: renderWordCount,
  },
  {
    id: 'summarize',
    label: 'Summarize',
    summary: 'UI app that starts an AI summarization job.',
    defaultId: 'summarize',
    defaultName: 'Summarize',
    render: renderSummarize,
  },
  {
    id: 'agent',
    label: 'Agent',
    summary: 'Headless app that mounts a specialised agent with its own prompt and skills.',
    defaultId: 'reviewer',
    defaultName: 'Reviewer',
    render: renderAgent,
  },
]

export function listAppTemplates(): { templates: AppTemplateSummary[] } {
  return {
    templates: APP_TEMPLATES.map(({ id, label, summary, defaultId, defaultName }) => ({
      id,
      label,
      summary,
      defaultId,
      defaultName,
    })),
  }
}

export function getAppTemplate(id: string): AppTemplateDefinition | null {
  return APP_TEMPLATES.find(template => template.id === id) ?? null
}

export function renderAppTemplate(
  templateId: string,
  overrides: { id?: string; name?: string } = {},
): PackageCreateTemplateParams {
  const template = getAppTemplate(templateId)
  if (!template) throw new Error(`Unknown app template: ${templateId}`)
  const id = cleanOverride(overrides.id) ?? template.defaultId
  const name = cleanOverride(overrides.name) ?? template.defaultName
  return template.render({ id, name })
}

function renderWordCount(input: { id: string; name: string }): PackageCreateTemplateParams {
  const namespace = toolNamespace(input.id)
  const publicToolName = `${namespace}.analyze`
  const skillName = skillNameForApp(input.id)
  return {
    id: input.id,
    name: input.name,
    description: 'Count words, characters, and lines from pasted text or a workspace text file.',
    icon: 'W',
    backend: wordCountBackend(publicToolName),
    permissions: { workspace: { read: true } },
    provides: {
      tools: [{ name: publicToolName, category: 'read', risk: 'low' }],
    },
    skills: [{
      name: skillName,
      content: appSkillContent({
        name: skillName,
        description: `Use when the user asks for word counts, character counts, line counts, or text length with ${input.name}.`,
        unlocks: [publicToolName],
        title: input.name,
        body: [
          `Call \`${publicToolName}\` when the user asks to count words in pasted text or a workspace file.`,
          '',
          'Ask for a file path or text if the request does not include either.',
        ].join('\n'),
      }),
    }],
    readme: [
      `# ${input.name}`,
      '',
      'A headless starter app that exposes one named tool for counting text.',
      '',
      '## Chat tool',
      '',
      `- \`${publicToolName}\` counts words, characters, non-space characters, and lines.`,
      '',
      'Example prompts:',
      '',
      '- How many words are in `report.md`?',
      '- Count the words in this abstract.',
    ].join('\n'),
  }
}

function renderSummarize(input: { id: string; name: string }): PackageCreateTemplateParams {
  const skillName = skillNameForApp(input.id)
  return {
    id: input.id,
    name: input.name,
    description: 'Summarize pasted text from an app UI using Mim model settings.',
    icon: 'S',
    html: summarizeHtml(input.name),
    js: summarizeJs(),
    backend: summarizeBackend(),
    permissions: { ai: true },
    skills: [{
      name: skillName,
      content: appSkillContent({
        name: skillName,
        description: `Use when the user wants to summarize pasted text with ${input.name}.`,
        unlocks: [],
        title: input.name,
        body: [
          `Open the ${input.name} app when the user wants a visual summarization control surface.`,
          '',
          'For chat-only summarization, answer directly unless the user asks to use the app.',
        ].join('\n'),
      }),
    }],
    readme: [
      `# ${input.name}`,
      '',
      'A UI starter app that starts a backend AI job and streams progress back to the iframe.',
      '',
      '## What it demonstrates',
      '',
      '- `/sdk/mim.js` iframe SDK',
      '- `runtime.jobs.start()`',
      '- `ctx.progress` job events',
      '- `ctx.ai.generateObject()` with manifest permission `ai: true`',
    ].join('\n'),
  }
}

function renderAgent(input: { id: string; name: string }): PackageCreateTemplateParams {
  const skillName = skillNameForApp(input.id)
  return {
    id: input.id,
    name: input.name,
    description: `${input.name} — a specialised agent with its own prompt and skills.`,
    icon: input.name.slice(0, 1).toUpperCase(),
    backend: agentBackend(input.id, input.name, skillName),
    skills: [{
      name: skillName,
      content: appSkillContent({
        name: skillName,
        description: `Activated automatically for the ${input.name} agent. Guides how the agent approaches its task.`,
        unlocks: [],
        title: input.name,
        body: [
          `You are ${input.name}. Follow these guidelines when responding:`,
          '',
          '- Be thorough and precise.',
          '- Cite specific files and locations when referencing workspace content.',
          '- Ask clarifying questions before making assumptions.',
        ].join('\n'),
      }),
    }],
    readme: [
      `# ${input.name}`,
      '',
      `A headless agent app. ${input.name} appears as a row in the sidebar`,
      'and runs in its own chat sessions with a dedicated prompt and skills.',
      '',
      '## How it works',
      '',
      '- `backend/index.mjs` exports an `agents` object with one agent descriptor.',
      `- \`skills/${skillName}/SKILL.md\` is pre-activated each turn.`,
      '- The agent reads app data in `instructions(ctx)` to carry state across sessions.',
      '',
      '## Iterating',
      '',
      '1. Edit the backend or skill.',
      '2. Run `package.validate` to check for errors.',
      '3. Run `package.reload` so the changes take effect.',
      '4. The agent row in the sidebar reflects the updated agent.',
    ].join('\n'),
  }
}

function agentBackend(id: string, name: string, skillName: string): string {
  return [
    'export const agents = {',
    `  ${camelCase(id)}: {`,
    `    name: '${escapeSingleQuote(name)}',`,
    `    // icon: '${name.slice(0, 1).toUpperCase()}',`,
    '',
    '    // Optional: set a default model (user picker still wins)',
    "    // model: 'claude-opus-4-8',",
    '',
    '    // Optional: narrow visible tools to a canonical id allowlist',
    "    // tools: ['search', 'web.read'],",
    '',
    `    skills: ['${skillName}'],`,
    '',
    '    async instructions(ctx) {',
    "      const notes = ctx.data.kv.get('notes')",
    "      const notesSection = notes ? `\\nPrior notes:\\n${notes}` : ''",
    `      return \`You are ${escapeSingleQuote(name)}.`,
    '',
    'Workspace: {{WORKSPACE_TREE}}',
    '',
    `\${notesSection}\``,
    '    },',
    '  },',
    '}',
  ].join('\n')
}

function camelCase(id: string): string {
  return id.replace(/-([a-z])/g, (_, c) => c.toUpperCase())
}

function escapeSingleQuote(value: string): string {
  return value.replace(/'/g, "\\'")
}

function wordCountBackend(publicToolName: string): string {
  return [
    'export const tools = {',
    '  analyze: {',
    `    name: '${publicToolName}',`,
    "    label: 'Analyze word count',",
    "    description: 'Count words, characters, and lines in pasted text or a workspace text file.',",
    '    inputSchema: {',
    "      type: 'object',",
    '      properties: {',
    "        text: { type: 'string', description: 'Text to count directly.' },",
    "        path: { type: 'string', description: 'Workspace text file to read when text is omitted.' },",
    '      },',
    '    },',
    '    async execute(ctx, input) {',
    "      let source = 'text'",
    "      let text = typeof input.text === 'string' ? input.text : ''",
    "      const path = typeof input.path === 'string' ? input.path.trim() : ''",
    '      if (!text && path) {',
    '        text = await ctx.files.readWorkspaceText(path)',
    '        source = path',
    '      }',
    '      const trimmed = text.trim()',
    "      const words = trimmed ? trimmed.split(/\\s+/u).length : 0",
    "      const lines = text.length ? text.split(/\\r\\n|\\r|\\n/u).length : 0",
    '      return {',
    '        source,',
    '        words,',
    '        characters: text.length,',
    "        charactersNoSpaces: text.replace(/\\s/gu, '').length,",
    '        lines,',
    '      }',
    '    },',
    '  },',
    '}',
  ].join('\n')
}

function summarizeBackend(): string {
  return [
    'export const jobs = {',
    '  summarize: {',
    "    label: 'Summarize text',",
    '    inputSchema: {',
    "      type: 'object',",
    '      properties: {',
    "        text: { type: 'string' },",
    "        style: { type: 'string', enum: ['brief', 'bullets', 'executive'] },",
    '      },',
    "      required: ['text'],",
    '    },',
    '    async run(ctx, input) {',
    "      const text = typeof input.text === 'string' ? input.text.trim() : ''",
    "      const style = typeof input.style === 'string' ? input.style : 'brief'",
    '      if (!text) throw new Error(\'Paste text to summarize first\')',
    "      await ctx.progress.step('Preparing summary')",
    "      await ctx.progress.progress(0.25, 'Calling model')",
    '      const result = await ctx.ai.generateObject({',
    "        system: 'Return concise structured summaries as JSON. Do not invent facts beyond the input text.',",
    '        prompt: `Style: ${style}\\n\\nText:\\n${text.slice(0, 12000)}`,',
    '        schema: {',
    "          type: 'object',",
    '          properties: {',
    "            title: { type: 'string' },",
    "            summary: { type: 'string' },",
    "            bullets: { type: 'array', items: { type: 'string' } },",
    '          },',
    "          required: ['summary', 'bullets'],",
    '        },',
    '      })',
    "      await ctx.progress.progress(1, 'Summary ready')",
    '      return {',
    '        style,',
    '        object: result.object ?? result,',
    '        usage: result.usage,',
    '        provider: result.provider,',
    '        modelId: result.modelId,',
    '      }',
    '    },',
    '  },',
    '}',
  ].join('\n')
}

function summarizeHtml(name: string): string {
  return [
    '<!doctype html>',
    '<html>',
    '<head>',
    '  <meta charset="utf-8">',
    `  <title>${escapeHtml(name)}</title>`,
    '  <link rel="stylesheet" href="/sdk/tokens.css">',
    '</head>',
    '<body>',
    '  <main class="card">',
    `    <h1>${escapeHtml(name)}</h1>`,
    '    <form id="summarize-form">',
    '      <label for="text">Text</label>',
    '      <textarea id="text" rows="14" required></textarea>',
    '      <label for="style">Style</label>',
    '      <select id="style">',
    '        <option value="brief">Brief</option>',
    '        <option value="bullets">Bullets</option>',
    '        <option value="executive">Executive</option>',
    '      </select>',
    '      <button type="submit">Summarize</button>',
    '    </form>',
    '    <p id="status" aria-live="polite"></p>',
    '    <pre id="result"></pre>',
    '  </main>',
    '  <script type="module" src="./app.js"></script>',
    '</body>',
    '</html>',
  ].join('\n')
}

function summarizeJs(): string {
  return [
    "import { runtime } from '/sdk/mim.js'",
    '',
    "const form = document.querySelector('#summarize-form')",
    "const text = document.querySelector('#text')",
    "const style = document.querySelector('#style')",
    "const status = document.querySelector('#status')",
    "const result = document.querySelector('#result')",
    '',
    'await runtime.ready',
    '',
    "form.addEventListener('submit', async (event) => {",
    '  event.preventDefault()',
    "  status.textContent = 'Starting summary...'",
    "  result.textContent = ''",
    '  try {',
    '    const started = await runtime.jobs.start(\'summarize\', {',
    '      text: text.value,',
    '      style: style.value,',
    '    }, { openWork: false })',
    '    const off = runtime.jobs.on(started.runId, (jobEvent) => {',
    "      if (jobEvent.type === 'job.progress') status.textContent = jobEvent.data?.label || 'Working...'",
    "      if (jobEvent.type === 'job.step') status.textContent = jobEvent.data?.name || 'Working...'",
    "      if (jobEvent.type === 'job.done') {",
    "        status.textContent = jobEvent.data?.summary || 'Summary ready'",
    '        result.textContent = JSON.stringify(jobEvent.data?.result ?? {}, null, 2)',
    '        off()',
    '      }',
    "      if (jobEvent.type === 'job.failed') {",
    "        status.textContent = jobEvent.data?.error || 'Summary failed'",
    '        off()',
    '      }',
    '    })',
    '  } catch (err) {',
    '    status.textContent = err.message',
    '  }',
    '})',
  ].join('\n')
}

function appSkillContent(input: {
  name: string
  description: string
  unlocks: string[]
  title: string
  body: string
}): string {
  const frontmatter = stringifyYaml({
    name: input.name,
    description: input.description,
    tools: input.unlocks,
    unlocks: input.unlocks,
  }, { lineWidth: 0 }).trimEnd()
  return [
    '---',
    frontmatter,
    '---',
    '',
    `# ${input.title}`,
    '',
    input.body,
    '',
  ].join('\n')
}

function toolNamespace(id: string): string {
  return id.replace(/-/g, '_')
}

function skillNameForApp(id: string): string {
  return id.replace(/_/g, '-')
}

function cleanOverride(value: string | undefined): string | undefined {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  return trimmed.length > 0 ? trimmed : undefined
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
