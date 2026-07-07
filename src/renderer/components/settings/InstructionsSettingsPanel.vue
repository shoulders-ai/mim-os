<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import MimDialog from '../ui/MimDialog.vue'

const content = ref('')
const savedContent = ref('')
const defaultContent = ref('')
const loading = ref(true)
const error = ref<string | null>(null)
const justSaved = ref(false)
const confirmingRestore = ref(false)

const isDirty = computed(() => content.value !== savedContent.value)

const TEMPLATE_VARS = [
  { name: '{{DATE_TODAY}}', desc: 'current date' },
  { name: '{{TOOL_SET}}', desc: 'available tools' },
  { name: '{{SKILL_CATALOG}}', desc: 'workspace skills' },
  { name: '{{AGENT_CONTEXT}}', desc: 'runtime workspace state' },
  { name: '{{PROJECT_LOG}}', desc: 'workspace logbook tail' },
  { name: '{{WORKSPACE_TREE}}', desc: 'committed workspace file tree' },
]

async function load() {
  loading.value = true
  error.value = null
  try {
    const defaultResult = await window.kernel.call('workspace.defaultAgentsMd', {}) as { content: string }
    defaultContent.value = defaultResult.content ?? ''
    let fileContent: string | null = null
    try {
      const fileResult = await window.kernel.call('fs.read', { path: 'AGENTS.md', full: true }) as { content?: string }
      fileContent = fileResult.content ?? null
    } catch {
      // AGENTS.md doesn't exist yet — start with the default
    }
    content.value = fileContent ?? defaultContent.value
    savedContent.value = fileContent ?? ''
  } catch (err) {
    error.value = (err as Error).message
  } finally {
    loading.value = false
  }
}

async function save() {
  if (!isDirty.value) return
  error.value = null
  try {
    await window.kernel.call('fs.write', { path: 'AGENTS.md', content: content.value })
    savedContent.value = content.value
    justSaved.value = true
    setTimeout(() => { justSaved.value = false }, 2000)
  } catch (err) {
    error.value = (err as Error).message
  }
}

function requestRestore() {
  confirmingRestore.value = true
}

async function confirmRestore() {
  confirmingRestore.value = false
  content.value = defaultContent.value
  error.value = null
  try {
    await window.kernel.call('fs.write', { path: 'AGENTS.md', content: defaultContent.value })
    savedContent.value = defaultContent.value
    justSaved.value = true
    setTimeout(() => { justSaved.value = false }, 2000)
  } catch (err) {
    error.value = (err as Error).message
  }
}

function onInput(event: Event) {
  content.value = (event.target as HTMLTextAreaElement).value
}

onMounted(() => {
  void load()
})
</script>

<template>
  <section class="flex min-h-0 flex-1 flex-col gap-3 text-ink" aria-label="Instructions settings">
    <div>
      <p class="text-[12px] text-ink-2">
        Edit <span class="font-mono text-[11px]">AGENTS.md</span> — the workspace contract injected into every AI system prompt.
      </p>
    </div>

    <div v-if="loading" class="py-6 text-center text-[11px] text-ink-3">
      Loading...
    </div>

    <template v-else>
      <textarea
        class="min-h-0 flex-1 w-full resize-none rounded-[6px] border border-rule-light bg-surface px-3 py-2.5 font-mono text-[11.5px] leading-5 text-ink outline-none placeholder:text-ink-4 focus:border-accent"
        :value="content"
        @input="onInput"
      />

      <div data-testid="template-vars-annotation" class="mt-1.5 mb-2 text-[10px] text-ink-3">
        <template v-for="(v, i) in TEMPLATE_VARS" :key="v.name">
          <span v-if="i > 0" class="mx-1">&middot;</span>
          <span class="font-mono">{{ v.name }}</span> {{ v.desc }}
        </template>
      </div>

      <div class="flex items-center justify-between gap-2">
        <button
          type="button"
          data-testid="restore-default-btn"
          class="rounded-[5px] border border-rule-light px-3 py-1.5 text-[11.5px] font-medium text-ink-2 hover:bg-chrome-mid"
          @click="requestRestore"
        >
          Restore default
        </button>

        <div class="flex items-center gap-2">
          <span v-if="error" class="text-[11px] text-rem">{{ error }}</span>
          <span v-else-if="justSaved" class="text-[11px] text-ink-3">Saved</span>
          <button
            v-if="isDirty"
            type="button"
            data-testid="save-btn"
            class="rounded-[5px] bg-accent px-3 py-1.5 text-[11.5px] font-medium text-accent-ink hover:bg-accent/90"
            @click="save"
          >
            Save
          </button>
        </div>
      </div>
    </template>

    <MimDialog :open="confirmingRestore" title="Restore default instructions" size="sm" @close="confirmingRestore = false">
      <div class="flex flex-col gap-3 p-4">
        <p class="text-[12px] text-ink-2">
          This will replace the current AGENTS.md content with the default template. The change will be saved immediately.
        </p>
        <div class="flex justify-end gap-2">
          <button
            type="button"
            class="rounded-[5px] px-3 py-1.5 text-[11.5px] font-medium text-ink-2 hover:bg-chrome-mid"
            @click="confirmingRestore = false"
          >
            Cancel
          </button>
          <button
            type="button"
            class="rounded-[5px] bg-accent px-3 py-1.5 text-[11.5px] font-medium text-accent-ink hover:bg-accent/90"
            @click="confirmRestore"
          >
            Restore
          </button>
        </div>
      </div>
    </MimDialog>
  </section>
</template>
