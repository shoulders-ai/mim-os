<script setup lang="ts">
// One xterm instance bound to one pty (live mode) or replaying a static
// scrollback string (replay mode). Tab management, context menus, and pty
// spawn/kill ownership stay with the composer (TerminalPanel owns scratch
// ptys; agent sessions are owned by the main process).
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { useSettingsStore } from '../../stores/settings.js'
import {
  terminalOsShortcutSequence,
  type TerminalKeybindingProfile,
} from './terminalKeybindings.js'

const props = withDefaults(defineProps<{
  // Live mode: pty to subscribe to. May arrive after mount (spawn needs the
  // fitted cols/rows, so composers mount first, then spawn and set this).
  ptyId?: number | null
  // Replay mode: static scrollback text. Mutually exclusive with ptyId.
  replay?: string
  // xterm must be opened only after its container is visible and measurable.
  active?: boolean
  keybindingProfile?: TerminalKeybindingProfile
}>(), {
  active: true,
  keybindingProfile: 'terminal',
})

const emit = defineEmits<{
  // Live pty exited (exit code from the main process).
  exited: [code: number]
  // Live-mode keystrokes arriving while no pty is bound (e.g. after exit) —
  // lets the composer implement restart-on-Enter.
  input: [data: string]
}>()

const containerEl = ref<HTMLElement | null>(null)
const settingsStore = useSettingsStore()
const isReplay = computed(() => props.replay != null)

let terminal: Terminal | null = null
let fitAddon: FitAddon | null = null
let resizeObserver: ResizeObserver | null = null
// Kernel listeners are tracked per bound pty so a ptyId change or exit
// detaches exactly what was attached.
let boundPtyId: number | null = null
let outputCb: ((data: unknown) => void) | null = null
let exitCb: ((data: unknown) => void) | null = null
let connected = false
let terminalOpened = false
let pendingOutput = ''
const scheduledFrames = new Set<number>()
let openFrame: number | null = null

function containerSnapshot(el: HTMLElement) {
  const rect = el.getBoundingClientRect()
  const style = getComputedStyle(el)
  return {
    width: Math.round(rect.width),
    height: Math.round(rect.height),
    display: style.display,
    visibility: style.visibility,
    isConnected: el.isConnected,
  }
}

/* ── Theme (reads the active theme's CSS custom properties) ── */

const ANSI_LIGHT = {
  black: '#1a1a18',   red: '#b8432a',     green: '#4a7530',   yellow: '#a07018',
  blue: '#3a6888',    magenta: '#6840cc',  cyan: '#488070',    white: '#c8c8c0',
  brightBlack: '#6a6a64', brightRed: '#c85848', brightGreen: '#5a8a3e',
  brightYellow: '#b88020', brightBlue: '#4a80a8', brightMagenta: '#7c5cd0',
  brightCyan: '#5a9e8f',   brightWhite: '#e0e0dc',
}
const ANSI_DARK = {
  black: '#505050',   red: '#e07070',     green: '#7cc68a',   yellow: '#f0c060',
  blue: '#6ba0c0',    magenta: '#b39dff', cyan: '#7cc6b6',    white: '#d0d0c8',
  brightBlack: '#888888', brightRed: '#f09090', brightGreen: '#98d8a0',
  brightYellow: '#f8d888', brightBlue: '#88b8d8', brightMagenta: '#ccb8ff',
  brightCyan: '#98dcd0',   brightWhite: '#f5f5f0',
}

function isDarkTheme(): boolean {
  const surface = getComputedStyle(document.documentElement)
    .getPropertyValue('--color-surface').trim()
  if (!surface) return false
  const c = surface.replace('#', '')
  const [r, g, b] = [0, 2, 4].map(i => parseInt(c.slice(i, i + 2), 16))
  return (r + g + b) / 3 < 128
}

function getTheme() {
  const style = getComputedStyle(document.documentElement)
  const get = (v: string) => style.getPropertyValue(v).trim()
  const accent = get('--color-accent') || '#c05d3c'
  const ansi = isDarkTheme() ? ANSI_DARK : ANSI_LIGHT
  return {
    background: get('--color-surface') || '#ffffff',
    foreground: get('--color-ink-2') || '#4a4a44',
    cursor: accent,
    cursorAccent: get('--color-surface') || '#ffffff',
    selectionBackground: accent + '33',
    selectionForeground: undefined,
    ...ansi,
  }
}

