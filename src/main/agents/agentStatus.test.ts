import { describe, expect, it } from 'vitest'
import { createAgentStatusTracker } from './agentStatus.js'

describe('createAgentStatusTracker', () => {
  it('starts in working status with no title hint', () => {
    const tracker = createAgentStatusTracker()
    expect(tracker.status()).toBe('working')
    expect(tracker.titleHint()).toBeUndefined()
  })

  it('accepts an injected clock without changing signal-ordered behavior', () => {
    let t = 0
    const tracker = createAgentStatusTracker({ now: () => ++t })
    tracker.feed('hello')
    expect(tracker.status()).toBe('working')
    tracker.feed('\x07')
    expect(tracker.status()).toBe('needs-input')
  })

  it('flips to needs-input on a bare BEL', () => {
    const tracker = createAgentStatusTracker()
    tracker.feed('Done thinking.\x07')
    expect(tracker.status()).toBe('needs-input')
  })

  it('stays needs-input on repeated BELs', () => {
    const tracker = createAgentStatusTracker()
    tracker.feed('\x07')
    tracker.feed('\x07')
    expect(tracker.status()).toBe('needs-input')
  })

  it('flips back to working on printable output after a BEL', () => {
    const tracker = createAgentStatusTracker()
    tracker.feed('\x07')
    expect(tracker.status()).toBe('needs-input')
    tracker.feed('y')
    expect(tracker.status()).toBe('working')
  })

  it('does not flip back to working on ANSI color sequences after a BEL', () => {
    const tracker = createAgentStatusTracker()
    tracker.feed('\x07')
    tracker.feed('\x1b[31m\x1b[1m\x1b[0m')
    expect(tracker.status()).toBe('needs-input')
  })

  it('does not flip back to working on cursor-movement sequences after a BEL', () => {
    const tracker = createAgentStatusTracker()
    tracker.feed('\x07')
    tracker.feed('\x1b[2K\x1b[1A\x1b[10;20H\x1b[?25l')
    expect(tracker.status()).toBe('needs-input')
  })

  it('does not flip back to working on bare control characters after a BEL', () => {
    const tracker = createAgentStatusTracker()
    tracker.feed('\x07')
    tracker.feed('\r\n\t')
    expect(tracker.status()).toBe('needs-input')
  })

  it('parses an OSC 2 title; its terminating BEL is not a needs-input signal', () => {
    const tracker = createAgentStatusTracker()
    tracker.feed('\x1b]2;Claude Code\x07')
    expect(tracker.titleHint()).toBe('Claude Code')
    expect(tracker.status()).toBe('working')
  })

  it('parses OSC 0 and OSC 1 titles', () => {
    const tracker = createAgentStatusTracker()
    tracker.feed('\x1b]0;zero title\x07')
    expect(tracker.titleHint()).toBe('zero title')
    tracker.feed('\x1b]1;one title\x07')
    expect(tracker.titleHint()).toBe('one title')
  })

  it('keeps needs-input when an OSC title is redrawn while blocked', () => {
    const tracker = createAgentStatusTracker()
    tracker.feed('\x07')
    tracker.feed('\x1b]2;still waiting\x07')
    expect(tracker.status()).toBe('needs-input')
    expect(tracker.titleHint()).toBe('still waiting')
  })

  it('supports the ESC \\ (ST) terminator variant', () => {
    const tracker = createAgentStatusTracker()
    tracker.feed('\x1b]2;st terminated\x1b\\')
    expect(tracker.titleHint()).toBe('st terminated')
    expect(tracker.status()).toBe('working')
  })

  it('parses an OSC sequence split across feed() chunks without a spurious needs-input', () => {
    const tracker = createAgentStatusTracker()
    tracker.feed('\x07') // blocked; the carried-over OSC terminator must not re-signal
    tracker.feed('\x1b]2;split ti')
    tracker.feed('tle\x07')
    expect(tracker.titleHint()).toBe('split title')
    expect(tracker.status()).toBe('needs-input')
  })

  it('parses an OSC sequence split mid-introducer across chunks', () => {
    const tracker = createAgentStatusTracker()
    tracker.feed('\x1b')
    tracker.feed(']2;late join\x07')
    expect(tracker.titleHint()).toBe('late join')
    expect(tracker.status()).toBe('working')
  })

  it('parses a split ST terminator (ESC in one chunk, backslash in the next)', () => {
    const tracker = createAgentStatusTracker()
    tracker.feed('\x1b]2;split st\x1b')
    tracker.feed('\\')
    expect(tracker.titleHint()).toBe('split st')
    expect(tracker.status()).toBe('working')
  })

  it('overwrites titleHint with successive titles', () => {
    const tracker = createAgentStatusTracker()
    tracker.feed('\x1b]2;first\x07')
    tracker.feed('\x1b]2;second\x07')
    expect(tracker.titleHint()).toBe('second')
  })

  it('preserves semicolons inside the title text', () => {
    const tracker = createAgentStatusTracker()
    tracker.feed('\x1b]2;a;b;c\x07')
    expect(tracker.titleHint()).toBe('a;b;c')
  })

  it('ignores non-title OSC sequences but still swallows their BEL terminator', () => {
    const tracker = createAgentStatusTracker()
    tracker.feed('\x1b]133;A\x07')
    expect(tracker.titleHint()).toBeUndefined()
    expect(tracker.status()).toBe('working')
  })

  it('lands on the right final status for interleaved output, OSC, BEL, output', () => {
    const tracker = createAgentStatusTracker()
    tracker.feed('Running tests...\n')
    expect(tracker.status()).toBe('working')
    tracker.feed('\x1b]2;mim agent\x07')
    expect(tracker.status()).toBe('working')
    tracker.feed('\x1b[33mAllow this command?\x1b[0m \x07')
    expect(tracker.status()).toBe('needs-input')
    tracker.feed('\x1b[2K') // redraw while blocked
    expect(tracker.status()).toBe('needs-input')
    tracker.feed('Proceeding.')
    expect(tracker.status()).toBe('working')
    expect(tracker.titleHint()).toBe('mim agent')
  })

  it('transitions from needs-input to idle after the silence threshold', () => {
    let t = 0
    const tracker = createAgentStatusTracker({ now: () => t, idleThresholdMs: 100 })
    tracker.feed('\x07')
    expect(tracker.status()).toBe('needs-input')
    t += 101
    expect(tracker.status()).toBe('idle')
    tracker.feed('output')
    expect(tracker.status()).toBe('working')
  })

  it('does not transition to idle before the threshold', () => {
    let t = 0
    const tracker = createAgentStatusTracker({ now: () => t, idleThresholdMs: 100 })
    tracker.feed('\x07')
    t += 99
    expect(tracker.status()).toBe('needs-input')
  })

  it('idle resets when new output arrives', () => {
    let t = 0
    const tracker = createAgentStatusTracker({ now: () => t, idleThresholdMs: 100 })
    tracker.feed('\x07')
    t += 200
    expect(tracker.status()).toBe('idle')
    tracker.feed('new output')
    expect(tracker.status()).toBe('working')
  })

  it('working status never transitions to idle', () => {
    let t = 0
    const tracker = createAgentStatusTracker({ now: () => t, idleThresholdMs: 100 })
    tracker.feed('hello')
    t += 200
    expect(tracker.status()).toBe('working')
  })

  // OSC 9;4;N; — terminal progress protocol (Claude Code, iTerm2-compatible agents)
  it('detects OSC 9;4;3; as working and OSC 9;4;0; as done', () => {
    const tracker = createAgentStatusTracker()
    tracker.feed('\x1b]9;4;3;\x07')
    expect(tracker.status()).toBe('working')
    tracker.feed('\x1b]9;4;0;\x07')
    expect(tracker.status()).toBe('done')
  })

  it('disables printable-means-working once an OSC 9 progress signal is seen', () => {
    const tracker = createAgentStatusTracker()
    tracker.feed('\x1b]9;4;0;\x07') // boot done
    expect(tracker.status()).toBe('done')
    // TUI redraws with printable chars should not reset to working
    tracker.feed('Hello world! ❯ ')
    expect(tracker.status()).toBe('done')
    // Only OSC 9;4;3; sets working in progress mode
    tracker.feed('\x1b]9;4;3;\x07')
    expect(tracker.status()).toBe('working')
  })

  it('BEL still triggers needs-input even in progress mode', () => {
    const tracker = createAgentStatusTracker()
    tracker.feed('\x1b]9;4;3;\x07') // enter progress mode, working
    expect(tracker.status()).toBe('working')
    tracker.feed('\x07') // standalone BEL
    expect(tracker.status()).toBe('needs-input')
  })

  it('OSC 777 triggers needs-input for permission prompts', () => {
    const tracker = createAgentStatusTracker()
    tracker.feed('\x1b]9;4;3;\x07') // working
    expect(tracker.status()).toBe('working')
    tracker.feed('\x1b]777;notify;Claude Code;Claude needs your permission\x07')
    expect(tracker.status()).toBe('needs-input')
  })

  it('needs-input from OSC 777 stays indefinitely in progress mode', () => {
    let t = 0
    const tracker = createAgentStatusTracker({ now: () => t, idleThresholdMs: 100 })
    tracker.feed('\x1b]9;4;3;\x07') // enter progress mode
    tracker.feed('\x1b]777;notify;Agent;needs permission\x07')
    expect(tracker.status()).toBe('needs-input')
    t += 200 // past threshold
    expect(tracker.status()).toBe('needs-input') // stays — genuinely blocking
  })

  it('done transitions to idle after the silence threshold', () => {
    let t = 0
    const tracker = createAgentStatusTracker({ now: () => t, idleThresholdMs: 100 })
    tracker.feed('\x1b]9;4;0;\x07')
    expect(tracker.status()).toBe('done')
    t += 101
    expect(tracker.status()).toBe('idle')
  })

  it('handles an OSC 9 sequence split across chunks', () => {
    const tracker = createAgentStatusTracker()
    tracker.feed('\x1b]9;4;')
    tracker.feed('3;\x07')
    expect(tracker.status()).toBe('working')
    tracker.feed('\x1b]9;')
    tracker.feed('4;0;\x07')
    expect(tracker.status()).toBe('done')
  })

  it('models a Claude Code lifecycle: boot → work → done → idle', () => {
    let t = 0
    const tracker = createAgentStatusTracker({ now: () => t, idleThresholdMs: 5000 })
    // Boot
    tracker.feed('\x1b]0;✳ Claude Code\x07')
    tracker.feed('\x1b]9;4;0;\x07')
    expect(tracker.status()).toBe('done')
    expect(tracker.titleHint()).toBe('✳ Claude Code')
    // User sends a prompt → agent starts working
    t += 3000
    tracker.feed('\x1b]9;4;3;\x07')
    tracker.feed('\x1b]0;⠂ Refactoring auth\x07')
    expect(tracker.status()).toBe('working')
    expect(tracker.titleHint()).toBe('⠂ Refactoring auth')
    // Agent finishes
    t += 2000
    tracker.feed('\x1b]0;✳ Refactoring auth\x07')
    tracker.feed('\x1b]9;4;0;\x07')
    tracker.feed('Here is the result...\n❯ ')
    expect(tracker.status()).toBe('done')
    // After 5s of silence → idle
    t += 5001
    expect(tracker.status()).toBe('idle')
    // New task starts
    tracker.feed('\x1b]9;4;3;\x07')
    expect(tracker.status()).toBe('working')
  })

  it('models a Claude Code permission flow: work → permission → resume → done', () => {
    let t = 0
    const tracker = createAgentStatusTracker({ now: () => t, idleThresholdMs: 5000 })
    tracker.feed('\x1b]9;4;0;\x07') // boot
    t += 2000
    // Start task
    tracker.feed('\x1b]9;4;3;\x07')
    expect(tracker.status()).toBe('working')
    // Agent wants to edit a file → shows permission prompt
    t += 3000
    tracker.feed('\x1b]777;notify;Claude Code;Claude needs your permission\x07')
    expect(tracker.status()).toBe('needs-input')
    // Permission persists — not idle
    t += 10000
    expect(tracker.status()).toBe('needs-input')
    // User approves → agent resumes
    tracker.feed('\x1b]9;4;3;\x07')
    expect(tracker.status()).toBe('working')
    // Task done
    t += 2000
    tracker.feed('\x1b]9;4;0;\x07')
    expect(tracker.status()).toBe('done')
    t += 5001
    expect(tracker.status()).toBe('idle')
  })

  // Title spinner (Braille prefix) detection
  it('detects title Braille prefix as a spinner signal', () => {
    const tracker = createAgentStatusTracker()
    tracker.feed('\x1b]0;tmp\x07') // no Braille → no status change
    expect(tracker.status()).toBe('working') // initial
    tracker.feed('\x1b]0;⠴ tmp\x07') // Braille spinner starts
    expect(tracker.status()).toBe('working')
    tracker.feed('\x1b]0;tmp\x07') // spinner stops → needs-input
    expect(tracker.status()).toBe('needs-input')
  })

  it('suppresses printable-means-working once a title spinner is seen', () => {
    const tracker = createAgentStatusTracker()
    tracker.feed('\x1b]0;⠴ tmp\x07') // Braille title → hasTuiSignals
    tracker.feed('\x1b]0;tmp\x07') // spinner stops → needs-input
    expect(tracker.status()).toBe('needs-input')
    tracker.feed('Hello world! ❯ ') // printable output
    expect(tracker.status()).toBe('needs-input') // suppressed
  })

  it('models a Codex lifecycle: boot → work → done → idle', () => {
    let t = 0
    const tracker = createAgentStatusTracker({ now: () => t, idleThresholdMs: 5000 })
    // Boot: title without Braille
    tracker.feed('\x1b]0;tmp\x07')
    expect(tracker.status()).toBe('working') // initial, no signal yet
    // Work starts: title gains Braille spinner
    t += 1000
    tracker.feed('\x1b]0;⠴ tmp\x07')
    expect(tracker.status()).toBe('working')
    // Spinner animates
    tracker.feed('\x1b]0;⠦ tmp\x07')
    expect(tracker.status()).toBe('working')
    // Task done: title loses Braille
    t += 3000
    tracker.feed('\x1b]0;tmp\x07')
    expect(tracker.status()).toBe('needs-input')
    // After 5s → idle (title spinner needs-input degrades since it's not blocking)
    t += 5001
    expect(tracker.status()).toBe('idle')
  })

  it('models a Gemini CLI lifecycle: ready → work → ready → idle', () => {
    let t = 0
    const tracker = createAgentStatusTracker({ now: () => t, idleThresholdMs: 5000 })
    // Boot: ◇ Ready
    tracker.feed('\x1b]0;◇  Ready (tmp)\x07')
    expect(tracker.status()).toBe('working') // no spinner seen yet
    // Work starts: ✦ Working…
    t += 2000
    tracker.feed('\x1b]0;✦  Working… (tmp)\x07')
    expect(tracker.status()).toBe('working')
    expect(tracker.titleHint()).toBe('✦  Working… (tmp)')
    // Task done: ◇ Ready
    t += 5000
    tracker.feed('\x1b]0;◇  Ready (tmp)\x07')
    expect(tracker.status()).toBe('needs-input')
    // After 5s → idle
    t += 5001
    expect(tracker.status()).toBe('idle')
  })

  it('models a Claude Code plan mode: work → plan prompt → approve → work → done', () => {
    let t = 0
    const tracker = createAgentStatusTracker({ now: () => t, idleThresholdMs: 5000 })
    // Boot
    tracker.feed('\x1b]0;✳ Claude Code\x07')
    tracker.feed('\x1b]9;4;0;\x07')
    expect(tracker.status()).toBe('done')
    // Start task
    t += 2000
    tracker.feed('\x1b]9;4;3;\x07')
    tracker.feed('\x1b]0;⠂ Plan auth refactor\x07')
    expect(tracker.status()).toBe('working')
    // Plan mode: title goes to ✳ (non-Braille), NO OSC 9;4;0;
    t += 3000
    tracker.feed('\x1b]0;✳ Plan auth refactor\x07')
    expect(tracker.status()).toBe('needs-input') // title spinner stopped
    // Without OSC 777, plan prompt degrades to idle (not genuinely blocking)
    t += 5001
    expect(tracker.status()).toBe('idle')
    // User approves plan → agent resumes
    tracker.feed('\x1b]9;4;3;\x07')
    tracker.feed('\x1b]0;⠂ Plan auth refactor\x07')
    expect(tracker.status()).toBe('working')
    // Task done
    t += 2000
    tracker.feed('\x1b]0;✳ Plan auth refactor\x07')
    tracker.feed('\x1b]9;4;0;\x07')
    expect(tracker.status()).toBe('done')
    t += 5001
    expect(tracker.status()).toBe('idle')
  })
})
