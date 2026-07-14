import { describe, expect, it } from 'vitest'
import {
  initialsFrom,
  runStatusDotClass,
  runStatusTag,
  sessionDotClass,
  sessionStatusTag,
} from './sidebarStatus.js'

describe('sessionStatusTag', () => {
  it('maps attention-needing kinds to short tags', () => {
    expect(sessionStatusTag('working', false)).toBe('Working')
    expect(sessionStatusTag('needs-approval', false)).toBe('Approve')
    expect(sessionStatusTag('awaiting-review', false)).toBe('Review')
    expect(sessionStatusTag('error', false)).toBe('Error')
  })

  it('shows Done only for the just-finished flash', () => {
    expect(sessionStatusTag('ready', true)).toBe('Done')
    expect(sessionStatusTag('ready', false)).toBeNull()
    expect(sessionStatusTag('unread', false)).toBeNull()
  })

  it('prefers the live kind over the just-finished flash', () => {
    expect(sessionStatusTag('error', true)).toBe('Error')
    expect(sessionStatusTag('working', true)).toBe('Working')
  })
})

describe('runStatusTag', () => {
  it('maps every run status to its tag', () => {
    expect(runStatusTag('working')).toBe('Working')
    expect(runStatusTag('needs-approval')).toBe('Approve')
    expect(runStatusTag('needs-input')).toBe('Input')
    expect(runStatusTag('ready-to-review')).toBe('Review')
    expect(runStatusTag('error')).toBe('Error')
    expect(runStatusTag('done')).toBeNull()
    expect(runStatusTag('paused')).toBe('Paused')
    expect(runStatusTag('cancelled')).toBe('Cancelled')
    expect(runStatusTag('stopped')).toBe('Stopped')
    expect(runStatusTag('idle')).toBeNull()
    expect(runStatusTag('missing')).toBe('Missing')
    expect(runStatusTag('ready')).toBeNull()
  })
})

// Agent sessions map onto the shared run vocabulary (runs store:
// running→working/needs-input/done/idle, done→done, stopped→stopped,
// interrupted→stopped, error→error). Pin every status they can produce so the
// shared mapping cannot silently lose one.
describe('agent session status vocabulary', () => {
  const agentStatuses = ['working', 'needs-input', 'idle', 'done', 'error', 'stopped'] as const

  it('has a tag or null for every agent session status', () => {
    for (const status of agentStatuses) {
      const tag = runStatusTag(status)
      if (status === 'idle' || status === 'done') expect(tag).toBeNull()
      else expect(tag).not.toBeNull()
    }
  })

  it('has a dot class for every agent session status', () => {
    expect(runStatusDotClass('working')).toBe('')
    expect(runStatusDotClass('needs-input')).toBe('bg-accent')
    expect(runStatusDotClass('idle')).toBe('')
    expect(runStatusDotClass('done')).toBe('')
    expect(runStatusDotClass('error')).toBe('bg-rem')
    expect(runStatusDotClass('stopped')).toBe('')
  })
})

describe('runStatusDotClass', () => {
  it('uses accent for attention states, rem for failures, nothing for idle/working/done', () => {
    expect(runStatusDotClass('working')).toBe('')
    expect(runStatusDotClass('needs-input')).toBe('bg-accent')
    expect(runStatusDotClass('needs-approval')).toBe('bg-accent')
    expect(runStatusDotClass('ready-to-review')).toBe('bg-accent')
    expect(runStatusDotClass('done')).toBe('')
    expect(runStatusDotClass('error')).toBe('bg-rem')
    expect(runStatusDotClass('missing')).toBe('bg-rem')
    expect(runStatusDotClass('paused')).toBe('')
    expect(runStatusDotClass('ready')).toBe('')
  })
})

describe('sessionDotClass', () => {
  it('shows accent dot for attention, red for error, nothing for idle/working/done', () => {
    expect(sessionDotClass('working', false)).toBe('')
    expect(sessionDotClass('needs-approval', false)).toBe('bg-accent')
    expect(sessionDotClass('awaiting-review', false)).toBe('bg-accent')
    expect(sessionDotClass('error', false)).toBe('bg-rem')
    expect(sessionDotClass('ready', true)).toBe('')
    expect(sessionDotClass('unread', false)).toBe('')
    expect(sessionDotClass('ready', false)).toBe('')
    expect(sessionDotClass('done', false)).toBe('')
  })
})

describe('initialsFrom', () => {
  it('takes the first letters of the first two words', () => {
    expect(initialsFrom('Refactor auth')).toBe('RA')
    expect(initialsFrom('pricing model review')).toBe('PM')
  })

  it('takes the first two characters of a single word', () => {
    expect(initialsFrom('Onboarding')).toBe('ON')
    expect(initialsFrom('x')).toBe('X')
  })

  it('falls back to a middle dot for empty titles', () => {
    expect(initialsFrom('')).toBe('·')
    expect(initialsFrom('   ')).toBe('·')
  })
})