/* ── Fit ── */
function fit() {
  try {
    const el = containerEl.value
    if (!el || !terminal || !fitAddon || !terminalOpened) return
    const rect = el.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return
    fitAddon.fit()
    if (!isReplay.value && connected && props.ptyId != null && terminal.cols > 0 && terminal.rows > 0) {
      window.kernel.call('terminal.resize', {
        id: props.ptyId,
        cols: terminal.cols,
        rows: terminal.rows,
      })
    }
  } catch { /* container might not be visible */ }
}

function afterNextPaint(callback: () => void) {
  void nextTick(() => {
    if (!terminal) return
    if (typeof window.requestAnimationFrame !== 'function') {
      callback()
      return
    }

    let frame = 0
    frame = window.requestAnimationFrame(() => {
      scheduledFrames.delete(frame)
      callback()
    })
    scheduledFrames.add(frame)
  })
}

function cancelScheduledFrames() {
  if (typeof window.cancelAnimationFrame === 'function') {
    for (const frame of scheduledFrames) window.cancelAnimationFrame(frame)
    if (openFrame !== null) window.cancelAnimationFrame(openFrame)
  }
  scheduledFrames.clear()
  openFrame = null
}

function flushPendingOutput() {
  if (!terminal || !terminalOpened || !pendingOutput) return
  const output = pendingOutput
  pendingOutput = ''
  terminal.write(output)
}

function writePtyOutput(data: unknown) {
  const output = typeof data === 'string' ? data : String(data ?? '')
  if (!output) return
  if (!terminal || !terminalOpened) {
    pendingOutput += output
    return
  }
  terminal.write(output)
}

function refitAfterPaint() {
  afterNextPaint(() => {
    fit()
    flushPendingOutput()
  })
}

function focusTerminal() {
  if (!terminal || isReplay.value) return
  if (!terminalOpened) {
    scheduleOpenWhenReady(true)
    return
  }
  terminal.focus()
  afterNextPaint(() => {
    fit()
    flushPendingOutput()
    if (!terminal || isReplay.value) return
    terminal.focus()
  })
}

function openWhenReady(shouldFocus = false): boolean {
  if (!terminal || terminalOpened) {
    if (terminalOpened) {
      fit()
      flushPendingOutput()
      if (shouldFocus) focusTerminal()
      return true
    }
    return false
  }

  const el = containerEl.value
  if (!el) return false
  const snapshot = containerSnapshot(el)
  if (!props.active) return false
  if (snapshot.width <= 0 || snapshot.height <= 0) return false
  if (snapshot.display === 'none' || snapshot.visibility === 'hidden') return false

  terminal.open(el)
  terminalOpened = true
  fit()
  flushPendingOutput()
  if (isReplay.value && props.replay) terminal.write(props.replay)
  if (shouldFocus) focusTerminal()
  return true
}

function scheduleOpenWhenReady(shouldFocus = false) {
  if (openFrame !== null || terminalOpened || !props.active) return

  void nextTick(() => {
    if (openFrame !== null || terminalOpened || !props.active) return
    if (typeof window.requestAnimationFrame !== 'function') {
      openWhenReady(shouldFocus)
      return
    }
    openFrame = window.requestAnimationFrame(() => {
      openFrame = null
      openWhenReady(shouldFocus)
    })
  })
}

/* ── Pty binding (live mode) ── */
function unbindPty() {
  if (boundPtyId !== null) {
    if (outputCb) window.kernel.off(`pty:output:${boundPtyId}`, outputCb)
    if (exitCb) window.kernel.off(`pty:exit:${boundPtyId}`, exitCb)
  }
  boundPtyId = null
  outputCb = null
  exitCb = null
  connected = false
}

