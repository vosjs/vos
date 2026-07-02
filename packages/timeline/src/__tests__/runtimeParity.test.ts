import { buildSync } from 'esbuild'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { mapTime, sample, totalDuration } from '../index'
import type { KeyframeTrack, Segment } from '../types'

/**
 * The host/sandbox parity guarantee: the IIFE string that app lowerings inline
 * into running programs must evaluate EXACTLY like the module the host imports.
 * We build the runtime entry the same way bundle.mjs does, evaluate the string
 * in an isolated scope, and compare golden vectors against direct imports.
 */
const __dirname = dirname(fileURLToPath(import.meta.url))

function evalRuntimeString(): {
  sample: typeof sample
  mapTime: typeof mapTime
  totalDuration: typeof totalDuration
} {
  const { outputFiles } = buildSync({
    entryPoints: [resolve(__dirname, '../runtime.ts')],
    bundle: true,
    format: 'iife',
    globalName: '__vosTimeline',
    target: 'es2020',
    minify: true,
    write: false,
  })
  const code = `${outputFiles[0].text};globalThis.__vosTimeline = __vosTimeline;`
  const scope: Record<string, unknown> = {}
  // Same shape as inlining into a function-string: a nested function scope
  // with only `globalThis` shared.
  new Function('globalThis', code)(scope)
  return scope.__vosTimeline as ReturnType<typeof evalRuntimeString>
}

describe('runtime bundle ↔ host module parity', () => {
  const rt = evalRuntimeString()

  const track: KeyframeTrack = {
    keyframes: [
      { t: 0, value: 1 },
      { t: 0.8, value: 2.4, ease: 'power2.inOut' },
      { t: 2, value: 2.4 },
      { t: 2.5, value: 1, ease: 'sine.out' },
    ],
  }
  const segs: Segment[] = [
    { in: 1.25, out: 4 },
    { in: 6, out: 9.5 },
  ]

  it('sample() agrees on a dense golden sweep', () => {
    for (let i = 0; i <= 300; i++) {
      const t = -0.5 + i * 0.0125
      expect(rt.sample(track, t)).toBe(sample(track, t))
    }
  })

  it('mapTime()/totalDuration() agree on a dense golden sweep', () => {
    expect(rt.totalDuration(segs)).toBe(totalDuration(segs))
    for (let i = 0; i <= 300; i++) {
      const t = -1 + i * 0.03
      expect(rt.mapTime(segs, t)).toBe(mapTime(segs, t))
    }
  })

  it('exposes only evaluation (editing helpers stay host-side)', () => {
    expect(rt).not.toHaveProperty('splitSegments')
    expect(rt).not.toHaveProperty('trimSegment')
  })
})
