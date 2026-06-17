// Provider option + control resolution shared by the chat/inline runtime
// (aiRuntime.ts) and the package-facing tool loop (ai.ts). Lives in its own
// module with NO imports from ai.ts / aiRuntime.ts so callModelToolLoop can use
// it without creating an ai.ts -> aiRuntime.ts -> ai.ts import cycle.

export interface ModelConfig {
  id: string
  provider: string
  model: string
  capabilities?: Record<string, unknown>
  pricing?: Record<string, number>
  contextWindow?: number
  control?: {
    kind?: string
    default?: string
    options?: Array<{
      id: string
      providerValue?: string
      budgetTokens?: number
    }>
  }
}

export function controlForModel(model: ModelConfig, controlId?: string) {
  const control = model.control || {}
  const options = Array.isArray(control.options) ? control.options : []
  const fallback = control.default || options[0]?.id || 'none'
  const id = options.some(option => option.id === controlId) ? controlId! : fallback
  return {
    kind: control.kind || '',
    id,
    option: options.find(option => option.id === id) || options[0] || null,
  }
}

export function buildProviderOptions(modelConfig: ModelConfig, controlId?: string) {
  const options: Record<string, unknown> = {}
  const control = controlForModel(modelConfig, controlId)
  const selected = control.option
  const selectedId = selected?.id || control.id

  if (modelConfig.provider === 'anthropic') {
    const anthropic: Record<string, unknown> = {
      cacheControl: { type: 'ephemeral' },
    }

    if (control.kind === 'effort') {
      if (selectedId === 'none') {
        anthropic.thinking = { type: 'disabled' }
      } else {
        anthropic.thinking = { type: 'adaptive' }
        anthropic.effort = selected?.providerValue || selectedId
      }
    } else if (control.kind === 'thinking') {
      if (selectedId === 'none') {
        anthropic.thinking = { type: 'disabled' }
      } else if (selected?.budgetTokens) {
        anthropic.thinking = {
          type: 'enabled',
          budgetTokens: selected.budgetTokens,
        }
      }
    }
    options.anthropic = anthropic
  }

  if (modelConfig.provider === 'openai' && modelConfig.capabilities?.reasoning) {
    const effort = selected?.providerValue || selectedId || 'medium'
    options.openai = {
      reasoningEffort: effort,
      store: false,
      ...(effort !== 'none' ? { reasoningSummary: 'auto' } : {}),
    }
  }

  if (modelConfig.provider === 'google' && control.kind === 'thinking' && selectedId !== 'none') {
    options.google = {
      thinkingConfig: {
        thinkingLevel: selected?.providerValue || selectedId,
      },
    }
  }

  return Object.keys(options).length ? options : undefined
}
