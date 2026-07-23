import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { useSessionStore } from './sessions.js'
import type { ApprovalPreviewLike, SavedBrowserSessionApprovalLike } from '../components/chat/approvalLogic.js'

// A pending permission request from the main-process gate. Only AI actions reach
// the renderer; direct user and package actions are resolved in the gate itself.
export interface ApprovalRequest {
  requestId: string
  toolName: string
  actor: string
  package_id?: string
  sessionId?: string
  category: string
  risk: string
  mode: string
  reason: string
  target?: string
  pathKind?: string
  // Human-readable action label from the resolved tool policy (package tools).
  label?: string
  params: Record<string, unknown>
  preview?: ApprovalPreviewLike
  savedBrowserSession?: SavedBrowserSessionApprovalLike
}

export interface ApprovalDecision {
  approved: boolean
  alwaysAllow?: boolean
}

// Pending approvals live here rather than in a blocking modal. Each request is
// shown inline in the conversation it belongs to; a request for a conversation
// you are not looking at surfaces as an "Approve" status on that conversation.
export const useApprovalsStore = defineStore('approvals', () => {
  const pending = ref<ApprovalRequest[]>([])

  const pendingCount = computed(() => pending.value.length)

  function enqueue(request: ApprovalRequest): void {
    if (pending.value.some(item => item.requestId === request.requestId)) return
    pending.value.push(request)
    if (request.sessionId) {
      useSessionStore().setSessionStatus(request.sessionId, 'needs-approval')
    }
  }

  function forSession(sessionId: string | null | undefined): ApprovalRequest[] {
    if (!sessionId) return []
    return pending.value.filter(item => item.sessionId === sessionId)
  }

  function get(requestId: string): ApprovalRequest | undefined {
    return pending.value.find(item => item.requestId === requestId)
  }

  async function respond(requestId: string, decision: ApprovalDecision): Promise<void> {
    const request = pending.value.find(item => item.requestId === requestId)
    pending.value = pending.value.filter(item => item.requestId !== requestId)

    // Only move the conversation off "needs approval" once nothing else is
    // waiting on it; a parallel tool call may still hold an approval open.
    if (request?.sessionId && !pending.value.some(item => item.sessionId === request.sessionId)) {
      useSessionStore().setSessionStatus(request.sessionId, decision.approved ? 'working' : 'error')
    }

    await window.kernel.respondGate(requestId, decision)
  }

  // Remove all pending approvals for a session (e.g. when the user stops the
  // run). The gate side resolves the promises as denied; this just clears the
  // renderer queue so the inline approval cards disappear.
  function clearSession(sessionId: string): void {
    pending.value = pending.value.filter(item => item.sessionId !== sessionId)
  }

  return { pending, pendingCount, enqueue, forSession, get, respond, clearSession }
})
