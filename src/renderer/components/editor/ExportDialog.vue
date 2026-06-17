<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { IconChevronRight, IconFileExport } from '@tabler/icons-vue'
import MimDialog from '../ui/MimDialog.vue'
import MimSelect, { type MimSelectOption } from '../ui/MimSelect.vue'
import MimToggle from '../ui/MimToggle.vue'
import SettingRow from '../settings/SettingRow.vue'
import { useToastStore } from '../../stores/toasts.js'
import {
  DEFAULT_EXPORT_OPTIONS,
  defaultOutputName,
  detectCitations,
  loadExportOptions,
  saveExportOptions,
  type ExportUiOptions,
} from '../../services/exportOptions.js'

const props = defineProps<{
  open: boolean
  /** Workspace-relative path of the document; '' for untitled or external docs. */
  documentPath: string
  documentName: string
  markdown: string
}>()

const emit = defineEmits<{
  'update:open': [open: boolean]
  close: []
}>()

const toasts = useToastStore()
const options = ref<ExportUiOptions>({ ...DEFAULT_EXPORT_OPTIONS })
const pageSizeOptions = ref<MimSelectOption[]>([])
const fontOptions = ref<MimSelectOption[]>([])
const catalogLoaded = ref(false)
const bibPath = ref('')
const hasCitations = ref(false)
const exporting = ref(false)
const error = ref('')
const showAdvanced = ref(false)

// Documents opened from absolute paths outside the workspace export from the
// buffer alone; path is still passed for relative-image resolution.
const sourcePath = computed(() => (props.documentPath && !props.documentPath.startsWith('/') ? props.documentPath : ''))
const outputName = computed(() => defaultOutputName(sourcePath.value, props.documentName, options.value.format))

const FORMAT_OPTIONS = [
  { value: 'pdf', label: 'PDF', hint: 'Print-ready, preserves layout' },
  { value: 'docx', label: 'Word', hint: 'Editable .docx file' },
] as const
const formatHint = computed(() =>
  FORMAT_OPTIONS.find(f => f.value === options.value.format)?.hint ?? '')

const PAGE_NUMBER_OPTIONS: MimSelectOption[] = [
  { value: 'none', label: 'Off' },
  { value: 'left', label: 'Left' },
  { value: 'center', label: 'Center' },
  { value: 'right', label: 'Right' },
]

// Everything outside the essential three (format, page size, font) lives behind
// the Advanced fold. Keep settings visible if the user already customized them.
const ADVANCED_KEYS = [
  'marginCm', 'numberedHeadings', 'justify', 'pageNumberPosition', 'pageNumbersSkipFirst',
] as const
const hasCustomAdvanced = () =>
  ADVANCED_KEYS.some(key => options.value[key] !== DEFAULT_EXPORT_OPTIONS[key])

// Chromium's printToPDF stamps every page; only Word can leave the first page
// unnumbered. Say so plainly rather than silently doing nothing for PDF.
const skipFirstHint = computed(() =>
  options.value.format === 'pdf' ? 'Word only — the PDF engine numbers every page' : '')

watch(() => props.open, async (open) => {
  if (!open) return
  exporting.value = false
  error.value = ''
  options.value = loadExportOptions(window.localStorage)
  showAdvanced.value = hasCustomAdvanced()
  hasCitations.value = detectCitations(props.markdown)
  await Promise.all([loadStyleOptions(), discoverBib()])
}, { immediate: true })

