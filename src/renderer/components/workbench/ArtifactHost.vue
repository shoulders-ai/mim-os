<script setup lang="ts">
import { computed, ref } from 'vue'
import EditorPanel from '../editor/EditorPanel.vue'
import type { ArtifactEntry } from '../../services/workbench/entries.js'
import type { PackageViewDefinition } from '../../services/workbench/packageViews.js'
import type { ArtifactReplacementDecision } from '../../stores/workbench.js'
import type { WorkspaceMoveResult } from '../files/fileMove.js'

interface LoadedPackage {
  manifest: { id: string; name: string; icon?: string; views?: PackageViewDefinition[] }
  dir: string
  source: string
}

const props = defineProps<{
  activeHostId: string
  activeArtifact?: ArtifactEntry | null
  port: number
  packages: LoadedPackage[]
  width?: number
}>()

const emit = defineEmits<{
  selectPackage: [id: string]
  openSession: [id: string]
  openPackageRun: [packageId: string, runId: string]
  artifactActivated: [entry: ArtifactEntry]
  activeFileChanged: [path: string]
  allTabsClosed: []
  openFileDialog: []
  prepareChatDraft: [payload: { targetSessionId?: string | null; text: string; attachments: unknown[]; contextChips?: unknown[] }]
  sendToTerminal: [payload: { text: string; language: string | null }]
}>()

const editorRef = ref<InstanceType<typeof EditorPanel> | null>(null)

const showEditor = computed(() => {
  const artifact = props.activeArtifact
  return !artifact
    || artifact.kind === 'editor'
    || artifact.kind === 'file'
    || artifact.kind === 'external-record'
})

const unsupportedArtifact = computed(() =>
  props.activeArtifact
    && !showEditor.value
    ? props.activeArtifact
    : null
)

function openFile(path: string) {
  editorRef.value?.openFile(path)
}

function openDocument(path: string, kind: 'text' | 'pdf' | 'card' | 'table') {
  return editorRef.value?.openDocument(path, kind)
}

function openReadOnlyTab(name: string, content: string, sourceId: string) {
  return editorRef.value?.openReadOnlyTab?.(name, content, sourceId)
}

function openHistoryForPath(path: string) {
  editorRef.value?.openHistoryForPath?.(path)
}

function retargetDocumentPath(oldPath: string, newPath: string, type: WorkspaceMoveResult['type']) {
  editorRef.value?.retargetDocumentPath?.(oldPath, newPath, type)
}

function newUntitledTab() {
  editorRef.value?.createUntitledTab()
}

function closeActiveTab() {
  editorRef.value?.closeActiveTab?.()
}

function cycleTab(direction: 1 | -1) {
  editorRef.value?.cycleTab?.(direction)
}

function saveActiveFile() {
  return editorRef.value?.saveActiveFile?.() ?? false
}

function saveActiveFileAs() {
  return editorRef.value?.saveActiveFileAs?.() ?? false
}

function openExportDialog() {
  editorRef.value?.openExportDialog?.()
}

function getArtifactReplacementDecision(
  current: ArtifactEntry,
  next: ArtifactEntry | null,
): ArtifactReplacementDecision {
  return editorRef.value?.getArtifactReplacementDecision?.(current, next) ?? 'yes'
}

function adoptTab(tab: unknown) {
  editorRef.value?.adoptTab?.(tab as Parameters<NonNullable<typeof editorRef.value>['adoptTab']>[0])
}

function popOutActiveTab() {
  return editorRef.value?.popOutActiveTab?.()
}

function hasActiveEditorTab(): boolean {
  return editorRef.value?.hasActiveTab?.() ?? false
}

defineExpose({
  openFile,
  openDocument,
  openReadOnlyTab,
  openHistoryForPath,
  retargetDocumentPath,
  newUntitledTab,
  closeActiveTab,
  cycleTab,
  saveActiveFile,
  saveActiveFileAs,
  openExportDialog,
  getArtifactReplacementDecision,
  adoptTab,
  popOutActiveTab,
  hasActiveEditorTab,
})
</script>

<template>
  <aside
    class="flex min-w-[336px] flex-shrink-0 flex-col overflow-hidden bg-chrome-high"
    :style="width ? { width: width + 'px' } : { flex: 1 }"
  >
    <slot name="pane-header" />

    <div class="min-h-0 flex-1 overflow-hidden bg-surface">
      <EditorPanel
        v-show="showEditor"
        ref="editorRef"
        :port="port"
        @artifact-activated="emit('artifactActivated', $event)"
        @active-file-changed="emit('activeFileChanged', $event)"
        @all-tabs-closed="emit('allTabsClosed')"
        @open-file-dialog-requested="emit('openFileDialog')"
        @prepare-chat-draft="emit('prepareChatDraft', $event)"
        @send-to-terminal="emit('sendToTerminal', $event)"
      />

      <div v-if="unsupportedArtifact" class="flex h-full flex-col">
        <div class="flex flex-1 flex-col items-center justify-center px-4 font-sans text-xs text-ink-4">
          <p class="m-0 max-w-[420px] text-center">{{ unsupportedArtifact.title }} cannot open in Artifact yet.</p>
        </div>
      </div>
    </div>
  </aside>
</template>
