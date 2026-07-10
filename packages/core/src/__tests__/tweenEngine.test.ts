/**
 * vos tween backend (tweenEngine: 'vos') — template/compiler emission and a
 * behavioral mirror of the engine's exact transport sequences against a
 * RecordingTimeline (the same style as the real-gsap mirrors in editing.test).
 */
import { describe, expect, it } from 'vitest'
import { createTweenRecorder } from '@vosjs/tween'
import { tweenRuntimeCode } from '@vosjs/tween/bundle'
import { compileVosConfig } from '../compiler/compileVosConfig'
import { generateRenderTemplate } from '../runtime/renderTemplate'

const base = {
  version: 2,
  duration: 5,
  camera: { preset: 'perspective' as const },
  createContent: '() => ({ objects: [] })',
  createTimeline: '(ctx, content, duration) => ctx.gsap.timeline()',
}

describe('generateRenderTemplate tweenEngine', () => {
  it("defaults to gsap mode (unchanged): imports gsap, preloads it, no tween bundle", () => {
    const html = generateRenderTemplate('', { mode: 'playback' })
    expect(html).toContain("import gsap from 'gsap';")
    expect(html).not.toContain('__vosTween') // no bundle reference
    expect(html).toMatch(/modulepreload.*gsap/)
    expect(html).toContain('"gsap":') // importmap entry
    expect(html).toContain('const __gsapDep = () => gsap;')
  })

  it('vos mode: no gsap import/preload, bundle inlined, recorder deps, importmap kept', () => {
    const html = generateRenderTemplate('', {
      mode: 'playback',
      tweenEngine: 'vos',
      tweenBundleCode: tweenRuntimeCode,
    })
    expect(html).not.toContain("import gsap from 'gsap';")
    expect(html).not.toMatch(/modulepreload.*gsap/)
    // Legacy compiled artifacts still resolve their (shadowed) gsap import.
    expect(html).toContain('"gsap":')
    expect(html).toContain('globalThis.__vosTween = __vosTween')
    expect(html).toContain(
      'const __gsapDep = () => globalThis.__vosTween.createTweenRecorder();',
    )
  })

  it('vos mode requires the bundle', () => {
    expect(() =>
      generateRenderTemplate('', { mode: 'playback', tweenEngine: 'vos' }),
    ).toThrow(/tweenBundleCode/)
  })

  it('capture modes accept the vos backend too', () => {
    const html = generateRenderTemplate('export const initVos = async () => {}', {
      mode: 'capture-thumbnail',
      tweenEngine: 'vos',
      tweenBundleCode: tweenRuntimeCode,
      capture: { width: 64, height: 64, duration: 1, fps: 30 },
    })
    expect(html).not.toContain("import gsap from 'gsap';")
    expect(html).toContain('globalThis.__vosTween = __vosTween')
  })
})

describe('compileVosConfig tweenEngine', () => {
  it('default emits the gsap import; vos mode omits it (deps supply ctx.gsap)', () => {
    expect(compileVosConfig(base)).toContain("import gsap from 'gsap';")
    const vos = compileVosConfig(base, { tweenEngine: 'vos' })
    expect(vos).not.toContain("import gsap from 'gsap';")
    // ctx.gsap still flows from deps — identical runtime shape.
    expect(vos).toContain('const { THREE, gsap, resolution } = deps;')
  })
})

describe('engine transport sequences against the vos backend', () => {
  const master = () => {
    const rec = createTweenRecorder()
    const tl = rec.timeline({ paused: true })
    tl.to({}, { duration: 5, ease: 'none' })
    tl.data = { vosCarrier: true }
    // The compiled program's exact post-create sequence:
    tl.repeat(-1)
    tl.pause()
    return tl
  }

  it('mirrors the generated __setDuration logic (vosCarrier retiming)', () => {
    const tl = master()
    tl.seek(4, false)

    const s = 2 // shrink below the playhead — must clamp
    const t = Math.min(tl.time(), s)
    tl.clear()
    tl.to({}, { duration: s, ease: 'none' }, 0)
    tl.seek(t, false)

    expect(tl.duration()).toBe(2)
    expect(tl.time()).toBe(2)
    expect(tl.paused()).toBe(true)

    const t2 = Math.min(tl.time(), 10)
    tl.clear()
    tl.to({}, { duration: 10, ease: 'none' }, 0)
    tl.seek(t2, false)
    expect(tl.duration()).toBe(10)
    expect(tl.time()).toBe(2)
  })

  it('mirrors the warm-LOAD transport snapshot/restore', () => {
    const tl = master()
    tl.timeScale(2)
    tl.seek(3, false)
    // __load snapshots …
    const prev = {
      time: tl.time(),
      paused: tl.paused(),
      rate: tl.timeScale(),
    }
    expect(prev).toEqual({ time: 3, paused: true, rate: 2 })
    // … and restores onto the incoming instance
    const next = master()
    next.seek(prev.time as number, false)
    next.timeScale(prev.rate as number)
    if (prev.paused) next.pause()
    expect(next.time()).toBe(3)
    expect(next.paused()).toBe(true)
  })

  it('mirrors __attachProgress (eventCallback getter + chained onUpdate)', () => {
    const tl = master()
    const calls: string[] = []
    tl.eventCallback('onUpdate', () => calls.push('first'))
    // Template chains the existing callback:
    const existing = tl.eventCallback('onUpdate') as (() => void) | null
    expect(typeof existing).toBe('function')
    tl.eventCallback('onUpdate', () => {
      if (existing) existing()
      calls.push('second')
    })
    tl.seek(1, false) // unsuppressed → fires the chained callback
    expect(calls).toEqual(['first', 'second'])
  })

  it('supports kill() (cleanup path)', () => {
    const tl = master()
    expect(() => tl.kill()).not.toThrow()
  })

  it('__finiteDuration works on a recorder master', () => {
    const tl = master()
    // The template helper prefers duration(), falling back to totalDuration().
    let d = tl.duration()
    if (!isFinite(d) || d <= 0) d = tl.totalDuration()
    expect(d).toBe(5)
  })
})
