export function chatModels(registry) {
  const models = registry?.models || []
  const filtered = models.filter((model) => model.capabilities?.streaming && model.capabilities?.tools)
  return filtered.length ? filtered : models
}

export function ghostModels(registry) {
  const ghostOrder = registry?.defaults?.ghost || []
  const models = registry?.models || []
  return ghostOrder
    .map((id) => {
      const model = models.find((m) => m.id === id)
      return model ? { ...model, shortLabel: model.shortLabel || model.displayName || model.name } : null
    })
    .filter(Boolean)
}

export function resolveGhostDefault(registry, keyStatuses) {
  const models = ghostModels(registry)
  for (const model of models) {
    if (providerConfigured(keyStatuses, model.provider)) return model
  }
  return null
}

export function modelDisplayName(model) {
  return model?.displayName || model?.name || model?.id || 'Model'
}

export function providerDisplayName(model) {
  return model?.providerLabel || title(model?.provider || '')
}

export function providerConfigured(keyStatuses, provider) {
  if (!provider) return false
  const status = (keyStatuses || []).find((item) => item.provider === provider || item.id === provider)
  return Boolean(status?.configured)
}

export function normalizeModelId(modelId) {
  return modelId || null
}

export function modelMenuItems(registry, keyStatuses) {
  const models = chatModels(registry)
  return models.map((model) => ({
    ...model,
    disabled: !providerConfigured(keyStatuses, model.provider),
  }))
}

export function resolveDefaultModel(registry, keyStatuses, feature = 'chat') {
  const models = chatModels(registry)
  const order = registry?.defaults?.[feature] || []
  for (const id of order) {
    const model = findModel(registry, id) || models.find((item) => item.model === id)
    if (model && providerConfigured(keyStatuses, model.provider)) return model
  }
  return models.find((model) => providerConfigured(keyStatuses, model.provider)) || null
}

export function resolveConcreteModel(registry, keyStatuses, modelId, feature = 'chat') {
  const normalized = normalizeModelId(modelId)
  if (!normalized) return resolveDefaultModel(registry, keyStatuses, feature)
  const model = findModel(registry, normalized) || resolveDefaultModel(registry, keyStatuses, feature)
  if (!model) return null
  return providerConfigured(keyStatuses, model.provider) ? model : null
}

export function resolvePreferredModel(registry, keyStatuses, modelId, feature = 'chat') {
  const normalized = normalizeModelId(modelId)
  if (normalized) {
    const selected = findModel(registry, normalized)
    if (selected && providerConfigured(keyStatuses, selected.provider)) return selected
  }
  return resolveDefaultModel(registry, keyStatuses, feature)
}

export function findModel(registry, modelId) {
  const normalized = normalizeModelId(modelId)
  if (!normalized) return null
  return registry?.models?.find((model) => model.id === normalized || model.model === normalized) || null
}

export function resolveFeatureDefault(registry, feature = 'chat') {
  const order = registry?.defaults?.[feature] || []
  for (const id of order) {
    const model = findModel(registry, id)
    if (model) return model
  }
  return registry?.models?.[0] || null
}

export function controlForModel(model, controlId = null) {
  const control = model?.control || null
  const options = Array.isArray(control?.options) ? control.options : []
  const fallback = control?.default || options[0]?.id || 'none'
  const id = options.some((option) => option.id === controlId) ? controlId : fallback
  return {
    kind: control?.kind || '',
    label: control?.label || title(control?.kind || 'Control'),
    default: fallback,
    id,
    option: options.find((option) => option.id === id) || options[0] || null,
    options,
  }
}

export function defaultControlId(model) {
  return controlForModel(model).id
}

export function controlLabel(model, controlId) {
  const control = controlForModel(model, controlId)
  return control.option?.label || title(control.id || '')
}

function title(value) {
  return String(value || '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}
