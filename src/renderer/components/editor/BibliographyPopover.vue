<script setup lang="ts">
import type { BibliographyCandidate, DocumentCitation } from './editorTypes.js'

defineProps<{
  referenceLibraryActive: boolean
  activeReferencePath: string
  documentCitations: DocumentCitation[]
  bibliographyCandidates: BibliographyCandidate[]
  showBibliographyCandidates: boolean
}>()

const emit = defineEmits<{
  close: []
  openActiveBibliography: []
  jumpToCitation: [key: string]
  useBibliographyCandidate: [path: string]
  'update:showBibliographyCandidates': [value: boolean]
}>()

function citationEntryTitle(entry: DocumentCitation): string {
  return entry.reference?.title || entry.key
}

function citationEntryMeta(entry: DocumentCitation): string {
  const reference = entry.reference
  if (!reference) return ''
  return [reference.author, reference.year].filter(Boolean).join(' · ')
}

function bibliographySourceLabel(source: string): string {
  if (source === 'frontmatter') return 'Document'
  if (source === 'saved') return 'Current'
  if (source === 'default') return 'Project'
  if (source === 'document') return 'Nearby'
  if (source === 'references-folder') return 'References'
  if (source === 'workspace-root') return 'Workspace'
  if (source === 'team') return 'Team'
  return 'Candidate'
}

function bibliographyCandidateDetail(candidate: BibliographyCandidate): string {
  if (candidate.total > 0) return `${candidate.matched}/${candidate.total} citations`
  return bibliographySourceLabel(candidate.source)
}
</script>

<template>
  <div
    class="absolute bottom-8 left-3 z-30 w-[360px] rounded-[7px] border border-rule-light bg-surface p-2 font-sans shadow-lg"
    role="dialog"
    aria-label="Citations in this document"
    data-testid="bibliography-popover"
  >
    <div class="flex items-start justify-between gap-3 border-b border-rule-light pb-2">
      <div class="min-w-0">
        <div class="text-[11px] font-semibold text-ink">Citations in this document</div>
        <div class="mt-0.5 truncate font-mono text-[10px] text-ink-3">
          {{ referenceLibraryActive ? activeReferencePath : 'No .bib found' }}
        </div>
      </div>
      <div class="flex shrink-0 items-center gap-1">
        <button
          v-if="referenceLibraryActive"
          type="button"
          class="h-6 rounded-[4px] px-2 text-[11px] text-ink-3 hover:bg-chrome-mid hover:text-ink"
          @click="emit('openActiveBibliography')"
        >
          Open .bib
        </button>
        <button
          type="button"
          class="flex h-6 w-6 items-center justify-center rounded-[4px] text-[13px] leading-none text-ink-3 hover:bg-chrome-mid hover:text-ink"
          title="Close"
          aria-label="Close references popover"
          @click="emit('close')"
        >
          x
        </button>
      </div>
    </div>

    <div v-if="documentCitations.length > 0" class="max-h-[260px] overflow-y-auto py-1">
      <button
        v-for="entry in documentCitations"
        :key="entry.key"
        type="button"
        class="flex w-full items-baseline gap-2 rounded-[5px] px-2 py-1.5 text-left hover:bg-chrome-mid"
        :title="entry.resolved ? 'Jump to next use' : 'Citation key not found in bibliography'"
        @click="emit('jumpToCitation', entry.key)"
      >
        <span class="min-w-0 flex-1">
          <span
            class="block truncate text-[11px]"
            :class="entry.resolved ? 'text-ink' : 'text-rem'"
          >{{ entry.resolved ? citationEntryTitle(entry) : 'Not found' }}</span>
          <span class="block truncate font-mono text-[10px] text-ink-3">
            @{{ entry.key }}<template v-if="citationEntryMeta(entry)"> &middot; {{ citationEntryMeta(entry) }}</template>
          </span>
        </span>
        <span class="shrink-0 font-mono text-[10px] text-ink-3">{{ entry.occurrences.length > 1 ? `×${entry.occurrences.length}` : '' }}</span>
      </button>
    </div>
    <div v-else class="py-3 text-center text-[11px] text-ink-3">
      No citations in this document.
    </div>

    <div class="border-t border-rule-light pt-1">
      <button
        type="button"
        class="flex w-full items-center justify-between rounded-[5px] px-2 py-1.5 text-[11px] text-ink-3 hover:bg-chrome-mid hover:text-ink"
        @click="emit('update:showBibliographyCandidates', !showBibliographyCandidates)"
      >
        <span>Change bibliography</span>
        <span class="font-mono text-[10px]">{{ bibliographyCandidates.length }} found</span>
      </button>
      <div v-if="showBibliographyCandidates" class="mt-1 max-h-[160px] overflow-y-auto">
        <button
          v-for="candidate in bibliographyCandidates"
          :key="candidate.path"
          type="button"
          class="flex w-full items-center justify-between gap-3 rounded-[5px] px-2 py-1.5 text-left hover:bg-chrome-mid"
          :class="candidate.path === activeReferencePath ? 'text-ink' : 'text-ink-3'"
          @click="emit('useBibliographyCandidate', candidate.path)"
        >
          <span class="min-w-0">
            <span class="block truncate font-mono text-[10px]">{{ candidate.path }}</span>
            <span class="block text-[10px]">{{ bibliographySourceLabel(candidate.source) }}</span>
          </span>
          <span class="shrink-0 font-mono text-[10px] text-ink-3">{{ bibliographyCandidateDetail(candidate) }}</span>
        </button>
        <div v-if="bibliographyCandidates.length === 0" class="px-2 py-2 text-[11px] text-ink-3">
          No bibliography candidates found.
        </div>
      </div>
    </div>
  </div>
</template>
