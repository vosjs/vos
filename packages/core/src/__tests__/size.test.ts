import { describe, expect, it } from 'vitest'
import { vosConfigJsonSchema } from '../schema/configJsonSchema'
import { migrateConfig } from '../schema/migrations'
import {
  aspectLabel,
  evenEdge,
  fitWithinEdges,
  programSize,
  resolveOutputSize,
} from '../schema/size'

const base = {
  version: 2,
  duration: 4,
  camera: { preset: 'fullscreen' },
  createContent: '() => ({ objects: [] })',
  createTimeline: '(ctx) => ctx.gsap.timeline()',
}

describe('size in the config schema', () => {
  it('keeps a declared size through migrate and parse', () => {
    const config = { ...base, size: { width: 1080, height: 1920 } }
    const parsed = vosConfigJsonSchema.parse(migrateConfig(config))
    expect(parsed.size).toEqual({ width: 1080, height: 1920 })
  })

  it('accepts any shape, not a preset list', () => {
    for (const size of [
      { width: 1080, height: 1080 },
      { width: 1080, height: 1350 },
      { width: 2560, height: 1080 },
      { width: 1000, height: 333 },
    ]) {
      expect(vosConfigJsonSchema.safeParse({ ...base, size }).success).toBe(
        true,
      )
    }
  })

  it('refuses a malformed size', () => {
    for (const size of [
      { width: 1080 },
      { width: 0, height: 1920 },
      { width: 1080.5, height: 1920 },
      { width: 9000, height: 1920 },
      { width: '1080', height: 1920 },
      { width: 1080, height: 1920, aspect: '9:16' },
    ]) {
      expect(vosConfigJsonSchema.safeParse({ ...base, size }).success).toBe(
        false,
      )
    }
  })

  it('stays optional', () => {
    expect(vosConfigJsonSchema.safeParse(base).success).toBe(true)
  })
})

describe('programSize', () => {
  it('reads a valid size', () => {
    expect(programSize({ size: { width: 1080, height: 1920 } })).toEqual({
      width: 1080,
      height: 1920,
    })
  })
  it('never guesses from a missing or malformed one', () => {
    expect(programSize({})).toBeUndefined()
    expect(programSize(null)).toBeUndefined()
    expect(programSize({ size: { width: -1, height: 2 } })).toBeUndefined()
  })
})

describe('resolveOutputSize', () => {
  const fallback = { width: 1920, height: 1080 }
  const portrait = { width: 1080, height: 1920 }

  it('uses the declared size when no edge is given', () => {
    expect(resolveOutputSize({ declared: portrait, fallback })).toEqual({
      width: 1080,
      height: 1920,
      source: 'declared',
    })
  })

  it('falls back when the program declares none', () => {
    expect(resolveOutputSize({ fallback })).toEqual({
      width: 1920,
      height: 1080,
      source: 'default',
    })
  })

  it('derives the missing edge from the declared aspect, rounded even', () => {
    expect(
      resolveOutputSize({ declared: portrait, width: 720, fallback }),
    ).toEqual({ width: 720, height: 1280, source: 'derived' })
    expect(
      resolveOutputSize({ declared: portrait, height: 3840, fallback }),
    ).toEqual({ width: 2160, height: 3840, source: 'derived' })
    // 4:5 at an odd-producing width
    expect(
      resolveOutputSize({
        declared: { width: 1080, height: 1350 },
        width: 999,
        fallback,
      }),
    ).toEqual({ width: 999, height: 1248, source: 'derived' })
  })

  it('derives from the fallback aspect when nothing is declared', () => {
    expect(resolveOutputSize({ width: 1280, fallback })).toEqual({
      width: 1280,
      height: 720,
      source: 'derived',
    })
  })

  it('lets both edges win as given', () => {
    expect(
      resolveOutputSize({
        declared: portrait,
        width: 800,
        height: 800,
        fallback,
      }),
    ).toEqual({ width: 800, height: 800, source: 'flags' })
  })
})

describe('fitWithinEdges', () => {
  const caps = { long: 1920, short: 1080 }
  it('treats caps as long and short edges, so portrait fits like landscape', () => {
    expect(fitWithinEdges({ width: 1080, height: 1920 }, caps)).toEqual({
      width: 1080,
      height: 1920,
    })
  })
  it('scales down keeping the aspect', () => {
    expect(fitWithinEdges({ width: 2160, height: 3840 }, caps)).toEqual({
      width: 1080,
      height: 1920,
    })
    expect(fitWithinEdges({ width: 4000, height: 1000 }, caps)).toEqual({
      width: 1920,
      height: 480,
    })
  })
  it('never scales up', () => {
    expect(fitWithinEdges({ width: 640, height: 640 }, caps)).toEqual({
      width: 640,
      height: 640,
    })
  })
})

describe('helpers', () => {
  it('evenEdge rounds to even, never below 2', () => {
    expect(evenEdge(1247.5)).toBe(1248)
    expect(evenEdge(1249)).toBe(1250)
    expect(evenEdge(0.4)).toBe(2)
  })
  it('aspectLabel reduces the ratio', () => {
    expect(aspectLabel({ width: 1080, height: 1920 })).toBe('9:16')
    expect(aspectLabel({ width: 2560, height: 1080 })).toBe('64:27')
    expect(aspectLabel({ width: 1080, height: 1350 })).toBe('4:5')
  })
})
