import { describe, expect, it } from 'vitest'
import { VOS_BRIDGE_PROTOCOL } from '../runtime/bridge'
import { generateRenderTemplate } from '../runtime/renderTemplate'

// Protocol 8: SET_TWEEN_EDITS retimes the running program's recorded tweens
// live; the overlay survives a warm LOAD and rides LOAD.tweenEdits; READY
// says whether the timeline honors it.

describe('tween edits, live (protocol 8)', () => {
  const html = generateRenderTemplate('')

  it('bumps the protocol', () => {
    expect(VOS_BRIDGE_PROTOCOL).toBe(8)
  })

  it('applies the overlay to the running timeline and reports the new duration', () => {
    expect(html).toContain("case 'SET_TWEEN_EDITS':")
    expect(html).toContain('tl.applyEdits(__tweenEdits)')
    // Repaint under the playhead, clamped to the new length, then an UPDATE.
    expect(html).toContain(
      'tl.seek(Math.max(0, Math.min(tl.time(), dur)), false)',
    )
  })

  it('the overlay survives a warm LOAD and rides LOAD.tweenEdits', () => {
    expect(html).toContain(
      'if (payload && payload.tweenEdits != null) __tweenEdits = payload.tweenEdits;',
    )
    expect(html).toContain(
      "if (tl && __tweenEdits && typeof tl.applyEdits === 'function')",
    )
  })

  it('READY advertises the capability', () => {
    expect(html).toContain(
      "canRetimeTweens: !!(tl && typeof tl.applyEdits === 'function')",
    )
  })
})
