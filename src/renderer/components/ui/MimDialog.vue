<script setup lang="ts">
import { computed } from 'vue'
import {
  Dialog,
  DialogPanel,
  DialogTitle,
  TransitionChild,
  TransitionRoot,
} from '@headlessui/vue'

defineOptions({ inheritAttrs: false })

const props = withDefaults(
  defineProps<{
    open?: boolean
    title?: string
    role?: 'dialog' | 'alertdialog'
    size?: 'sm' | 'md' | 'lg' | 'xl' | 'auto'
    /** 'fixed' pins the panel to a stable viewport-clamped height so its
     *  content (e.g. section switching in Settings) never resizes the dialog. */
    height?: 'content' | 'fixed'
    align?: 'center' | 'top'
    topClass?: string
    initialFocus?: unknown
    panelClass?: string
    backdropClass?: string
    viewportClass?: string
  }>(),
  {
    open: true,
    title: '',
    role: 'dialog',
    size: 'md',
    height: 'content',
    align: 'center',
    topClass: '',
    initialFocus: undefined,
    panelClass: '',
    backdropClass: '',
    viewportClass: '',
  },
)

const emit = defineEmits<{
  'update:open': [open: boolean]
  close: []
}>()

const zClass = computed(() =>
  props.role === 'alertdialog' ? 'z-[var(--z-critical)]' : 'z-[var(--z-modal)]',
)

const viewportClasses = computed(() => [
  'mim-dialog-viewport fixed inset-0 flex px-4',
  props.align === 'top' ? ['items-start justify-center', props.topClass] : 'items-center justify-center py-8',
  props.viewportClass,
])

const sizeClass = computed(() => {
  if (props.size === 'sm') return 'w-[min(420px,calc(100vw-32px))]'
  if (props.size === 'md') return 'w-[min(520px,calc(100vw-32px))]'
  if (props.size === 'lg') return 'w-[min(880px,calc(100vw-48px))]'
  if (props.size === 'xl') return 'w-[min(760px,calc(100vw-48px))]'
  return ''
})

const heightClass = computed(() =>
  props.height === 'fixed' ? 'h-[min(720px,calc(100vh-64px))]' : '',
)

const panelClasses = computed(() => [
  'mim-dialog-panel flex flex-col overflow-hidden rounded-[8px] border border-rule bg-surface shadow-[0_8px_30px_rgba(0,0,0,0.18)]',
  sizeClass.value,
  heightClass.value,
  props.panelClass,
])

const backdropClasses = computed(() => [
  'mim-dialog-backdrop fixed inset-0 bg-black/30',
  props.backdropClass,
])

function requestClose() {
  emit('update:open', false)
  emit('close')
}
</script>

<template>
  <TransitionRoot as="template" :show="open">
    <Dialog
      v-bind="$attrs"
      as="div"
      class="no-drag mim-dialog fixed inset-0"
      :class="zClass"
      :initial-focus="initialFocus"
      :role="role"
      @close="requestClose"
    >
      <TransitionChild
        as="template"
        enter="transition-opacity ease-out duration-120"
        enter-from="opacity-0"
        enter-to="opacity-100"
        leave="transition-opacity ease-in duration-100"
        leave-from="opacity-100"
        leave-to="opacity-0"
      >
        <div :class="backdropClasses" />
      </TransitionChild>

      <div :class="viewportClasses">
        <TransitionChild
          as="template"
          enter="transition-opacity ease-out duration-150"
          enter-from="opacity-0"
          enter-to="opacity-100"
          leave="transition-opacity ease-in duration-100"
          leave-from="opacity-100"
          leave-to="opacity-0"
        >
          <DialogPanel :class="panelClasses">
            <div
              v-if="$slots.title || title"
              class="flex h-10 shrink-0 items-center border-b border-rule-light bg-chrome-high px-3 font-sans"
            >
              <DialogTitle class="text-[12px] font-semibold text-ink">
                <slot name="title">{{ title }}</slot>
              </DialogTitle>
            </div>
            <slot />
          </DialogPanel>
        </TransitionChild>
      </div>
    </Dialog>
  </TransitionRoot>
</template>
