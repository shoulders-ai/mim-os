// Per-span-kind iconography for the Activity surface.
//
// The design system mandates one accent and monochrome chrome (§1, §2.3), so —
// unlike Phoenix's per-kind colour palette — span kinds are distinguished by
// ICON + typography, never by hue. Icons render in `currentColor` (ink levels);
// accent is reserved for selection and red for errors, applied by the caller.

import {
  IconActivity,
  IconBolt,
  IconFileText,
  IconMessage,
  IconPackage,
  IconPencil,
  IconSearch,
  IconShieldCheck,
  IconTerminal,
  IconTool,
  IconWorld,
} from '@tabler/icons-vue'
import type { Component } from 'vue'
import type { FoldedSpan, SpanKind } from '../../services/trace/spans'

export function spanIcon(span: Pick<FoldedSpan, 'kind' | 'tool'>): Component {
  if (span.kind === 'tool') {
    const tool = span.tool ?? ''
    if (tool.startsWith('fs.') || tool === 'editor.open') return IconFileText
    if (tool.startsWith('search.')) return IconSearch
    if (tool === 'terminal.run') return IconTerminal
    return IconTool
  }
  switch (span.kind) {
    case 'chat':
      return IconMessage
    case 'model':
      return IconBolt
    case 'gate':
      return IconShieldCheck
    case 'job':
    case 'package':
      return IconPackage
    case 'http':
      return IconWorld
    case 'outcome':
      return IconPencil
    default:
      return IconActivity
  }
}

const KIND_LABEL: Record<SpanKind, string> = {
  chat: 'Chat',
  model: 'Model',
  tool: 'Tool',
  gate: 'Approval',
  job: 'Job',
  http: 'Request',
  package: 'Package',
  outcome: 'Edit',
  other: 'Event',
}

export function spanKindLabel(kind: SpanKind): string {
  return KIND_LABEL[kind]
}
