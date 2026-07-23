<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { IconArrowUpRight } from '@tabler/icons-vue'

interface InstructionItem {
  origin: 'personal' | 'team' | 'project' | 'mim'
  label: string
  editorPath: string
  writable: boolean
}

const instructions = ref<InstructionItem[]>([])
const loading = ref(true)
const error = ref('')

async function load() {
  loading.value = true
  error.value = ''
  try {
    const result = await window.kernel.call('instruction.list', {}) as { instructions?: InstructionItem[] }
    instructions.value = result.instructions ?? []
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    loading.value = false
  }
}

async function openInstruction(item: InstructionItem) {
  error.value = ''
  try {
    const result = await window.kernel.call('instruction.open', {
      origin: item.origin,
    }) as { editorPath: string }
    await window.kernel.call('editor.open', { path: result.editorPath })
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}

onMounted(() => {
  void load()
})
</script>

<template>
  <section class="flex min-h-0 flex-1 flex-col text-ink" aria-label="Instructions settings">
    <div class="border-b border-rule-light pb-3">
      <p class="text-[12px] leading-5 text-ink-2">
        These documents compose automatically. More specific Project guidance takes precedence over You, your Team, and Mim.
      </p>
    </div>

    <div v-if="loading" class="py-8 text-center text-[11px] text-ink-3">
      Loading...
    </div>

    <div v-else class="divide-y divide-rule-light">
      <button
        v-for="item in instructions"
        :key="item.origin"
        type="button"
        :data-testid="`instruction-open-${item.origin}`"
        class="flex w-full items-center gap-3 rounded-[4px] px-2 py-3 text-left hover:bg-chrome-mid"
        @click="openInstruction(item)"
      >
        <span class="min-w-0 flex-1">
          <span class="block truncate text-[12px] font-medium text-ink">{{ item.label }}</span>
          <span class="mt-0.5 block text-[10.5px] text-ink-3">
            {{ item.writable ? 'Open and edit in Mim' : 'Open in Mim · read only' }}
          </span>
        </span>
        <IconArrowUpRight :size="14" class="shrink-0 text-ink-3" />
      </button>
    </div>

    <p v-if="error" class="mt-3 text-[11px] text-rem">{{ error }}</p>
  </section>
</template>
