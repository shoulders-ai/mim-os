<script setup>
import { computed, reactive, ref, watch, onMounted, onUnmounted, onUpdated } from 'vue'
import { marked } from 'marked'
import hljs from 'highlight.js/lib/core'
import javascript from 'highlight.js/lib/languages/javascript'
import typescript from 'highlight.js/lib/languages/typescript'
import python from 'highlight.js/lib/languages/python'
import json from 'highlight.js/lib/languages/json'
import bash from 'highlight.js/lib/languages/bash'
import css from 'highlight.js/lib/languages/css'
import xml from 'highlight.js/lib/languages/xml'
import markdown from 'highlight.js/lib/languages/markdown'
import yaml from 'highlight.js/lib/languages/yaml'
import sql from 'highlight.js/lib/languages/sql'
import c from 'highlight.js/lib/languages/c'
import cpp from 'highlight.js/lib/languages/cpp'
import rust from 'highlight.js/lib/languages/rust'
import go from 'highlight.js/lib/languages/go'
import java from 'highlight.js/lib/languages/java'
import csharp from 'highlight.js/lib/languages/csharp'
import ruby from 'highlight.js/lib/languages/ruby'
import php from 'highlight.js/lib/languages/php'
import swift from 'highlight.js/lib/languages/swift'
import kotlin from 'highlight.js/lib/languages/kotlin'
import r from 'highlight.js/lib/languages/r'
import diff from 'highlight.js/lib/languages/diff'
import dockerfile from 'highlight.js/lib/languages/dockerfile'
import makefile from 'highlight.js/lib/languages/makefile'
import ini from 'highlight.js/lib/languages/ini'
import latex from 'highlight.js/lib/languages/latex'
import { contextPartFilename, isAttachmentPlaceholder, isContextUIPart, isImageType } from '../../services/attachments.js'
import { buildAssistantTurnView, getAssistantTurnElapsedMs } from './assistantTurn.js'
import { sanitizeHtml } from '../../services/sanitize.js'

hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('js', javascript)
hljs.registerLanguage('typescript', typescript)
hljs.registerLanguage('ts', typescript)
hljs.registerLanguage('python', python)
hljs.registerLanguage('json', json)
hljs.registerLanguage('bash', bash)
hljs.registerLanguage('shell', bash)
hljs.registerLanguage('sh', bash)
hljs.registerLanguage('css', css)
hljs.registerLanguage('html', xml)
hljs.registerLanguage('xml', xml)
hljs.registerLanguage('markdown', markdown)
hljs.registerLanguage('md', markdown)
hljs.registerLanguage('yaml', yaml)
hljs.registerLanguage('yml', yaml)
hljs.registerLanguage('sql', sql)
hljs.registerLanguage('c', c)
hljs.registerLanguage('h', c)
hljs.registerLanguage('cpp', cpp)
hljs.registerLanguage('c++', cpp)
hljs.registerLanguage('hpp', cpp)
hljs.registerLanguage('rust', rust)
hljs.registerLanguage('rs', rust)
hljs.registerLanguage('go', go)
hljs.registerLanguage('golang', go)
hljs.registerLanguage('java', java)
hljs.registerLanguage('csharp', csharp)
hljs.registerLanguage('cs', csharp)
hljs.registerLanguage('ruby', ruby)
hljs.registerLanguage('rb', ruby)
hljs.registerLanguage('php', php)
hljs.registerLanguage('swift', swift)
hljs.registerLanguage('kotlin', kotlin)
hljs.registerLanguage('kt', kotlin)
hljs.registerLanguage('r', r)
hljs.registerLanguage('diff', diff)
hljs.registerLanguage('patch', diff)
hljs.registerLanguage('dockerfile', dockerfile)
hljs.registerLanguage('docker', dockerfile)
hljs.registerLanguage('makefile', makefile)
hljs.registerLanguage('make', makefile)
hljs.registerLanguage('ini', ini)
hljs.registerLanguage('toml', ini)
hljs.registerLanguage('latex', latex)
hljs.registerLanguage('tex', latex)

