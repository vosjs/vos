import { describe, expect, it } from 'vitest'
import { knobProblem, knobWarnings } from '../knobs'
import { runCheck } from '../../check'

const knob = (key: string, extra: Record<string, unknown> = {}) => ({
  key,
  kind: 'text',
  default: key,
  ...extra,
})

describe('what vos.so keeps of the knobs', () => {
  it('names the thirteenth knob, and only it', () => {
    const params = Array.from({ length: 13 }, (_, i) => knob(`k${i}`))
    expect(knobWarnings({ params })).toEqual([
      'knob "k12" would be dropped on vos.so: a vos keeps at most 12 knobs (the rest can stay bound data)',
    ])
  })

  it('names an invalid knob by its key and reason, and counts only the valid', () => {
    const params = [knob('a', { hint: 'x'.repeat(141) }), knob('b')]
    expect(knobWarnings({ params })).toEqual([
      'knob "a" would be dropped on vos.so (hint: at most 140 characters)',
    ])
    expect(knobProblem(knob('ok'))).toBeNull()
  })

  it('keeps a file knob, which carries no default of its own', () => {
    expect(knobProblem({ key: 'logo', kind: 'asset' })).toBeNull()
    expect(
      knobProblem({ key: 'logo', kind: 'asset', accept: ['image', 'video'] }),
    ).toBeNull()
    expect(
      knobProblem({ key: 'logo', kind: 'asset', accept: 'image' }),
    ).toBeNull()
    // Every other kind still needs one.
    expect(knobProblem({ key: 'title', kind: 'text' })).toBe(
      'default must be a number, a boolean or at most 280 characters',
    )
  })

  it('refuses a file knob whose accept names anything but a kind of file', () => {
    const reason =
      'accept: one or more of image, video, audio, model, font, hdr'
    for (const accept of [['picture'], [''], [3], [], 'picture']) {
      expect(knobProblem({ key: 'logo', kind: 'asset', accept })).toBe(reason)
    }
    expect(
      knobProblem({
        key: 'logo',
        kind: 'asset',
        accept: ['image', 'video', 'audio', 'model', 'font', 'hdr'],
      }),
    ).toBeNull()
  })

  it('vos check reports it as a warning, and still passes', () => {
    const r = runCheck({
      version: 2,
      duration: 4,
      camera: { preset: 'fullscreen' },
      createContent:
        '(ctx) => { const m = new ctx.THREE.Mesh(new ctx.THREE.PlaneGeometry(2,2)); ctx.scene.add(m); return { objects: [m], refs: {}, dispose: () => {} } }',
      createTimeline:
        '(ctx, content, duration) => { const tl = ctx.gsap.timeline({ paused: true }); return tl }',
      params: Array.from({ length: 13 }, (_, i) => knob(`k${i}`)),
    })
    expect(r.ok).toBe(true)
    expect(
      r.issues.some(
        (i) => i.level === 'warn' && /k12" would be dropped/.test(i.message),
      ),
    ).toBe(true)
  })
})
