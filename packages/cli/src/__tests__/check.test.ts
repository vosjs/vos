import { describe, expect, it } from 'vitest'
import { runCheck } from '../check'

const VALID = {
  version: 2,
  duration: 4,
  camera: { preset: 'fullscreen' },
  createContent:
    '(ctx) => { const m = new ctx.THREE.Mesh(new ctx.THREE.PlaneGeometry(2,2)); ctx.scene.add(m); return { objects: [m], refs: {}, dispose: () => {} } }',
  createTimeline:
    '(ctx, content, duration) => { const tl = ctx.gsap.timeline({ paused: true }); return tl }',
}

describe('runCheck', () => {
  it('passes a valid config with no errors', () => {
    const r = runCheck(VALID)
    expect(r.ok).toBe(true)
    expect(r.errors).toBe(0)
    expect(r.config).not.toBeNull()
  })

  it('unwraps { config } API envelopes', () => {
    const r = runCheck({ config: VALID })
    expect(r.ok).toBe(true)
  })

  it('fails a v1 config: version 2 is the floor', () => {
    const { version: _v, ...rest } = VALID
    const r = runCheck({ ...rest, version: 1, repeat: 3 })
    expect(r.ok).toBe(false)
    expect(
      r.issues.some((i) => i.level === 'error' && /version 1/.test(i.message)),
    ).toBe(true)
  })

  it('warns that a version-less config plays but will not push', () => {
    const { version: _v, ...rest } = VALID
    const r = runCheck(rest)
    expect(r.ok).toBe(true)
    expect(
      r.issues.some(
        (i) => i.level === 'warn' && /Add "version": 2/.test(i.message),
      ),
    ).toBe(true)
  })

  it('preserves params/presets through the pipeline without warnings', () => {
    const withParams = {
      ...VALID,
      params: [
        {
          key: 'hue',
          label: 'Hue',
          kind: 'number',
          min: 0,
          max: 1,
          default: 0.5,
        },
      ],
      presets: [{ name: 'Calm', values: { hue: 0.3 } }],
    }
    const r = runCheck(withParams)
    expect(r.ok).toBe(true)
    expect(r.issues.filter((i) => i.source === 'shape')).toHaveLength(0)
    expect(r.config).toHaveProperty('params')
    expect(r.config).toHaveProperty('presets')
  })

  it('warns on unknown top-level keys the platform would drop', () => {
    const r = runCheck({ ...VALID, myExtra: true })
    expect(r.ok).toBe(true)
    expect(
      r.issues.some((i) => i.source === 'shape' && /myExtra/.test(i.message)),
    ).toBe(true)
  })

  it('fails schema on a missing createTimeline', () => {
    const { createTimeline: _t, ...rest } = VALID
    const r = runCheck(rest)
    expect(r.ok).toBe(false)
    expect(r.issues.some((i) => i.source === 'schema')).toBe(true)
  })

  it('fails on a function string with a syntax error', () => {
    const r = runCheck({ ...VALID, createTimeline: '(ctx => {' })
    expect(r.ok).toBe(false)
    expect(
      r.issues.some(
        (i) => i.source === 'syntax' && /createTimeline/.test(i.message),
      ),
    ).toBe(true)
  })

  it('flags non-deterministic function bodies', () => {
    const r = runCheck({
      ...VALID,
      createTimeline:
        '(ctx, content, duration) => { const tl = ctx.gsap.timeline({ paused: true }); const x = Math.random(); tl.to({}, { duration: x }); return tl }',
    })
    expect(r.issues.some((i) => i.source === 'determinism')).toBe(true)
  })

  it('rejects non-objects', () => {
    expect(runCheck([1, 2]).ok).toBe(false)
    expect(runCheck('nope').ok).toBe(false)
    expect(runCheck(null).ok).toBe(false)
  })
})
