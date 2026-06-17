<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Component } from 'vue'
import { Listbox, ListboxButton, ListboxOptions, ListboxOption } from '@headlessui/vue'
import {
  useFloating,
  offset,
  flip,
  shift,
  size as sizeMiddleware,
  autoUpdate,
} from '@floating-ui/vue'
import { IconChevronDown, IconCheck } from '@tabler/icons-vue'

export interface MimSelectOption {
  value: string | number
  label: string
  disabled?: boolean
  icon?: Component
  title?: string
  testId?: string
}

const props = withDefaults(
  defineProps<{
    modelValue: string | number
    options: MimSelectOption[]
    size?: 'sm' | 'md'
    tone?: 'chrome' | 'surface' | 'ghost'
    placement?: 'below' | 'above' | 'auto'
    disabled?: boolean
    ariaLabel?: string
    /** Component shown before the value in the default trigger (e.g. a sort icon). */
    leadingIcon?: Component
    /** Extra classes appended to the trigger button, for call sites that need custom chrome. */
    triggerClass?: string
    /** Extra classes appended to the teleported options panel. */
    optionsClass?: string
    /** Extra classes appended to every option row. */
    optionClass?: string
    /** Attrs applied directly to the Headless UI button, e.g. data-testid. */
    triggerAttrs?: Record<string, unknown>
    /** Attrs applied directly to the Headless UI options panel, e.g. data-testid. */
    optionsAttrs?: Record<string, unknown>
    /** Extra classes for the chevron icon. */
    chevronClass?: string
  }>(),
  {
    size: 'md',
    tone: 'chrome',
    placement: 'below',
    disabled: false,
    ariaLabel: undefined,
    leadingIcon: undefined,
    triggerClass: '',
    optionsClass: '',
    optionClass: '',
    triggerAttrs: () => ({}),
    optionsAttrs: () => ({}),
    chevronClass: '',
  },
)

const emit = defineEmits<{ 'update:modelValue': [value: string | number] }>()

// Let wrapper-level attrs (responsive visibility classes, etc.) land on the root.
defineOptions({ inheritAttrs: false })

const currentOption = computed(
  () => props.options.find(o => o.value === props.modelValue) ?? null,
)
const currentLabel = computed(() => currentOption.value?.label ?? '')

// ── Floating placement ─────────────────────────────────────────────────
// The options panel teleports to <body> so it can never be clipped by an
// overflow-hidden toolbar; floating-ui keeps it pinned to the trigger and
// flips/shifts it to stay on screen.
const referenceEl = ref<HTMLElement | null>(null)
const floatingEl = ref<HTMLElement | null>(null)
const setReference = (el: unknown) =>
  (referenceEl.value = el ? ((el as { $el?: HTMLElement }).$el ?? (el as HTMLElement)) : null)
const setFloating = (el: unknown) =>
  (floatingEl.value = el ? ((el as { $el?: HTMLElement }).$el ?? (el as HTMLElement)) : null)

const floatingPlacement = computed(() =>
  props.placement === 'above' ? ('top-start' as const) : ('bottom-start' as const),
)

// happy-dom (test env) lacks ResizeObserver; autoUpdate needs it. Guard so the
// component degrades to a single positioning pass instead of throwing.
const supportsAutoUpdate = typeof ResizeObserver !== 'undefined'

// ListboxOptions only mounts while open, so element presence tracks open state.
// Passing it to useFloating resets isPositioned on each close, keeping the
// opacity-0 anti-flash guard live on every re-open (not just the first).
const isOpen = computed(() => floatingEl.value != null)

const { floatingStyles, isPositioned } = useFloating(referenceEl, floatingEl, {
  open: isOpen,
  strategy: 'fixed',
  placement: floatingPlacement,
  whileElementsMounted: supportsAutoUpdate ? autoUpdate : undefined,
  middleware: [
    offset(4),
    flip({ padding: 8 }),
    shift({ padding: 8 }),
    sizeMiddleware({
      padding: 8,
      apply({ rects, elements, availableHeight }) {
        Object.assign(elements.floating.style, {
          minWidth: `${rects.reference.width}px`,
          maxHeight: `${Math.min(360, availableHeight)}px`,
        })
      },
    }),
  ],
})

