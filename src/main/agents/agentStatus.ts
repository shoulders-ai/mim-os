// Pure runtime-status tracker for an interactive CLI agent's pty output stream.
//
// Three signal layers (highest priority wins within a single feed() call):
//
// 1. OSC 9;4;N; — terminal progress protocol (Claude Code):
//    4;3; → working, 4;0; → done.
//
// 2. TUI title — OSC 0/1/2 titles establish that the CLI exposes lifecycle
//    state. Its first plain title means ready/idle; spinner prefixes mean work:
//    Title gains Braille prefix → working.
//    Title loses Braille prefix → needs-input (catches plan mode, approval
//    prompts, and task completion for agents without OSC 9).
//    Codex "[ ! ] Action Required" titles → blocking needs-input.
//
// 3. OSC 777 — desktop notification (Claude Code permission prompts):
//    Any OSC 777 → needs-input.
//
// Fallback (agents with none of the above): BEL → needs-input, printable
// output → working after a short startup grace period. The grace prevents CLI
// boot banners/redraws from reporting work before the first user prompt.
//
// Once any TUI signal (OSC 9, title, or OSC 777) is seen, printable
// output no longer drives status — TUI agents redraw constantly.
//
// Idle is both the initial ready state and a settled state: done + 5s → idle;
// needs-input + 5s → idle unless OSC 777 marked it as genuinely blocking.
//
// Dependency-free; the parser carries state across feed() chunk boundaries.

export type AgentRuntimeStatus = 'working' | 'needs-input' | 'done' | 'idle'

export interface AgentStatusTracker {
  feed(chunk: string): void
  status(): AgentRuntimeStatus
  titleHint(): string | undefined
}

type ParserState = 'text' | 'esc' | 'csi' | 'osc' | 'osc-esc' | 'str' | 'str-esc'

const BEL = '\x07'
const ESC = '\x1b'
const DEL = '\x7f'

function isPrintable(ch: string): boolean {
  return ch >= ' ' && ch !== DEL
}

function isCsiFinalByte(ch: string): boolean {
  return ch >= '@' && ch <= '~'
}

// Characters that agents use as "I'm working" title prefixes.
// Braille block = animated spinners (Claude Code, Codex).
// ✦ U+2726 = Gemini CLI static working indicator.
export function isSpinnerPrefix(ch: string): boolean {
  const code = ch.codePointAt(0) ?? 0
  if (code >= 0x2800 && code <= 0x28FF) return true
  if (code === 0x2726) return true
  return false
}

// Codex alternates `!` and `.` once per second while an approval overlay is
// open. Match the complete status segment so a project/task title that merely
// contains "Action Required" cannot make a session look blocked.
function isCodexActionRequiredTitle(title: string): boolean {
  return /^\[\s*[!.]\s*\]\s+Action Required(?:\s*\|.*)?\s*$/.test(title)
}

