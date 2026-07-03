import { describe, expect, it, vi } from 'vitest'
import { playPingSound } from './pingSound.js'

interface FakeParam {
  value: number
  setValueAtTime: ReturnType<typeof vi.fn>
  linearRampToValueAtTime: ReturnType<typeof vi.fn>
  exponentialRampToValueAtTime: ReturnType<typeof vi.fn>
}

function fakeParam(): FakeParam {
  return {
    value: 0,
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
  }
}

function fakeAudioContext() {
  const oscillators: Array<{ frequency: FakeParam; start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }> = []
  const gains: Array<{ gain: FakeParam }> = []
  const ctx = {
    currentTime: 2,
    destination: {},
    createOscillator: vi.fn(() => {
      const osc = { type: 'sine', frequency: fakeParam(), connect: vi.fn(), start: vi.fn(), stop: vi.fn() }
      oscillators.push(osc)
      return osc
    }),
    createGain: vi.fn(() => {
      const gain = { gain: fakeParam(), connect: vi.fn() }
      gains.push(gain)
      return gain
    }),
    createBiquadFilter: vi.fn(() => ({ type: '', frequency: { value: 0 }, connect: vi.fn() })),
  }
  return { ctx: ctx as unknown as AudioContext, oscillators, gains }
}

describe('playPingSound', () => {
  it('schedules a two-strike chime: every oscillator is started and stopped', () => {
    const { ctx, oscillators } = fakeAudioContext()
    playPingSound(ctx)
    // Two strikes, each with a fundamental plus an overtone partial.
    expect(oscillators.length).toBeGreaterThanOrEqual(2)
    for (const osc of oscillators) {
      expect(osc.start).toHaveBeenCalledTimes(1)
      expect(osc.stop).toHaveBeenCalledTimes(1)
    }
  })

  it('keeps the master volume subtle', () => {
    const { ctx, gains } = fakeAudioContext()
    playPingSound(ctx)
    // First gain created is the master out.
    expect(gains[0]!.gain.value).toBeGreaterThan(0)
    expect(gains[0]!.gain.value).toBeLessThanOrEqual(0.2)
  })

  it('shapes each strike with a decay envelope, not a hard cut', () => {
    const { ctx, gains } = fakeAudioContext()
    playPingSound(ctx)
    const envelopes = gains.slice(1)
    expect(envelopes.length).toBeGreaterThan(0)
    for (const env of envelopes) {
      expect(env.gain.exponentialRampToValueAtTime).toHaveBeenCalled()
    }
  })

  it('pitches the chime low — a bong, not a high ping', () => {
    const { ctx, oscillators } = fakeAudioContext()
    playPingSound(ctx)
    const fundamentals = oscillators.map(osc => osc.frequency.value).filter(freq => freq < 700)
    expect(fundamentals.length).toBeGreaterThanOrEqual(2)
  })

  it('is a silent no-op without an audio context (headless, denied audio)', () => {
    expect(() => playPingSound(null)).not.toThrow()
    // Default argument path: no Web Audio in this test environment.
    expect(() => playPingSound()).not.toThrow()
  })
})