async function loadStyleOptions() {
  try {
    const catalog = await window.kernel.call('export.styles') as {
      page_sizes: Array<{ id: string; label: string }>
      fonts: Array<{ id: string; label: string }>
    }
    pageSizeOptions.value = catalog.page_sizes.map(size => ({ value: size.id, label: size.label }))
    fontOptions.value = catalog.fonts.map(font => ({ value: font.id, label: font.label }))
    catalogLoaded.value = true
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}

// Best-effort: export and editor share the same quiet resolver. It auto-picks
// once, persists that pick for normal user calls, and returns nothing when no
// bibliography exists.
async function discoverBib() {
  bibPath.value = ''
  if (!hasCitations.value) return
  try {
    const resolved = await window.kernel.call('references.resolveBibliography', {
      path: sourcePath.value,
      markdown: props.markdown,
    }) as {
      exists?: unknown
      path?: unknown
    }
    if (resolved.exists === true && typeof resolved.path === 'string' && resolved.path) {
      bibPath.value = resolved.path
      return
    }
  } catch {
    // No suggestion.
  }
}

async function chooseBib() {
  const selected = await window.kernel.openFileDialog()
  if (typeof selected === 'string' && selected) bibPath.value = selected
}

async function runExport() {
  if (exporting.value) return
  error.value = ''
  saveExportOptions(window.localStorage, options.value)

  const extension = options.value.format
  const target = await window.kernel.saveFileDialog({
    defaultPath: outputName.value,
    filters: extension === 'pdf'
      ? [{ name: 'PDF', extensions: ['pdf'] }]
      : [{ name: 'Word Document', extensions: ['docx'] }],
    allowAbsolutePath: true,
  })
  if (!target) return

  exporting.value = true
  try {
    const o = options.value
    const params: Record<string, unknown> = {
      markdown: props.markdown,
      output_path: target,
      page_size: o.pageSize,
      margin_cm: o.marginCm,
      font: o.font,
      font_size_pt: o.fontSizePt,
      numbered_headings: o.numberedHeadings,
      justify: o.justify,
      page_number_position: o.pageNumberPosition,
      page_numbers_skip_first: o.pageNumberPosition !== 'none' && o.pageNumbersSkipFirst,
    }
    if (sourcePath.value) params.path = sourcePath.value
    if (hasCitations.value && bibPath.value) {
      params.citation_style = o.citationStyle
      params.bibtex_path = bibPath.value
    }
    const tool = extension === 'pdf' ? 'export.pdf' : 'export.docx'
    const result = await window.kernel.call(tool, params) as {
      path: string
      format: string
      pages?: number
      unresolved_citations?: string[]
    }

    // Export done — close immediately. Command completed, no lingering state.
    close()

    const name = result.path.split('/').pop() ?? result.path
    const pages = result.pages ? ` · ${result.pages} page${result.pages === 1 ? '' : 's'}` : ''
    toasts.push({
      kind: 'info',
      message: `Exported "${name}"${pages}`,
      actionLabel: 'Open',
      action: () => void window.kernel.openNativeFile(result.path),
    })

    const unresolved = result.unresolved_citations ?? []
    if (unresolved.length > 0) {
      toasts.push({
        kind: 'error',
        message: `${unresolved.length} citation${unresolved.length === 1 ? '' : 's'} not found in bibliography`,
        detail: unresolved.join(', '),
      })
    }
  } catch (err) {
    exporting.value = false
    error.value = err instanceof Error ? err.message : String(err)
  }
}

function close() {
  emit('update:open', false)
  emit('close')
}
</script>

<template>
  <MimDialog :open="open" title="Export" size="md" @close="close">
    <div class="flex max-h-[70vh] flex-col overflow-y-auto px-4 py-1 font-sans">

      <SettingRow label="Format" :desc="formatHint">
        <div
          class="inline-flex items-center rounded-[8px] border border-rule-light bg-chrome-mid p-1"
          role="radiogroup"
          aria-label="Export format"
        >
          <button
            v-for="fmt in FORMAT_OPTIONS"
            :key="fmt.value"
            type="button"
            role="radio"
            :aria-checked="options.format === fmt.value"
            :title="fmt.hint"
            class="h-7 rounded-[6px] border px-4 font-sans text-[12px] outline-none focus-visible:border-accent"
            :class="options.format === fmt.value
              ? 'border-rule-light bg-surface font-semibold text-accent'
              : 'border-transparent text-ink-3 hover:text-ink-2'"
            @click="options.format = fmt.value"
          >
            {{ fmt.label }}
          </button>
        </div>
      </SettingRow>

      <SettingRow label="Page size">
        <MimSelect
          :model-value="options.pageSize"
          :options="pageSizeOptions"
          size="md"
          trigger-class="w-[120px]"
          aria-label="Page size"
          @update:model-value="options.pageSize = String($event)"
        />
      </SettingRow>

      <SettingRow label="Body font">
        <div class="flex items-center gap-2">
          <MimSelect
            :model-value="options.font"
            :options="fontOptions"
            size="md"
            trigger-class="w-[150px]"
            aria-label="Body font"
            @update:model-value="options.font = String($event)"
          />
          <span class="flex items-center gap-1.5 text-[11px] text-ink-3">
            <input
              v-model.number="options.fontSizePt"
              type="number"
              min="6"
              max="22"
              step="0.5"
              class="h-7 w-[56px] rounded-[6px] border border-rule-light bg-surface px-2 text-right font-sans text-[12px] text-ink-2 outline-none focus:border-accent"
              aria-label="Font size in points"
            >
            pt
          </span>
        </div>
      </SettingRow>

      <!-- Citations stay visible (only rendered when the document actually
           cites), since getting the bibliography right is not an edge case. -->
      <SettingRow v-if="hasCitations" label="Citations">
        <template #desc>{{ bibPath || 'No .bib file — citations stay as written' }}</template>
        <div class="flex items-center gap-2">
          <MimSelect
            :model-value="options.citationStyle"
            :options="[
              { value: 'apa', label: 'APA' },
              { value: 'chicago', label: 'Chicago' },
              { value: 'ieee', label: 'IEEE' },
            ]"
            size="md"
            trigger-class="w-[110px]"
            aria-label="Citation style"
            @update:model-value="options.citationStyle = $event as 'apa' | 'chicago' | 'ieee'"
          />
          <button
            type="button"
            class="h-7 shrink-0 rounded-[6px] border border-rule-light bg-surface px-2.5 text-[11px] font-medium text-ink-2 hover:bg-chrome-mid hover:text-ink"
            @click="chooseBib"
          >
            Choose .bib
          </button>
        </div>
      </SettingRow>

      <!-- Advanced: layout decisions most exports leave at their defaults. -->
      <button
        type="button"
        class="flex items-center gap-1 border-b border-rule-light py-2.5 text-left text-[12px] text-ink-3 outline-none hover:text-ink focus-visible:text-ink"
        :aria-expanded="showAdvanced"
        @click="showAdvanced = !showAdvanced"
      >
        <IconChevronRight :size="14" stroke-width="2.5" :class="showAdvanced ? 'rotate-90' : ''" />
        Advanced
      </button>

      <template v-if="showAdvanced">
        <SettingRow label="Margins">
          <span class="flex items-center gap-1.5 text-[11px] text-ink-3">
            <input
              v-model.number="options.marginCm"
              type="number"
              min="0"
              max="10"
              step="0.1"
              class="h-7 w-[64px] rounded-[6px] border border-rule-light bg-surface px-2 text-right font-sans text-[12px] text-ink-2 outline-none focus:border-accent"
              aria-label="Page margin in centimetres"
            >
            cm
          </span>
        </SettingRow>

        <SettingRow label="Page numbers" desc="Placement in the footer">
          <MimSelect
            :model-value="options.pageNumberPosition"
            :options="PAGE_NUMBER_OPTIONS"
            size="md"
            trigger-class="w-[110px]"
            aria-label="Page number position"
            @update:model-value="options.pageNumberPosition = $event as ExportUiOptions['pageNumberPosition']"
          />
        </SettingRow>

        <SettingRow v-if="options.pageNumberPosition !== 'none'" label="Skip first page" :desc="skipFirstHint">
          <MimToggle
            v-model="options.pageNumbersSkipFirst"
            :disabled="options.format === 'pdf'"
            aria-label="Skip page number on the first page"
          />
        </SettingRow>

        <SettingRow label="Numbered headings" desc="1, 1.1, 1.1.1">
          <MimToggle v-model="options.numberedHeadings" aria-label="Numbered headings" />
        </SettingRow>

        <SettingRow label="Justify text" desc="Spread lines flush to both margins">
          <MimToggle v-model="options.justify" aria-label="Justify text" />
        </SettingRow>
      </template>

      <!-- Error -->
      <p v-if="error" class="pt-2 text-[11px] leading-snug text-rem" role="alert">{{ error }}</p>
    </div>

    <!-- Footer -->
    <div class="flex h-12 shrink-0 items-center justify-end gap-2 border-t border-rule-light bg-chrome-high px-4">
      <button
        type="button"
        class="h-7 rounded-[5px] px-3 font-sans text-[11px] text-ink-3 hover:bg-chrome-mid hover:text-ink"
        @click="close"
      >
        Cancel
      </button>
      <button
        type="button"
        class="flex h-7 items-center gap-1.5 rounded-[5px] bg-accent px-3 font-sans text-[11px] font-medium text-accent-ink hover:opacity-90 disabled:opacity-50"
        :disabled="exporting || !catalogLoaded"
        data-testid="export-run"
        @click="runExport"
      >
        <IconFileExport :size="13" stroke-width="2" />
        {{ exporting ? 'Exporting…' : `Export ${options.format === 'pdf' ? 'PDF' : 'Word'}` }}
      </button>
    </div>
  </MimDialog>
</template>
