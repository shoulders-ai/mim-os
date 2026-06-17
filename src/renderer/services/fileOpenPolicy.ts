// 'sniff' = unknown format; resolve by content via resolveSniffTarget.
export type FileOpenTarget = 'editor' | 'pdf' | 'table' | 'native' | 'sniff'
export type ResolvedFileOpenTarget = Exclude<FileOpenTarget, 'sniff'>

const WORD_EXTENSIONS = new Set(['doc', 'docx', 'docm', 'dot', 'dotx', 'dotm'])
const TABLE_EXTENSIONS = new Set(['csv', 'tsv', 'tab'])
const SPREADSHEET_EXTENSIONS = new Set(['xls', 'xlsx', 'xlsm', 'xlsb'])
const PRESENTATION_EXTENSIONS = new Set(['ppt', 'pptx', 'pptm', 'key'])
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'heic', 'tif', 'tiff'])
const ARCHIVE_EXTENSIONS = new Set(['zip', 'tar', 'gz', 'tgz', 'bz2', 'xz', '7z', 'rar'])
const MEDIA_EXTENSIONS = new Set(['mp3', 'mp4', 'mov', 'wav', 'm4a', 'webm'])
const BINARY_NATIVE_EXTENSIONS = new Set([
  'pages',
  'numbers',
  'sqlite',
  'db',
  'dmg',
  'pkg',
  ...WORD_EXTENSIONS,
  ...SPREADSHEET_EXTENSIONS,
  ...PRESENTATION_EXTENSIONS,
  ...IMAGE_EXTENSIONS,
  ...ARCHIVE_EXTENSIONS,
  ...MEDIA_EXTENSIONS,
])

const EDITOR_EXTENSIONS = new Set([
  'md',
  'markdown',
  'mdx',
  'txt',
  'rtf',
  'json',
  'jsonl',
  'yaml',
  'yml',
  'toml',
  'ini',
  'env',
  'xml',
  'html',
  'htm',
  'css',
  'scss',
  'js',
  'mjs',
  'cjs',
  'jsx',
  'ts',
  'tsx',
  'vue',
  'svelte',
  'py',
  'rb',
  'go',
  'rs',
  'java',
  'kt',
  'swift',
  'c',
  'h',
  'cc',
  'cpp',
  'hpp',
  'cs',
  'php',
  'sql',
  'sh',
  'bash',
  'zsh',
  'fish',
  'ps1',
])

const EDITOR_BASENAMES = new Set([
  '.env',
  '.gitignore',
  '.gitattributes',
  '.npmrc',
  'Dockerfile',
  'Makefile',
  'LICENSE',
  'README',
])

export function defaultOpenTargetForPath(path: string): FileOpenTarget {
  if (!path || isAbsolutePath(path)) return 'native'
  const basename = baseName(path)
  if (EDITOR_BASENAMES.has(basename)) return 'editor'
  const ext = extensionOf(path)
  if (ext === 'pdf') return 'pdf'
  if (TABLE_EXTENSIONS.has(ext)) return 'table'
  if (BINARY_NATIVE_EXTENSIONS.has(ext)) return 'native'
  if (EDITOR_EXTENSIONS.has(ext)) return 'editor'
  return 'sniff'
}

const SNIFF_MAX_CHARS = 4_000
const REPLACEMENT_CHAR_RATIO = 0.05

// Resolve a 'sniff' target by reading the file head: text opens in the
// editor, binary-looking or unreadable content falls back to native.
export async function resolveSniffTarget(
  path: string,
  readHead: (path: string) => Promise<string>,
): Promise<ResolvedFileOpenTarget> {
  const target = defaultOpenTargetForPath(path)
  if (target !== 'sniff') return target
  try {
    const head = (await readHead(path)).slice(0, SNIFF_MAX_CHARS)
    if (head.length === 0) return 'editor'
    if (head.includes('\u0000')) return 'native'
    const replacements = head.split('�').length - 1
    return replacements / head.length > REPLACEMENT_CHAR_RATIO ? 'native' : 'editor'
  } catch {
    return 'native'
  }
}

export function isEditorOpenablePath(path: string): boolean {
  const target = defaultOpenTargetForPath(path)
  return target === 'editor' || target === 'table'
}

export function defaultOpenLabelForPath(path: string): string {
  if (WORD_EXTENSIONS.has(extensionOf(path))) return 'Open in Microsoft Word'
  const target = defaultOpenTargetForPath(path)
  if (target === 'editor' || target === 'pdf' || target === 'table') return 'Open in Editor'
  if (target === 'sniff') return 'Open'
  return 'Open in default app'
}

export function fileKindForPath(path: string): string {
  const basename = baseName(path)
  const ext = extensionOf(path)
  if (basename === 'package.json') return 'JSON'
  if (ext === 'md' || ext === 'markdown' || ext === 'mdx') return 'Markdown'
  if (ext === 'json' || ext === 'jsonl') return 'JSON'
  if (ext === 'yaml' || ext === 'yml') return 'YAML'
  if (ext === 'ts' || ext === 'tsx') return 'TypeScript'
  if (ext === 'js' || ext === 'jsx' || ext === 'mjs' || ext === 'cjs') return 'JavaScript'
  if (ext === 'vue') return 'Vue'
  if (WORD_EXTENSIONS.has(ext)) return 'Word'
  if (ext === 'csv') return 'CSV'
  if (ext === 'tsv' || ext === 'tab') return 'TSV'
  if (SPREADSHEET_EXTENSIONS.has(ext)) return 'Spreadsheet'
  if (PRESENTATION_EXTENSIONS.has(ext)) return 'Presentation'
  if (IMAGE_EXTENSIONS.has(ext)) return 'Image'
  if (ARCHIVE_EXTENSIONS.has(ext)) return 'Archive'
  if (ext === 'pdf') return 'PDF'
  if (ext === 'txt') return 'Text'
  if (ext) return ext.toUpperCase()
  return 'File'
}

function baseName(path: string): string {
  return path.replace(/[/\\]+$/, '').split(/[/\\]/).pop() || path
}

function extensionOf(path: string): string {
  const name = baseName(path)
  const dot = name.lastIndexOf('.')
  if (dot <= 0 || dot === name.length - 1) return ''
  return name.slice(dot + 1).toLowerCase()
}

// Absolute paths point outside the workspace-scoped fs.* tools; callers fall
// back to native opening for them.
export function isAbsoluteFilePath(path: string): boolean {
  return path.startsWith('/')
    || path.startsWith('\\\\')
    || /^[A-Za-z]:[\\/]/.test(path)
}

function isAbsolutePath(path: string): boolean {
  return isAbsoluteFilePath(path)
}