const renderer = new marked.Renderer()
renderer.code = function ({ text, lang }) {
  let highlighted = text
  const language = lang && hljs.getLanguage(lang) ? lang : null
  if (language) {
    try { highlighted = hljs.highlight(text, { language }).value } catch { /* fall back to plain */ }
  }
  const langLabel = lang || ''
  // No <button> here: this HTML goes through the sanitizer, which strips
  // interactive controls (model output must never render them). The copy
  // button is injected as trusted DOM by injectCopyButtons() after render.
  return `<pre class="cm-code-block"><div class="cm-code-header"><span class="cm-code-lang">${langLabel}</span></div><code class="hljs${language ? ` language-${language}` : ''}">${highlighted}</code></pre>`
}

marked.setOptions({ breaks: true, gfm: true, renderer })

const props = defineProps({
  message: { type: Object, required: true },
  isLastAssistant: { type: Boolean, default: false },
  isActiveAssistant: { type: Boolean, default: false },
  chatStatus: { type: String, default: 'ready' },
})

const emit = defineEmits(['open-file', 'retry'])

// --- Helpers ---

function renderMarkdown(text) {
  if (!text) return ''
  return sanitizeHtml(marked.parse(text))
}

function isToolPart(part) {
  if (!part || !part.type) return false
  return part.type.startsWith('tool-') || part.type === 'dynamic-tool'
}

function getToolName(part) {
  if (part.type === 'dynamic-tool') return part.toolName || 'tool'
  // type is "tool-<name>"
  return part.type.replace(/^tool-/, '') || 'tool'
}

function getToolState(part) {
  return part.state || 'done'
}

function getToolInput(part) {
  if (!part.input) return null
  try {
    return typeof part.input === 'string' ? part.input : JSON.stringify(part.input, null, 2)
  } catch { return String(part.input) }
}

function getToolOutput(part) {
  if (part.errorText) return part.errorText
  if (!part.output) return null
  try {
    return typeof part.output === 'string' ? part.output : JSON.stringify(part.output, null, 2)
  } catch { return String(part.output) }
}

function skillPartName(part) {
  return part.output?.skill?.name || part.input?.name || 'skill'
}

function skillPartBody(part) {
  const skill = part.output?.skill
  if (!skill) return ''
  return [skill.description, skill.body].filter(Boolean).join('\n\n')
}

// --- Text extraction ---

const messageText = computed(() => {
  if (props.message.role === 'user') {
    // For user messages, try content first, then text parts
    if (typeof props.message.content === 'string') return props.message.content
    if (Array.isArray(props.message.parts)) {
      return props.message.parts
        .filter(p => p.type === 'text')
        .map(p => p.text)
        .join('\n')
    }
    return ''
  }
  return ''
})

const userFileParts = computed(() => {
  if (props.message.role !== 'user' || !props.message.parts) return []
  return props.message.parts.filter(p => p.type === 'file')
})

const userContextParts = computed(() => {
  if (props.message.role !== 'user' || !props.message.parts) return []
  return props.message.parts.filter(isContextUIPart)
})

function isLiveImage(part) {
  return isImageType(part.mediaType) && !isAttachmentPlaceholder(part) && part.url
}

// --- Assistant parts ---

const assistantParts = computed(() => {
  if (props.message.role !== 'assistant') return []
  return props.message.parts || []
})

// --- Reasoning toggle ---

const expandedReasoning = reactive({})

function toggleReasoning(idx) {
  expandedReasoning[idx] = !expandedReasoning[idx]
}

function isReasoningActive(partIdx) {
  if (!props.isActiveAssistant) return false
  const parts = props.message.parts || []
  const partsAfter = parts.slice(partIdx + 1)
  if (partsAfter.length > 0) return false
  return isActivelyStreaming.value
}

// --- Tool call toggle ---

const expandedTools = reactive({})

function toggleTool(idx) {
  expandedTools[idx] = !expandedTools[idx]
}

// --- Streaming ---

const isActivelyStreaming = computed(() => {
  if (!props.isActiveAssistant) return false
  return ['submitted', 'streaming'].includes(props.chatStatus)
})

const isWaitingForContent = computed(() => {
  if (!props.isActiveAssistant) return false
  if (!isActivelyStreaming.value) return false
  const parts = props.message.parts
  if (!parts || parts.length === 0) return true
  if (parts.some(p => p.type === 'text' && p.text)) return false
  if (parts.some(p => isToolPart(p))) return false
  if (parts.some(p => p.type === 'reasoning' && p.text)) return false
  return true
})

