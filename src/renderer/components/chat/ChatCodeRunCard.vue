<script setup>
import { computed, ref } from 'vue'
import { IconPhoto, IconFileTypePdf, IconTable, IconCode, IconFile, IconFileText } from '@tabler/icons-vue'
import { parseCodeRunCard } from './chatCodeRunCard.js'

const props = defineProps({
  part: { type: Object, required: true },
})

const emit = defineEmits(['open-file'])

const vm = computed(() => parseCodeRunCard(props.part))

const outputExpanded = ref(false)

function toggleOutput() {
  outputExpanded.value = !outputExpanded.value
}

function openProduct(path) {
  emit('open-file', path)
}

function kindIcon(kind) {
  switch (kind) {
    case 'image': return IconPhoto
    case 'pdf': return IconFileTypePdf
    case 'table': return IconTable
    case 'html': return IconCode
    case 'text': return IconFileText
    default: return IconFile
  }
}
</script>

<template>
  <div class="my-0.5">
    <!-- Header row: argv line + status -->
    <button
      class="flex items-center gap-[5px] rounded-[4px] bg-transparent px-1 py-[3px] font-mono text-[11px] text-ink-3 hover:bg-chrome-mid hover:text-ink-2"
      :title="vm.status === 'running' ? 'Running...' : 'Show output'"
      @click="toggleOutput"
    >
      <!-- Chevron -->
      <svg class="transition-transform shrink-0" :class="{ 'rotate-90': outputExpanded }" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
      <!-- Terminal icon -->
      <svg class="shrink-0" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
      <!-- Command line -->
      <span class="font-medium truncate">{{ vm.argvLine }}</span>
      <!-- Status indicator -->
      <span v-if="vm.status === 'ok'" class="w-[5px] h-[5px] rounded-full bg-add shrink-0" title="Success" />
      <span v-else-if="vm.status === 'failed'" class="w-[5px] h-[5px] rounded-full bg-rem shrink-0" title="Failed" />
      <span v-else-if="vm.status === 'timed-out'" class="w-[5px] h-[5px] rounded-full bg-warn shrink-0" title="Timed out" />
      <span v-else-if="vm.status === 'error'" class="w-[5px] h-[5px] rounded-full bg-rem shrink-0" title="Error" />
      <span v-else class="cm-tool-spinner shrink-0" />
      <!-- Duration -->
      <span v-if="vm.durationLabel" class="text-ink-4 font-sans text-[10px] shrink-0">{{ vm.durationLabel }}</span>
    </button>

    <!-- Expanded content -->
    <div v-if="outputExpanded" class="mt-1 mb-1 ml-4 border-l-2 border-rule-light pl-2.5">
      <!-- Truncation notice -->
      <div v-if="vm.truncated" class="font-sans text-[10px] text-warn mb-1">Output was truncated</div>
      <!-- Output text -->
      <pre
        v-if="vm.outputText"
        class="font-mono text-[11px] leading-[1.4] text-ink-2 bg-chrome border border-rule-light rounded-[4px] px-2 py-1.5 m-0 overflow-x-auto max-h-[200px] overflow-y-auto whitespace-pre-wrap break-all"
      >{{ vm.outputText }}</pre>
      <div v-else-if="vm.status === 'running'" class="font-sans text-[11px] text-ink-4 italic">Waiting for output...</div>
    </div>

    <!-- Product chips -->
    <div v-if="vm.products.length" class="mt-1 ml-4 flex flex-col gap-0.5">
      <button
        v-for="(product, i) in vm.products"
        :key="i"
        class="flex items-center gap-1.5 rounded-[4px] bg-transparent px-1.5 py-[3px] font-sans text-[12px] text-ink-2 hover:bg-chrome-mid hover:text-ink"
        :title="`Open ${product.basename}`"
        @click="openProduct(product.path)"
      >
        <component :is="kindIcon(product.kind)" class="shrink-0 text-ink-3" :size="13" stroke-width="1.75" />
        <span class="truncate">{{ product.basename }}</span>
        <span v-if="product.sizeLabel" class="text-[10px] text-ink-4 shrink-0">{{ product.sizeLabel }}</span>
      </button>
    </div>
  </div>
</template>
