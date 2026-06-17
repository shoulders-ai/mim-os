import { mapAiError } from '../../services/ai/errors.js'

// Normalize any thrown value into a displayable string. Used both for the error
// banner and for request logging in ChatView.
export function readableError(err) {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  try { return JSON.stringify(err) } catch { return 'AI request failed' }
}

// Decide what the chat error banner shows for a given raw error and key state.
// Pure + co-located so the banner contract is unit-tested without mounting
// ChatView (mounting pulls in the AI SDK Chat engine). Returns null when there
// is no error.
//
// - showOpenSettings: the resolving action for any auth/config error (missing or
//   rejected key, no usable model).
// - showRetry: meaningful for transient errors (rate limit, network, provider)
//   and for a rejected key (a key exists to re-send with), but NOT when no key is
//   configured at all — there, retrying without fixing config is a dead end.
export function chatErrorActions(rawError, anyKeyConfigured = false) {
  if (!rawError) return null
  const mapped = mapAiError(rawError)
  const isAuth = mapped.kind === 'auth'
  const errorText = readableError(rawError)
  const isContextOverflow = mapped.kind === 'limit' && /context|tokens/i.test(errorText)
  return {
    kind: mapped.kind,
    // Friendly text for recognized classes; keep the original for unknown errors
    // (often more specific than the generic fallback).
    message: mapped.kind !== 'unknown' ? mapped.message : errorText,
    showOpenSettings: isAuth,
    showRetry: !isAuth || Boolean(anyKeyConfigured),
    showStartFresh: isContextOverflow,
  }
}
