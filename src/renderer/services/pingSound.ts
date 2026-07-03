// Completion chime for "ping when done" activity rows. Synthesized with Web
// Audio so there is no asset to ship: a quiet two-note marimba bong (G4 → C5),
// each note a sine fundamental plus one inharmonic bar partial with an
// exponential decay — warm and woody, not a system alert.

let shared: AudioContext | null = null

function sharedContext(): AudioContext | null {
  try {
    if (!shared) shared = new AudioContext()
    if (shared.state === 'suspended') void shared.resume()
    return shared
  } catch {
    return null
  }
}

// One struck note. The 2.756× partial is the first transverse mode of a
// free bar — it decays much faster than the fundamental, which is what makes
// the strike read as wood rather than a bell.
function strike(ctx: AudioContext, out: AudioNode, at: number, freq: number, peak: number): void {
  const partials: Array<{ freq: number; peak: number; decay: number }> = [
    { freq, peak, decay: 1.1 },
    { freq: freq * 2.756, peak: peak * 0.18, decay: 0.28 },
  ]
  for (const partial of partials) {
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.value = partial.freq
    const env = ctx.createGain()
    env.gain.setValueAtTime(0, at)
    env.gain.linearRampToValueAtTime(partial.peak, at + 0.008)
    env.gain.exponentialRampToValueAtTime(0.0001, at + partial.decay)
    osc.connect(env)
    env.connect(out)
    osc.start(at)
    osc.stop(at + partial.decay + 0.05)
  }
}

export function playPingSound(ctx: AudioContext | null = sharedContext()): void {
  if (!ctx) return
  try {
    const out = ctx.createGain()
    out.gain.value = 0.14
    const soften = ctx.createBiquadFilter()
    soften.type = 'lowpass'
    soften.frequency.value = 2400
    out.connect(soften)
    soften.connect(ctx.destination)
    const now = ctx.currentTime
    strike(ctx, out, now, 392.0, 1) // G4
    strike(ctx, out, now + 0.13, 523.25, 0.75) // C5
  } catch {
    // Audio failures never break the shell.
  }
}