// --- Interrupted turn detection ---
// A turn persisted mid-flight that was never completed: has tool parts
// still pending (not output-available, not error) and is not actively streaming.
const isInterrupted = computed(() => {
  if (props.message.role !== 'assistant') return false
  if (isActivelyStreaming.value) return false
  const parts = props.message.parts || []
  if (parts.length === 0) return false
  return parts.some(p => {
    if (!isToolPart(p)) return false
    const state = p.state || ''
    return state !== 'output-available' && state !== 'error' && state !== 'done'
  })
})

// --- Finished turn details ---

const detailsExpanded = ref(false)

const canCollapseDetails = computed(() =>
  !isActivelyStreaming.value && !(props.isLastAssistant && props.chatStatus === 'error')
)

const assistantTurnView = computed(() =>
  buildAssistantTurnView(assistantParts.value, {
    canCollapse: canCollapseDetails.value,
    detailsExpanded: detailsExpanded.value,
    elapsedMs: getAssistantTurnElapsedMs(props.message),
  })
)

const detailsLabel = computed(() =>
  detailsExpanded.value ? 'Hide Details' : 'Show Details'
)

const detailsAriaLabel = computed(() =>
  [detailsLabel.value, ...assistantTurnView.value.summarySegments].filter(Boolean).join(' · ')
)

function toggleDetails() {
  detailsExpanded.value = !detailsExpanded.value
}

watch(() => [props.message.id, isActivelyStreaming.value, props.chatStatus], () => {
  if (isActivelyStreaming.value || props.chatStatus === 'error') detailsExpanded.value = false
})

// --- Copy ---

const copied = ref(false)

const isSettled = computed(() => {
  if (props.message.role === 'user') return true
  if (!props.isLastAssistant) return true
  return !isActivelyStreaming.value
})

const copyableText = computed(() => {
  if (props.message.role === 'user') return messageText.value
  return (props.message.parts || [])
    .filter(p => p.type === 'text')
    .map(p => p.text || '')
    .join('\n\n')
    .trim()
})

function copyContent() {
  navigator.clipboard.writeText(copyableText.value)
  copied.value = true
  setTimeout(() => { copied.value = false }, 2000)
}

// --- Timestamp ---

const timestamp = computed(() => {
  const d = props.message.createdAt
  if (!d) return ''
  try {
    const date = new Date(d)
    return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  } catch { return '' }
})

// --- File references ---

function openFile(path) {
  emit('open-file', path)
}

// --- Code block copy (delegated click handler) ---

const articleEl = ref(null)

function onCodeCopy(e) {
  const btn = e.target.closest('.cm-code-copy')
  if (!btn) return
  const pre = btn.closest('pre')
  if (!pre) return
  const code = pre.querySelector('code')
  if (!code) return
  navigator.clipboard.writeText(code.textContent || '')
  btn.textContent = 'Copied'
  setTimeout(() => { btn.textContent = 'Copy' }, 2000)
}

// Copy buttons are created here as trusted DOM rather than emitted in the
// markdown HTML: sanitized model output must never contain interactive
// controls. v-html re-renders (each streaming delta) wipe the children, so
// re-inject on every update; headers that already have a button are skipped.
function injectCopyButtons() {
  const root = articleEl.value
  if (!root) return
  for (const header of root.querySelectorAll('.cm-code-header')) {
    if (header.querySelector('.cm-code-copy')) continue
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'cm-code-copy'
    btn.title = 'Copy code'
    btn.textContent = 'Copy'
    header.appendChild(btn)
  }
}

onMounted(() => {
  articleEl.value?.addEventListener('click', onCodeCopy)
  injectCopyButtons()
})

onUpdated(() => {
  injectCopyButtons()
})

onUnmounted(() => {
  articleEl.value?.removeEventListener('click', onCodeCopy)
})
</script>