function bindPty(id: number) {
  unbindPty()
  const onOutput = (data: unknown) => {
    writePtyOutput(data)
  }
  const onExit = (data: unknown) => {
    unbindPty()
    emit('exited', typeof data === 'number' ? data : 0)
  }
  boundPtyId = id
  outputCb = onOutput
  exitCb = onExit
  connected = true
  window.kernel.on(`pty:output:${id}`, onOutput)
  window.kernel.on(`pty:exit:${id}`, onExit)
  if (terminalOpened) {
    fit()
    flushPendingOutput()
    focusTerminal()
  } else {
    scheduleOpenWhenReady(true)
  }
}

watch(() => props.ptyId, (id) => {
  if (isReplay.value) return
  if (id != null) bindPty(id)
  else unbindPty()
}, { immediate: true, flush: 'sync' })

watch(() => props.active, (active) => {
  if (!active) return
  scheduleOpenWhenReady(true)
  refitAfterPaint()
}, { flush: 'post' })

/* ── Theme reactivity ── */
watch(() => settingsStore.theme, () => {
  // Theme CSS vars update via the data-theme attribute; re-read computed styles.
  nextTick(() => {
    if (terminal) terminal.options.theme = getTheme()
  })
})

/* ── Lifecycle ── */
onMounted(() => {
  terminal = new Terminal({
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 12,
    lineHeight: 1.3,
    theme: getTheme(),
    cursorBlink: true,
    cursorStyle: 'bar',
    scrollback: 5000,
    allowProposedApi: true,
    linkHandler: {
      activate(_event: MouseEvent, uri: string) {
        window.kernel.openExternal(uri)
      },
    },
  })
  fitAddon = new FitAddon()
  terminal.loadAddon(fitAddon)

  if (!isReplay.value) {
    terminal.attachCustomKeyEventHandler((event) => {
      const sequence = terminalOsShortcutSequence(event, {
        profile: props.keybindingProfile,
      })
      if (!sequence) return true
      event.preventDefault()
      event.stopPropagation()
      if (connected && props.ptyId != null) {
        window.kernel.ptyWrite(props.ptyId, sequence)
      }
      return false
    })

    terminal.onData((data: string) => {
      if (connected && props.ptyId != null) {
        window.kernel.ptyWrite(props.ptyId, data)
      } else {
        emit('input', data)
      }
    })
  }

  const el = containerEl.value
  if (el) {
    resizeObserver = new ResizeObserver(() => {
      if (!openWhenReady(props.active)) return
      fit()
    })
    resizeObserver.observe(el)
    scheduleOpenWhenReady(props.active)
    refitAfterPaint()
  }
})

// Replay text is normally write-once, but tolerate late/changed scrollback.
watch(() => props.replay, (next, prev) => {
  if (!terminal || !terminalOpened || next == null || next === prev) return
  terminal.clear()
  terminal.write(next)
})

onBeforeUnmount(() => {
  cancelScheduledFrames()
  unbindPty()
  if (resizeObserver) resizeObserver.disconnect()
  terminal?.dispose()
  terminal = null
  fitAddon = null
  terminalOpened = false
  pendingOutput = ''
})

/* ── Composer surface ── */
defineExpose({
  fit,
  focus: focusTerminal,
  clear: () => terminal?.clear(),
  selectAll: () => terminal?.selectAll(),
  getSelection: () => terminal?.getSelection() ?? '',
  write: (data: string) => terminal?.write(data),
  dimensions: () => ({ cols: terminal?.cols ?? 80, rows: terminal?.rows ?? 24 }),
})
</script>

<template>
  <div ref="containerEl" class="terminal-surface h-full w-full overflow-hidden" />
</template>

<style>
/* Third-party (xterm) content styling — Tailwind cannot reach inside xterm's
   generated DOM. Mirrors the TerminalPanel chrome contract. */
.terminal-surface .xterm {
  height: 100%;
  max-width: 100%;
  overflow: hidden;
}

.terminal-surface .xterm-viewport {
  overflow-x: hidden !important;
  scrollbar-width: none;
  background: transparent !important;
}

.terminal-surface .xterm-viewport::-webkit-scrollbar {
  width: 0;
  height: 0;
}

.terminal-surface .xterm-screen {
  max-width: 100%;
}
</style>
