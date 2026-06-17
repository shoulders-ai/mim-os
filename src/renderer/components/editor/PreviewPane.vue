<template>
  <div
    ref="rootEl"
    class="preview-content flex-1 min-w-0 py-8 px-9 bg-surface overflow-y-auto overflow-x-hidden font-sans text-ink preview-scroll"
    v-html="safeContent"
  />
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { loadWorkspaceImageDataUrl, resolveImagePath } from './codemirror/livePreview.js'
import { sanitizeHtml } from '../../services/sanitize.js'

const props = defineProps<{
  content: string
  filePath?: string
}>()

const safeContent = computed(() => sanitizeHtml(props.content))

const rootEl = ref<HTMLElement | null>(null)
let imageLoadRun = 0

const TRANSPARENT_PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='

function isExternalImageSrc(src: string): boolean {
  return /^(https?:|data:|blob:)/i.test(src)
}

async function hydrateLocalImages() {
  const run = ++imageLoadRun
  await nextTick()
  if (run !== imageLoadRun || !rootEl.value) return

  const images = Array.from(rootEl.value.querySelectorAll<HTMLImageElement>('img'))
  for (const img of images) {
    const rawSrc = img.getAttribute('src') || ''
    if (!rawSrc || isExternalImageSrc(rawSrc)) continue
    const imagePath = resolveImagePath(rawSrc, props.filePath || '')
    img.dataset.mimImageSrc = imagePath
    img.src = TRANSPARENT_PIXEL
    loadWorkspaceImageDataUrl(imagePath)
      .then((dataUrl) => {
        if (run === imageLoadRun) img.src = dataUrl
      })
      .catch(() => {
        if (run === imageLoadRun) img.alt = img.alt || 'Image not found'
      })
  }
}

onMounted(hydrateLocalImages)
watch(() => [props.content, props.filePath], hydrateLocalImages)

defineExpose({ rootEl })
</script>

<style scoped>
.preview-scroll::-webkit-scrollbar { width: 4px; }
.preview-scroll::-webkit-scrollbar-thumb { background: var(--color-rule); border-radius: 2px; }
</style>

<style>
/* Preview content typography */
.preview-content h1 {
  font-family: var(--font-sans);
  font-size: 26px;
  font-weight: 600;
  letter-spacing: -0.3px;
  margin-bottom: 20px;
  line-height: 1.2;
  color: var(--color-ink);
}
.preview-content h2 {
  font-family: var(--font-sans);
  font-size: 18px;
  font-weight: 600;
  margin: 24px 0 10px;
  color: var(--color-ink);
}
.preview-content h3 {
  font-family: var(--font-sans);
  font-size: 15px;
  font-weight: 500;
  font-style: italic;
  margin: 16px 0 8px;
  color: var(--color-ink);
}
.preview-content h4 {
  font-family: var(--font-sans);
  font-size: 14px;
  font-weight: 600;
  margin: 14px 0 6px;
  color: var(--color-ink);
}
.preview-content p {
  font-size: 14px;
  line-height: 1.75;
  color: var(--color-ink-2);
  margin-bottom: 10px;
  text-align: justify;
  hyphens: auto;
}
.preview-content blockquote {
  border-left: 2px solid var(--color-rule);
  padding: 10px 18px;
  margin: 16px 0;
  font-style: italic;
  color: var(--color-ink-3);
  font-size: 13.5px;
  line-height: 1.65;
}
.preview-content blockquote p {
  margin-bottom: 4px;
}
.preview-content code {
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 12.5px;
  background: var(--color-chrome, #f5f5f0);
  padding: 1px 5px;
  border-radius: 3px;
  color: var(--color-ink);
}
.preview-content pre {
  background: var(--color-chrome, #f5f5f0);
  border-radius: 4px;
  padding: 14px 16px;
  margin: 16px 0;
  overflow-x: auto;
  font-size: 12.5px;
  line-height: 1.55;
}
.preview-content pre code {
  background: none;
  padding: 0;
  border-radius: 0;
  font-size: inherit;
}
.preview-content ul {
  list-style: disc;
  padding-left: 22px;
  margin: 10px 0;
  font-size: 14px;
  line-height: 1.75;
  color: var(--color-ink-2);
}
.preview-content ol {
  list-style: decimal;
  padding-left: 22px;
  margin: 10px 0;
  font-size: 14px;
  line-height: 1.75;
  color: var(--color-ink-2);
}
.preview-content li {
  margin-bottom: 4px;
}
.preview-content li > ul,
.preview-content li > ol {
  margin: 4px 0;
}
.preview-content a {
  color: var(--color-accent);
  text-decoration: underline;
  text-underline-offset: 2px;
  text-decoration-thickness: 1px;
}
.preview-content a:hover {
  text-decoration-thickness: 2px;
}
.preview-content strong {
  font-weight: 600;
  color: var(--color-ink);
}
.preview-content em {
  font-style: italic;
}
.preview-content hr {
  border: none;
  border-top: 1px solid var(--color-rule);
  margin: 24px 0;
}
.preview-content table {
  width: 100%;
  border-collapse: collapse;
  margin: 16px 0;
  font-size: 13.5px;
  line-height: 1.55;
}
.preview-content th {
  font-weight: 600;
  color: var(--color-ink);
  text-align: left;
  padding: 8px 12px;
  border-bottom: 2px solid var(--color-rule);
}
.preview-content td {
  color: var(--color-ink-2);
  padding: 6px 12px;
  border-bottom: 1px solid var(--color-rule);
}
.preview-content img {
  max-width: 100%;
  height: auto;
  border-radius: 4px;
  margin: 12px 0;
}
</style>