<template>
  <article ref="articleEl" class="group p-0" :class="message.role === 'user' ? 'flex flex-col items-end gap-0.5' : 'flex flex-col gap-1 select-text [-webkit-user-select:text]'">
    <!-- User message -->
    <div v-if="message.role === 'user'" class="flex flex-col max-w-[75%]">
      <div class="px-[13px] py-2 rounded-[12px_12px_3px_12px] bg-chrome-mid border border-rule-light text-ink font-sans text-[13px] leading-[1.5] whitespace-pre-wrap break-words select-text [-webkit-user-select:text]">
        <!-- File attachments -->
        <div v-if="userFileParts.length || userContextParts.length" class="flex flex-wrap gap-1 mb-1.5">
          <span
            v-for="(part, i) in userContextParts"
            :key="'context-' + i"
            class="inline-flex items-center gap-1 font-sans text-[11px] text-ink-3 bg-chrome px-[7px] py-0.5 rounded-[4px]"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            {{ contextPartFilename(part) }}
          </span>
          <template v-for="(part, i) in userFileParts" :key="'file-' + i">
            <img
              v-if="isLiveImage(part)"
              :src="part.url"
              :alt="part.filename || 'Attached image'"
              class="block max-w-[min(300px,100%)] max-h-[200px] object-contain rounded-[6px] border border-rule-light bg-surface"
            />
            <span v-else-if="isAttachmentPlaceholder(part)" class="font-sans text-[11px] text-ink-3 italic">
              [Attached: {{ part.filename || 'file' }}]
            </span>
            <span v-else class="inline-flex items-center gap-1 font-sans text-[11px] text-ink-3 bg-chrome px-[7px] py-0.5 rounded-[4px]">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
              {{ part.filename || 'Document' }}
            </span>
          </template>
        </div>
        <span v-if="messageText" class="block">{{ messageText }}</span>
      </div>
      <!-- Hover actions -->
      <div class="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 self-start -mt-0.5">
        <button v-if="messageText" class="flex items-center justify-center w-[22px] h-[22px] rounded-[4px] text-ink-3 bg-transparent hover:bg-chrome-mid hover:text-ink-2" @click.stop="copyContent" :title="copied ? 'Copied!' : 'Copy'">
          <svg v-if="!copied" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          <svg v-else width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--color-add)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
        </button>
        <span v-if="timestamp" class="font-sans text-[10px] text-ink-4 px-1">{{ timestamp }}</span>
      </div>
    </div>

    <!-- Assistant message -->
    <template v-else>
      <div v-if="assistantTurnView.hasDetails" class="mb-1">
        <button
          class="flex max-w-full items-start gap-1.5 rounded-[4px] bg-transparent px-1.5 py-0.5 text-left font-sans text-[11px] leading-[1.35] text-ink-3 hover:bg-chrome-mid hover:text-ink-2"
          :aria-expanded="detailsExpanded ? 'true' : 'false'"
          :aria-label="detailsAriaLabel"
          :title="detailsExpanded ? 'Hide details' : 'Show details'"
          @click="toggleDetails"
        >
          <svg class="mt-[2px] shrink-0 transition-transform" :class="{ 'rotate-90': detailsExpanded }" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          <span class="flex min-w-0 max-w-full flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-left">
            <span class="shrink-0 font-medium">{{ detailsLabel }}</span>
            <span
              v-for="segment in assistantTurnView.summarySegments"
              :key="segment"
              class="min-w-0 max-w-full break-words text-left before:mr-1.5 before:text-ink-4 before:content-['·'] [overflow-wrap:anywhere]"
            >
              {{ segment }}
            </span>
          </span>
        </button>
      </div>

      <template v-for="entry in assistantTurnView.entries" :key="`${message.id}-${entry.index}`">
        <!-- Text part -->
        <div v-if="entry.part.type === 'text'" class="cm-text md-content font-sans text-[14px] leading-[1.55] text-ink m-0" v-html="renderMarkdown(entry.part.text)" />

        <!-- Reasoning/thinking -->
        <div v-else-if="entry.part.type === 'reasoning'" class="my-1">
          <button class="flex items-center gap-1 rounded-[4px] bg-transparent px-1 py-0.5 font-sans text-[12px] text-ink-3 hover:bg-chrome-mid hover:text-ink-2" @click="toggleReasoning(entry.index)" title="Show thought process">
            <svg class="transition-transform" :class="{ 'rotate-90': expandedReasoning[entry.index] }" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
            <span v-if="isReasoningActive(entry.index)" class="inline-flex items-center">
              Thinking<span class="cm-thinking-dots"><span>.</span><span>.</span><span>.</span></span>
            </span>
            <span v-else class="inline-flex items-center">Thought process</span>
          </button>
          <div v-if="expandedReasoning[entry.index]" class="cm-reasoning-content md-content mt-1 pl-2.5 border-l-2 border-rule font-sans text-[13px] leading-[1.5] text-ink-3" v-html="renderMarkdown(entry.part.text)" />
        </div>

        <!-- Skill activation -->
        <div v-else-if="entry.part.type === 'tool-skill'" class="my-0.5">
          <button class="flex items-center gap-[5px] rounded-[4px] bg-transparent px-1 py-[3px] font-sans text-[12px] text-ink-3 hover:bg-chrome-mid hover:text-ink-2" @click="toggleTool(entry.index)" title="Show skill instructions">
            <svg class="transition-transform" :class="{ 'rotate-90': expandedTools[entry.index] }" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
            <span>Using skill</span>
            <span class="font-medium text-ink-2">{{ skillPartName(entry.part) }}</span>
            <span v-if="getToolState(entry.part) === 'output-available'" class="w-[5px] h-[5px] rounded-full bg-add shrink-0" />
            <span v-else-if="getToolState(entry.part) !== 'error'" class="cm-tool-spinner shrink-0" />
            <span v-if="entry.part.errorText" class="text-[10px] font-semibold text-rem uppercase">error</span>
          </button>
          <div v-if="expandedTools[entry.index]" class="mt-1 mb-1 ml-4 border-l-2 border-rule-light pl-2.5">
            <div v-if="entry.part.errorText" class="font-sans text-[12px] text-rem">{{ entry.part.errorText }}</div>
            <div v-else-if="skillPartBody(entry.part)" class="md-content font-sans text-[13px] leading-[1.5] text-ink-3" v-html="renderMarkdown(skillPartBody(entry.part))" />
          </div>
        </div>

        <!-- Tool call -->
        <div v-else-if="isToolPart(entry.part)" class="my-0.5">
          <button class="flex items-center gap-[5px] rounded-[4px] bg-transparent px-1 py-[3px] font-mono text-[11px] text-ink-3 hover:bg-chrome-mid hover:text-ink-2" @click="toggleTool(entry.index)" title="Show tool details">
            <svg class="transition-transform" :class="{ 'rotate-90': expandedTools[entry.index] }" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>
            <span class="font-medium">{{ getToolName(entry.part) }}</span>
            <span v-if="getToolState(entry.part) === 'output-available'" class="w-[5px] h-[5px] rounded-full bg-add shrink-0" />
            <span v-else-if="getToolState(entry.part) !== 'output-available' && getToolState(entry.part) !== 'error'" class="cm-tool-spinner shrink-0" />
            <span v-if="entry.part.errorText" class="text-[10px] font-semibold text-rem uppercase">error</span>
          </button>
          <div v-if="expandedTools[entry.index]" class="mt-1 mb-1 ml-4 border-l-2 border-rule-light pl-2.5">
            <div v-if="getToolInput(entry.part)" class="mb-1.5">
              <div class="font-sans text-[10px] font-semibold uppercase text-ink-3 mb-0.5">Input</div>
              <pre class="font-mono text-[11px] leading-[1.4] text-ink-2 bg-chrome border border-rule-light rounded-[4px] px-2 py-1.5 m-0 overflow-x-auto max-h-[200px] overflow-y-auto whitespace-pre-wrap break-all">{{ getToolInput(entry.part) }}</pre>
            </div>
            <div v-if="getToolOutput(entry.part)" class="mb-1.5">
              <div class="font-sans text-[10px] font-semibold uppercase text-ink-3 mb-0.5">{{ entry.part.errorText ? 'Error' : 'Output' }}</div>
              <pre class="font-mono text-[11px] leading-[1.4] bg-chrome border border-rule-light rounded-[4px] px-2 py-1.5 m-0 overflow-x-auto max-h-[200px] overflow-y-auto whitespace-pre-wrap break-all" :class="entry.part.errorText ? 'text-rem' : 'text-ink-2'">{{ getToolOutput(entry.part) }}</pre>
            </div>
          </div>
        </div>

        <!-- Step start part (ignore visually) -->
        <template v-else-if="entry.part.type === 'step-start'" />

        <!-- Source parts -->
        <div v-else-if="entry.part.type === 'source-url'" class="font-sans text-[11px]">
          <a :href="entry.part.url" target="_blank" rel="noopener" class="text-accent no-underline hover:underline">{{ entry.part.title || entry.part.url }}</a>
        </div>
      </template>

      <!-- Streaming dots -->
      <span v-if="isWaitingForContent" class="cm-streaming-dots inline-flex items-center gap-[3px] py-1"><span /><span /><span /></span>

      <!-- Interrupted turn marker -->
      <div v-if="isInterrupted" class="mt-1 flex items-center gap-1.5 rounded-[5px] border border-rule-light bg-chrome-mid px-2.5 py-1.5 font-sans text-[11px] text-ink-3">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        <span>This turn was interrupted and may be incomplete.</span>
      </div>

      <!-- Hover actions for assistant -->
      <div class="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 self-start -mt-0.5">
        <button v-if="copyableText" class="flex items-center justify-center w-[22px] h-[22px] rounded-[4px] text-ink-3 bg-transparent hover:bg-chrome-mid hover:text-ink-2" @click.stop="copyContent" :title="copied ? 'Copied!' : 'Copy'">
          <svg v-if="!copied" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          <svg v-else width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--color-add)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
        </button>
        <button v-if="isSettled && isLastAssistant" class="flex items-center justify-center w-[22px] h-[22px] rounded-[4px] text-ink-3 bg-transparent hover:bg-chrome-mid hover:text-ink-2" @click.stop="emit('retry')" title="Retry">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
        </button>
        <span v-if="timestamp" class="font-sans text-[10px] text-ink-4 px-1">{{ timestamp }}</span>
      </div>
    </template>
  </article>
