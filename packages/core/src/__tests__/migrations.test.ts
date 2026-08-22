import { describe, expect, it } from 'vitest'
import { CURRENT_CONFIG_VERSION, migrateConfig } from '../schema/migrations'
import { vosConfigJsonSchema } from '../schema/configJsonSchema'

describe('migrateConfig', () => {
  it('exports CURRENT_CONFIG_VERSION as 2', () => {
    expect(CURRENT_CONFIG_VERSION).toBe(2)
  })

  it('refuses v1: version 2 is the floor, not a migration target', () => {
    const v1 = {
      version: 1,
      duration: 8,
      repeat: -1,
      camera: { preset: 'perspective' },
      createContent: '() => ({})',
      createTimeline: '() => gsap.timeline()',
    }
    expect(() => migrateConfig(v1)).toThrow(/No migration from config version 1/)
  })

  it('passes through v2 config unchanged', () => {
    const v2 = {
      version: 2,
      duration: 5,
      camera: { preset: 'perspective' },
      createContent: '() => ({})',
      createTimeline: '() => gsap.timeline()',
    }
    const result = migrateConfig(v2)
    expect(result).toEqual(v2)
  })

  it('stamps the current version on an authored config that omits one', () => {
    // A convenience for TRANSIENT work: a scribbled config still compiles.
    // It is not a claim about when the config was written, which is why a
    // host that STORES configs requires the field at that boundary.
    const noVersion = {
      duration: 8,
      camera: { preset: 'perspective' },
      createContent: '() => ({})',
      createTimeline: '() => gsap.timeline()',
    }
    const result = migrateConfig(noVersion)
    expect(result.version).toBe(CURRENT_CONFIG_VERSION)
    expect(result.duration).toBe(8)
  })

  it('refuses a config from a newer engine instead of waving it through', () => {
    const future = {
      version: CURRENT_CONFIG_VERSION + 1,
      duration: 5,
      camera: { preset: 'perspective' },
      createContent: '() => ({})',
      createTimeline: '() => gsap.timeline()',
    }
    expect(() => migrateConfig(future)).toThrow(/newer vos/)
  })

  it('refuses a version that is not a positive integer', () => {
    for (const version of ['2', 0, -1, 1.5, null]) {
      expect(() => migrateConfig({ version, duration: 5 })).toThrow(
        /Invalid config version/,
      )
    }
  })

  it('leaves a stray `repeat` to the schema, which strips unknown keys', () => {
    // The v1 migration existed to drop `repeat`, and the schema does that on
    // its own — which is why removing the migration costs nothing here.
    const v2 = {
      version: 2,
      duration: 5,
      repeat: 3,
      camera: { preset: 'fullscreen' },
      createContent: '() => ({})',
      createTimeline: '() => gsap.timeline()',
    }
    expect(migrateConfig(v2)).toHaveProperty('repeat')
    expect(vosConfigJsonSchema.parse(v2)).not.toHaveProperty('repeat')
  })
})
