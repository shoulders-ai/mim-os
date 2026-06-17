<script setup lang="ts">
import { computed, ref } from 'vue'
import { Menu, MenuButton, MenuItems, TransitionRoot } from '@headlessui/vue'
import {
  autoUpdate,
  flip,
  offset,
  shift,
  size as sizeMiddleware,
  useFloating,
} from '@floating-ui/vue'

defineOptions({ inheritAttrs: false })

const props = withDefaults(
  defineProps<{
    placement?: 'bottom-start' | 'bottom-end' | 'top-start' | 'top-end'
    disabled?: boolean
    ariaLabel?: string
    title?: string
    triggerClass?: string
    itemsClass?: string
    triggerAttrs?: Record<string, unknown>
    itemsAttrs?: Record<string, unknown>
    matchTriggerWidth?: boolean
    minWidth?: number
    maxWidth?: number
  }>(),
  {
    placement: 'bottom-start',
    disabled: false,
    ariaLabel: undefined,
    title: undefined,
    triggerClass: '',
    itemsClass: '',
    triggerAttrs: () => ({}),
    itemsAttrs: () => ({}),
    matchTriggerWidth: false,
    minWidth: undefined,
    maxWidth: undefined,
  },
)

const referenceEl = ref<HTMLElement | null>(null)
const floatingEl = ref<HTMLElement | null>(null)

const setReference = (el: unknown) =>
  (referenceEl.value = el ? ((el as { $el?: HTMLElement }).$el ?? (el as HTMLElement)) : null)
const setFloating = (el: unknown) =>
  (floatingEl.value = el ? ((el as { $el?: HTMLElement }).$el ?? (el as HTMLElement)) : null)

const isOpen = computed(() => floatingEl.value != null)
const supportsAutoUpdate = typeof ResizeObserver !== 'undefined'

const { floatingStyles, isPositioned } = useFloating(referenceEl, floatingEl, {
  open: isOpen,
  strategy: 'fixed',
  placement: computed(() => props.placement),
  whileElementsMounted: supportsAutoUpdate ? autoUpdate : undefined,
  middleware: [
    offset(4),
    flip({ padding: 8 }),
    shift({ padding: 8 }),
    sizeMiddleware({
      padding: 8,
      apply({ rects, elements, availableHeight }) {
        const minWidth = props.matchTriggerWidth
          ? Math.max(props.minWidth ?? 0, rects.reference.width)
          : props.minWidth
        Object.assign(elements.floating.style, {
          maxHeight: `${Math.min(360, availableHeight)}px`,
          ...(minWidth ? { minWidth: `${minWidth}px` } : {}),
          ...(props.maxWidth ? { maxWidth: `${props.maxWidth}px` } : {}),
        })
      },
    }),
  ],
})

const triggerClasses = computed(() => [
  'mim-menu-trigger inline-flex min-w-0 items-center outline-none focus-visible:border-accent disabled:opacity-40 disabled:pointer-events-none',
  props.triggerClass,
])

const itemsClasses = computed(() => [
  'mim-menu-items z-[var(--z-popover)] overflow-y-auto overscroll-contain rounded-[6px] border border-rule bg-surface p-1 shadow-[0_8px_30px_rgba(0,0,0,0.18)] focus:outline-none',
  { 'opacity-0': !isPositioned },
  props.itemsClass,
])
</script>

<template>
  <Menu v-slot="{ open, close }" v-bind="$attrs" as="div" class="mim-menu inline-flex min-w-0">
    <MenuButton
      :ref="setReference"
      v-bind="triggerAttrs"
      type="button"
      :disabled="disabled"
      :aria-label="ariaLabel"
      :title="title || ariaLabel"
      :class="triggerClasses"
    >
      <slot name="trigger" :open="open" />
    </MenuButton>

    <Teleport to="body">
      <TransitionRoot
        as="template"
        :show="open"
        enter="transition-opacity ease-out duration-120"
        enter-from="opacity-0"
        enter-to="opacity-100"
        leave="transition-opacity ease-in duration-100"
        leave-from="opacity-100"
        leave-to="opacity-0"
      >
        <MenuItems
          :ref="setFloating"
          v-bind="itemsAttrs"
          static
          :style="floatingStyles"
          :class="itemsClasses"
          @keydown.stop
          @keydown.escape.prevent.stop="close"
        >
          <slot />
        </MenuItems>
      </TransitionRoot>
    </Teleport>
  </Menu>
</template>
