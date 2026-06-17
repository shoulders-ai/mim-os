import { watch, type Ref } from 'vue'
import type { useSettingsStore } from '../../stores/settings.js'
import { editorSettingsEffects } from './codemirror/core.js'

type SettingsStore = ReturnType<typeof useSettingsStore>

interface UseEditorSettingsEffectsOptions {
  settingsStore: SettingsStore
  editorContainer: Ref<HTMLElement | null>
  getEditorView: () => any
}

export function useEditorSettingsEffects(options: UseEditorSettingsEffectsOptions) {
  function applyEditorSettings() {
    const editorView = options.getEditorView()
    if (!editorView) return
    editorView.dispatch({
      effects: editorSettingsEffects({
        wordWrap: options.settingsStore.editorWordWrap,
        spellCheck: options.settingsStore.editorSpellCheck,
        lineNumbers: options.settingsStore.editorLineNumbers,
      }),
    })
  }

  watch(
    () => [options.settingsStore.editorWordWrap, options.settingsStore.editorSpellCheck, options.settingsStore.editorLineNumbers],
    applyEditorSettings,
  )

  watch(() => options.settingsStore.editorFontSize, (size) => {
    if (!options.editorContainer.value) return
    options.editorContainer.value.style.setProperty('--editor-size', `${size}px`)
  }, { immediate: true })

  watch(() => options.settingsStore.editorFontFamily, (family) => {
    if (!options.editorContainer.value) return
    const map: Record<string, string> = { sans: 'var(--font-sans)', serif: 'var(--font-serif)', mono: 'var(--font-mono)', slab: 'var(--font-slab)' }
    options.editorContainer.value.style.setProperty('--editor-font', map[family] || map.serif)
  }, { immediate: true })

  return { applyEditorSettings }
}