</template>

<style scoped>
/* ── Markdown text content (:deep required for third-party rendered HTML) ── */
.cm-text.md-content :deep(p) { margin: 0 0 8px; }
.cm-text.md-content :deep(p:last-child) { margin-bottom: 0; }
.cm-text.md-content :deep(ul),
.cm-text.md-content :deep(ol) { margin: 4px 0 8px; padding-left: 20px; }
.cm-text.md-content :deep(li) { margin: 2px 0; }
.cm-text.md-content :deep(code) {
  font-family: var(--font-mono);
  font-size: 11.5px;
  background: var(--color-chrome);
  padding: 1px 4px;
  border-radius: 3px;
  color: var(--color-ink);
}
.cm-text.md-content :deep(pre) {
  position: relative;
  background: var(--color-chrome);
  border: 1px solid var(--color-rule-light);
  border-radius: 5px;
  padding: 10px 12px;
  margin: 8px 0;
  overflow-x: auto;
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.5;
  color: var(--color-ink);
}
.cm-text.md-content :deep(pre.cm-code-block) {
  padding-top: 0;
}
.cm-text.md-content :deep(.cm-code-header) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 0 6px;
  font-family: var(--font-sans);
  font-size: 10px;
}
.cm-text.md-content :deep(.cm-code-lang) {
  color: var(--color-ink-3);
  text-transform: uppercase;
  font-weight: 600;
  letter-spacing: 0.03em;
}
.cm-text.md-content :deep(.cm-code-copy) {
  color: var(--color-ink-3);
  font-size: 10px;
  font-weight: 500;
  padding: 1px 6px;
  border-radius: 3px;
  border: none;
  background: none;
}
.cm-text.md-content :deep(.cm-code-copy:hover) {
  color: var(--color-ink);
  background: var(--color-chrome-mid);
}
.cm-text.md-content :deep(pre code) { background: none; padding: 0; border-radius: 0; }

