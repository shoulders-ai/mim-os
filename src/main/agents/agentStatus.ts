// Pure runtime-status tracker for an interactive CLI agent's pty output stream.
//
// Three signal layers (highest priority wins within a single feed() call):
//
// 1. OSC 9;4;N; — terminal progress protocol (Claude Code):
//    4;3; → working, 4;0; → done.
//
// 2. Title spinner — Braille characters (U+2800-U+28FF) in OSC 0/1/2 title
//    (Claude Code, Codex, Gemini CLI all use Braille spinners):
//    Title gains Braille prefix → working.
//    Title loses Braille prefix → needs-input (catches plan mode, approval
//    prompts, and task completion for agents without OSC 9).
//
// 3. OSC 777 — desktop notification (Claude Code permission prompts):
//    Any OSC 777 → needs-input.
//
// Fallback (agents with none of the above): BEL → needs-input,
// printable output → working.
//
// Once any TUI signal (OSC 9, title spinner, or OSC 777) is seen, printable
// output no longer drives status — TUI agents redraw constantly.
//
// Idle is time-derived: done + 5s → idle. needs-input + 5s → idle only in
// pure fallback mode (BEL is ambiguous). With TUI signals, needs-input is
// genuinely blocking and stays until the agent resumes.
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

export function createAgentStatusTracker(
  deps: { now?: () => number; idleThresholdMs?: number } = {},
): AgentStatusTracker {
  const now = deps.now ?? (() => Date.now())
  const idleThresholdMs = deps.idleThresholdMs ?? 5000

  let _status: 'working' | 'needs-input' | 'done' = 'working'
  let titleHint: string | undefined
  let state: ParserState = 'text'
  let oscBuffer = ''
  let lastSignalAt = now()

  // Set when ANY TUI-level signal is seen (OSC 9, Braille title, OSC 777).
  // Suppresses the fallback printable → working heuristic.
  let hasTuiSignals = false
  // Set specifically when OSC 777 notification fires. When true,
  // needs-input is genuinely blocking (permission prompt) and should NOT
  // degrade to idle. Reset when the agent resumes working.
  let needsInputIsBlocking = false
  // Tracks whether the most recent title started with a Braille spinner char.
  let lastTitleBraille = false

  function setStatus(next: 'working' | 'needs-input' | 'done'): void {
    _status = next
    lastSignalAt = now()
    if (next === 'working' || next === 'done') needsInputIsBlocking = false
  }

  function commitOsc(): void {
    const split = oscBuffer.indexOf(';')
    if (split !== -1) {
      const code = oscBuffer.slice(0, split)
      const payload = oscBuffer.slice(split + 1)

      // Title sequences — also carry the Braille spinner signal.
      if (code === '0' || code === '1' || code === '2') {
        const nowBraille = payload.length > 0 && isSpinnerPrefix(payload.charAt(0))
        // Spinner started: title gained Braille prefix → working
        if (nowBraille && !lastTitleBraille) {
          hasTuiSignals = true
          setStatus('working')
        }
        // Spinner stopped: title lost Braille prefix → needs-input
        // (catches plan mode, approval prompts, and Codex task completion).
        // For Claude Code, OSC 9;4;0; may follow in the same chunk and
        // override this to 'done'.
        if (lastTitleBraille && !nowBraille) {
          hasTuiSignals = true
          setStatus('needs-input')
        }
        lastTitleBraille = nowBraille
        titleHint = payload
      }

      // OSC 9;4;N; — terminal progress protocol.
      if (code === '9' && payload.startsWith('4;')) {
        hasTuiSignals = true
        const progressState = payload.charAt(2)
        if (progressState === '0') setStatus('done')
        else if (progressState === '3') setStatus('working')
      }

      // OSC 777 — desktop notification (permission prompts).
      if (code === '777') {
        hasTuiSignals = true
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
          else if (ch === BEL) setStatus('needs-input')
          else if (isPrintable(ch) && !hasTuiSignals) setStatus('working')
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
      // needs-input degrades to idle UNLESS it's genuinely blocking
      // (OSC 777 permission prompt). Title-spinner and BEL-based
      // needs-input both degrade — we can't be sure the agent is blocking.
      if (_status === 'needs-input' && !needsInputIsBlocking && elapsed >= idleThresholdMs) return 'idle'
      return _status
    },
    titleHint: () => titleHint,
  }
}