// ── Trigger styling ────────────────────────────────────────────────────
const triggerClasses = computed(() => [
  'mim-select-trigger inline-flex max-w-full min-w-0 items-center gap-1 rounded-[4px] border font-sans outline-none hover:bg-chrome-mid focus-visible:border-accent disabled:opacity-40 disabled:hover:bg-transparent',
  // sm is the quiet toolbar grammar (ink-3, darkens to ink on hover like the
  // controls it replaced); md is the inline form grammar (ink-2, bg-only hover).
  props.size === 'sm' ? 'h-[24px] pl-2 pr-1.5 text-[10px] text-ink-3 hover:text-ink' : 'h-7 pl-2 pr-1.5 text-[11px] text-ink-2',
  props.tone === 'surface' ? 'border-rule-light bg-surface' : '',
  props.tone === 'chrome' ? 'border-rule-light bg-chrome-high' : '',
  props.tone === 'ghost' ? 'border-transparent bg-transparent' : '',
  props.triggerClass,
])

// External chevron is a constant 12 across every native-select site we replaced;
// a leading icon (e.g. sort) sits a touch larger to match its original sizing.
const chevronSize = 12
const leadingIconSize = computed(() => (props.size === 'sm' ? 13 : 14))

function onChange(value: string | number) {
  emit('update:modelValue', value)
}
</script>

<template>
  <Listbox
    class="inline-flex max-w-full min-w-0 align-middle"
    v-bind="$attrs"
    as="div"
    :model-value="modelValue"
    :disabled="disabled"
    @update:model-value="onChange"
  >
    <ListboxButton
      :ref="setReference"
      v-bind="triggerAttrs"
      :class="triggerClasses"
      :aria-label="ariaLabel"
      :title="ariaLabel"
    >
      <slot name="trigger" :label="currentLabel" :option="currentOption">
        <component :is="leadingIcon" v-if="leadingIcon" :size="leadingIconSize" stroke-width="2" class="shrink-0 text-ink-3" />
        <span class="min-w-0 flex-1 truncate text-left">{{ currentLabel }}</span>
      </slot>
      <IconChevronDown :size="chevronSize" stroke-width="2.5" :class="['shrink-0 text-ink-4', chevronClass]" />
    </ListboxButton>

    <Teleport to="body">
      <!--
        Options teleport to <body>. :style is floating-ui's runtime position
        (top/left/transform) — the sanctioned exception to Tailwind-only, never
        color/spacing. @keydown.stop keeps Headless UI's type-ahead from bubbling
        to document-level shortcuts (Headless UI doesn't stopPropagation itself).
      -->
      <ListboxOptions
        :ref="setFloating"
        v-bind="optionsAttrs"
        :style="floatingStyles"
        :class="[
          'mim-select-options z-[var(--z-popover)] max-w-[min(360px,calc(100vw-16px))] overflow-y-auto overscroll-contain rounded-lg border border-rule bg-surface p-1 shadow-[0_8px_30px_rgba(0,0,0,0.18)] focus:outline-none',
          { 'opacity-0': !isPositioned },
          optionsClass,
        ]"
        @keydown.stop
      >
        <ListboxOption
          v-for="opt in options"
          :key="opt.value"
          v-slot="{ active, selected }"
          :value="opt.value"
          :disabled="opt.disabled"
          as="template"
        >
          <li
            :class="[
              'mim-select-option flex items-center gap-2 rounded-[5px] px-2 py-1.5 font-sans text-[12px] text-ink-2 select-none',
              {
                'bg-chrome-high text-ink': active && !selected,
                'bg-accent-tint text-accent': selected,
                'opacity-35': opt.disabled,
              },
              optionClass,
            ]"
            :data-value="opt.value"
            :data-testid="opt.testId"
            :title="opt.title"
          >
            <slot name="option" :option="opt" :active="active" :selected="selected">
              <component :is="opt.icon" v-if="opt.icon" :size="14" stroke-width="2" class="shrink-0" />
              <span class="min-w-0 flex-1 truncate">{{ opt.label }}</span>
              <IconCheck v-if="selected" :size="13" stroke-width="2.5" class="shrink-0" />
            </slot>
          </li>
        </ListboxOption>
      </ListboxOptions>
    </Teleport>
  </Listbox>
</template>
