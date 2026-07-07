import { stringify as stringifyYaml } from 'yaml'

export interface SkillTemplateSummary {
  id: string
  label: string
  summary: string
  defaultName: string
  defaultDescription: string
}

export interface RenderedSkillTemplate extends SkillTemplateSummary {
  name: string
  description: string
  content: string
  files?: Record<string, string>
}

interface SkillTemplateDefinition extends SkillTemplateSummary {
  tools: string[]
  unlocks: string[]
  title: string
  body: string
  files?: Record<string, string>
}

const SKILL_TEMPLATES: SkillTemplateDefinition[] = [
  {
    id: 'review-checklist',
    label: 'Review Checklist',
    summary: 'Review a document against a checklist and write a structured report.',
    defaultName: 'review-checklist',
    defaultDescription: 'Use when reviewing a document against a checklist and writing a structured report.',
    tools: ['fs_read', 'fs_write'],
    unlocks: [],
    title: 'Review Checklist',
    body: [
      '## Workflow',
      '',
      '1. Ask for the document path and the checklist if either is missing.',
      '2. Read the source document before judging it.',
      '3. Evaluate each checklist item with a pass, concern, or not-applicable status.',
      '4. Write a concise report with findings, evidence, and recommended fixes.',
      '',
      '## Report Shape',
      '',
      '- Summary of the document reviewed.',
      '- Checklist table with status and evidence.',
      '- Priority fixes, ordered by impact.',
      '- Open questions that need human judgment.',
    ].join('\n'),
  },
  {
    id: 'house-style',
    label: 'House Style',
    summary: 'Apply a house writing style using bundled reference material.',
    defaultName: 'house-style',
    defaultDescription: 'Use when applying the team house style to a draft or reviewing writing for terminology.',
    tools: ['fs_read', 'fs_write'],
    unlocks: [],
    title: 'House Style',
    body: [
      '## Workflow',
      '',
      '1. Read the draft the user wants edited or reviewed.',
      '2. Read `references/glossary.md` before changing terminology.',
      '3. Preserve factual meaning and citations.',
      '4. Prefer direct, specific wording over general claims.',
      '5. Return either an edited draft or a change report, depending on what the user asked for.',
      '',
      '## Style Rules',
      '',
      '- Use active voice unless passive voice avoids assigning false agency.',
      '- Keep headings literal and useful.',
      '- Replace vague intensifiers with concrete evidence.',
      '- Flag any term that conflicts with the glossary instead of silently inventing alternatives.',
    ].join('\n'),
    files: {
      'references/glossary.md': [
        '# Glossary',
        '',
        'Use this file for preferred terms, banned terms, and short rationale.',
        '',
        '## preferred terms',
        '',
        '- participant, not subject',
        '- study site, not center',
        '- protocol deviation, not protocol violation, unless the source uses the formal term',
        '',
        '## terms to check',
        '',
        '- real-world evidence',
        '- endpoint',
        '- safety signal',
      ].join('\n'),
    },
  },
  {
    id: 'r-modelling',
    label: 'R Modelling',
    summary: 'Run R analyses, fit models, and render R Markdown/Quarto reports.',
    defaultName: 'r-modelling',
    defaultDescription: 'Use when running R analyses, fitting models, or rendering R Markdown/Quarto reports.',
    tools: ['bash', 'editor_open', 'fs_read', 'fs_write'],
    unlocks: [],
    title: 'R Modelling',
    body: [
      '## Project Layout',
      '',
      '- `data/` — read-only inputs. Never overwrite source data.',
      '- `analysis/` — R scripts. One script per analysis step.',
      '- `outputs/` — keeper figures and tables produced by scripts.',
      '',
      '## Execution Rules',
      '',
      '- Every analysis is a self-contained script run end-to-end via `bash`. Never pass inline `-e` snippets.',
      '- Set a seed (`set.seed(...)`) at the top of any script involving randomness.',
      '- Save keeper figures explicitly (`ggsave("outputs/fig.png")` or `pdf()`/`dev.off()`). The auto-captured PNGs in `.mim/code-runs/` are previews only.',
      '- After a successful run, open the headline product with `editor_open`.',
      '- On failure, read the stderr tail, fix the script, and re-run.',
      '',
      '## Environment',
      '',
      '- If `renv.lock` is present, run `renv::restore()` before the first analysis.',
      '- When R or quarto is not installed, tell the user exactly what to install rather than failing silently.',
      '',
      '## Rendering',
      '',
      '- `.qmd` files: `quarto render <path>`.',
      '- `.Rmd` files: use quarto if installed, otherwise `Rscript -e "rmarkdown::render(\'<path>\')"`. Then open the produced PDF with `editor_open`.',
      '- If PDF rendering fails with a missing LaTeX/tinytex error, suggest `quarto install tinytex` or render to HTML instead.',
    ].join('\n'),
  },
]

export function listSkillTemplates(): { templates: SkillTemplateSummary[] } {
  return {
    templates: SKILL_TEMPLATES.map(({ id, label, summary, defaultName, defaultDescription }) => ({
      id,
      label,
      summary,
      defaultName,
      defaultDescription,
    })),
  }
}

export function getSkillTemplate(id: string): SkillTemplateDefinition | null {
  return SKILL_TEMPLATES.find(template => template.id === id) ?? null
}

export function renderSkillTemplate(
  templateId: string,
  overrides: { name?: string; description?: string } = {},
): RenderedSkillTemplate {
  const template = getSkillTemplate(templateId)
  if (!template) throw new Error(`Unknown skill template: ${templateId}`)
  const name = cleanOverride(overrides.name) ?? template.defaultName
  const description = cleanOverride(overrides.description) ?? template.defaultDescription
  const frontmatter = stringifyYaml({
    name,
    description,
    tools: template.tools,
    unlocks: template.unlocks,
  }, { lineWidth: 0 }).trimEnd()
  return {
    id: template.id,
    label: template.label,
    summary: template.summary,
    defaultName: template.defaultName,
    defaultDescription: template.defaultDescription,
    name,
    description,
    content: [
      '---',
      frontmatter,
      '---',
      '',
      `# ${template.title}`,
      '',
      template.body,
      '',
    ].join('\n'),
    ...(template.files ? { files: { ...template.files } } : {}),
  }
}

function cleanOverride(value: string | undefined): string | undefined {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  return trimmed.length > 0 ? trimmed : undefined
}