/* ── Highlight.js syntax colors (uses CSS custom properties from the theme) ── */
.cm-text.md-content :deep(.hljs-keyword),
.cm-text.md-content :deep(.hljs-selector-tag) { color: var(--syntax-keyword); }
.cm-text.md-content :deep(.hljs-string),
.cm-text.md-content :deep(.hljs-addition) { color: var(--syntax-string); }
.cm-text.md-content :deep(.hljs-number),
.cm-text.md-content :deep(.hljs-literal) { color: var(--syntax-number); }
.cm-text.md-content :deep(.hljs-type),
.cm-text.md-content :deep(.hljs-built_in),
.cm-text.md-content :deep(.hljs-class .hljs-title) { color: var(--syntax-type); }
.cm-text.md-content :deep(.hljs-function),
.cm-text.md-content :deep(.hljs-title) { color: var(--syntax-function); }
.cm-text.md-content :deep(.hljs-attr),
.cm-text.md-content :deep(.hljs-property) { color: var(--syntax-property); }
.cm-text.md-content :deep(.hljs-comment),
.cm-text.md-content :deep(.hljs-quote) { color: var(--color-ink-3); font-style: italic; }
.cm-text.md-content :deep(.hljs-meta),
.cm-text.md-content :deep(.hljs-tag) { color: var(--syntax-meta); }
.cm-text.md-content :deep(.hljs-deletion) { color: var(--color-rem); }
.cm-text.md-content :deep(strong) { font-weight: 600; color: var(--color-ink); }
.cm-text.md-content :deep(em) { font-style: italic; }
.cm-text.md-content :deep(h1),
.cm-text.md-content :deep(h2),
.cm-text.md-content :deep(h3) {
  font-family: var(--font-sans);
  color: var(--color-ink);
  margin: 12px 0 6px;
}
.cm-text.md-content :deep(h1) { font-size: 16px; font-weight: 600; }
.cm-text.md-content :deep(h2) { font-size: 14px; font-weight: 600; }
.cm-text.md-content :deep(h3) { font-size: 13px; font-weight: 500; }
.cm-text.md-content :deep(blockquote) {
  border-left: 2px solid var(--color-rule);
  padding-left: 12px;
  color: var(--color-ink-3);
  font-style: italic;
  margin: 8px 0;
}
.cm-text.md-content :deep(a) { color: var(--color-accent); text-decoration: none; }
.cm-text.md-content :deep(a:hover) { text-decoration: underline; }
.cm-text.md-content :deep(hr) { border: none; border-top: 1px solid var(--color-rule-light); margin: 12px 0; }
.cm-text.md-content :deep(table) { border-collapse: collapse; width: 100%; margin: 8px 0; font-size: 12px; }
.cm-text.md-content :deep(th),
.cm-text.md-content :deep(td) { border: 1px solid var(--color-rule-light); padding: 4px 8px; text-align: left; }
.cm-text.md-content :deep(th) { background: var(--color-surface); font-weight: 600; }