export function createAgentStatusTracker(
  deps: { now?: () => number; idleThresholdMs?: number; fallbackActivityDelayMs?: number } = {},
): AgentStatusTracker {
  const now = deps.now ?? (() => Date.now())
  const idleThresholdMs = deps.idleThresholdMs ?? 5000
  const fallbackActivityDelayMs = deps.fallbackActivityDelayMs ?? idleThresholdMs
  const startedAt = now()

  let _status: AgentRuntimeStatus = 'idle'
  let titleHint: string | undefined
  let state: ParserState = 'text'
  let oscBuffer = ''
  let lastSignalAt = startedAt

  // Set when ANY TUI-level signal is seen (OSC 9, title, OSC 777).
  // Suppresses the fallback printable → working heuristic.
  let hasTuiSignals = false
  // Set when an explicit blocking signal fires (OSC 777 or a Codex action
  // title). Blocking input does NOT degrade to idle. Reset when the agent
  // resumes working, settles, or explicitly leaves that action title.
  let needsInputIsBlocking = false
  // Tracks whether the most recent title started with a known spinner char.
  let lastTitleSpinner = false
  let lastTitleRequiresAction = false
  let hasSeenTitle = false
  // Unlike printable startup output, these signals describe lifecycle state.
  // A first plain title may only establish idle if none arrived before it.
  let hasStatusSignal = false

  function setStatus(next: AgentRuntimeStatus): void {
    _status = next
    lastSignalAt = now()
    if (next === 'working' || next === 'done' || next === 'idle') needsInputIsBlocking = false
  }

  function commitOsc(): void {
    const split = oscBuffer.indexOf(';')
    if (split !== -1) {
      const code = oscBuffer.slice(0, split)
      const payload = oscBuffer.slice(split + 1)

      // Title sequences — also carry the Braille spinner signal.
      if (code === '0' || code === '1' || code === '2') {
        const nowSpinner = payload.length > 0 && isSpinnerPrefix(payload.charAt(0))
        const nowRequiresAction = isCodexActionRequiredTitle(payload)
        hasTuiSignals = true
        // Supported CLIs publish a plain title once their initial prompt is
        // ready. Reset any printable startup noise without overriding a real
        // progress, permission, or BEL signal that arrived first.
        if (!hasSeenTitle && !nowSpinner && !nowRequiresAction && !hasStatusSignal) {
          hasStatusSignal = true
          setStatus('idle')
        }

        // Codex publishes this explicit title for the lifetime of its
        // approval overlay. Unlike an ambiguous spinner stop, it must remain
        // visible as Input until the user responds.
        if (nowRequiresAction) {
          hasStatusSignal = true
          needsInputIsBlocking = true
          setStatus('needs-input')
        } else {
          // Spinner started: title gained Braille prefix → working
          if (nowSpinner && !lastTitleSpinner) {
            hasStatusSignal = true
            setStatus('working')
          }
          // Spinner stopped: title lost Braille prefix → needs-input
          // (catches plan mode, approval prompts, and Codex task completion).
          // For Claude Code, OSC 9;4;0; may follow in the same chunk and
          // override this to 'done'.
          if (lastTitleSpinner && !nowSpinner) {
            hasStatusSignal = true
            setStatus('needs-input')
          }
          // A response can close the approval overlay without immediately
          // starting another spinner (for example, when permission is denied).
          // Preserve the existing transient spinner-stop behavior, but release
          // the sticky blocking flag so the session can settle normally.
          if (lastTitleRequiresAction && !nowSpinner) {
            hasStatusSignal = true
            needsInputIsBlocking = false
            setStatus('needs-input')
          }
        }
        lastTitleSpinner = nowSpinner
        lastTitleRequiresAction = nowRequiresAction
        hasSeenTitle = true
        titleHint = payload
      }

      // OSC 9;4;N; — terminal progress protocol.
      if (code === '9' && payload.startsWith('4;')) {
        hasTuiSignals = true
        hasStatusSignal = true
        const progressState = payload.charAt(2)
        if (progressState === '0') setStatus('done')
        else if (progressState === '3') setStatus('working')
      }

      // OSC 777 — desktop notification (permission prompts).
      if (code === '777') {
        hasTuiSignals = true
        hasStatusSignal = true
        needsInputIsBlocking = true
        setStatus('needs-input')
      }
    }
    oscBuffer = ''
    state = 'text'
  }

  function dispatchEscape(ch: string): void {
    if (ch === '[') state = 'csi'
    else if (ch === ']') {
      state = 'osc'
      oscBuffer = ''
    } else if (ch === 'P' || ch === 'X' || ch === '^' || ch === '_') {
      state = 'str'
    } else state = 'text'
  }

  function feed(chunk: string): void {
    for (const ch of chunk) {
      switch (state) {
        case 'text':
          if (ch === ESC) state = 'esc'
          else if (ch === BEL) {
            hasStatusSignal = true
            setStatus('needs-input')
          } else if (
            isPrintable(ch)
            && !hasTuiSignals
            && (hasStatusSignal || now() - startedAt >= fallbackActivityDelayMs)
          ) setStatus('working')
          break

        case 'esc':
          dispatchEscape(ch)
          break

        case 'csi':
          if (isCsiFinalByte(ch)) state = 'text'
          break

        case 'osc':
          if (ch === BEL) commitOsc()
          else if (ch === ESC) state = 'osc-esc'
          else oscBuffer += ch
          break

        case 'osc-esc':
          if (ch === '\\') {
            commitOsc()
          } else {
            commitOsc()
            dispatchEscape(ch)
          }
          break

        case 'str':
          if (ch === BEL) state = 'text'
          else if (ch === ESC) state = 'str-esc'
          break

        case 'str-esc':
          state = ch === '\\' ? 'text' : 'str'
          break
      }
    }
  }

  return {
    feed,
    status: (): AgentRuntimeStatus => {
      const elapsed = now() - lastSignalAt
      if (_status === 'done' && elapsed >= idleThresholdMs) return 'idle'
      // needs-input degrades to idle UNLESS an explicit signal says the agent
      // is blocking (OSC 777 or Codex Action Required). Title-spinner and
      // BEL-based needs-input both degrade — we can't be sure they are blocking.
      if (_status === 'needs-input' && !needsInputIsBlocking && elapsed >= idleThresholdMs) return 'idle'
      return _status
    },
    titleHint: () => titleHint,
  }
}