/* ── Reasoning expanded content (:deep required for rendered markdown) ── */
.cm-reasoning-content :deep(p) { margin: 0 0 6px; }
.cm-reasoning-content :deep(p:last-child) { margin-bottom: 0; }
.cm-reasoning-content :deep(code) {
  font-family: var(--font-mono);
  font-size: 11px;
  background: var(--color-chrome);
  padding: 1px 3px;
  border-radius: 2px;
}

/* ── Animations ── */
.cm-tool-spinner {
  width: 10px;
  height: 10px;
  border: 1.5px solid var(--color-ink-4);
  border-top-color: var(--color-accent);
  border-radius: 50%;
  animation: cm-spin 0.6s linear infinite;
}

.cm-streaming-dots > span {
  display: inline-block;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--color-accent);
  animation: cm-dot-pulse 1s ease-in-out infinite;
}
.cm-streaming-dots > span:nth-child(2) { animation-delay: 0.15s; }
.cm-streaming-dots > span:nth-child(3) { animation-delay: 0.3s; }

.cm-thinking-dots span { animation: cm-thinking-dot 1.4s ease-in-out infinite; opacity: 0.2; }
.cm-thinking-dots span:nth-child(2) { animation-delay: 0.2s; }
.cm-thinking-dots span:nth-child(3) { animation-delay: 0.4s; }

@keyframes cm-dot-pulse {
  0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
  40% { opacity: 1; transform: scale(1); }
}
@keyframes cm-thinking-dot {
  0%, 80%, 100% { opacity: 0.2; }
  40% { opacity: 1; }
}
@keyframes cm-spin {
  to { transform: rotate(360deg); }
}
</style>
