import { describe, expect, it } from 'vitest'
import { CURRENT_CONFIG_VERSION, migrateConfig } from '../schema/migrations'

describe('migrateConfig', () => {
  it('exports CURRENT_CONFIG_VERSION as 2', () => {
    expect(CURRENT_CONFIG_VERSION).toBe(2)
  })

  it('migrates v1 to v2 by stripping repeat', () => {
    const v1 = {
      version: 1,
      duration: 8,
      repeat: -1,
      camera: { preset: 'perspective' },
      createContent: '() => ({})',
      createTimeline: '() => gsap.timeline()',
    }
    const result = migrateConfig(v1)
    expect(result.version).toBe(2)
    expect(result).not.toHaveProperty('repeat')
    expect(result.duration).toBe(8)
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
    // Absent means "just authored", not "ancient": every config this engine
    // has ever STORED carries a version, so a missing one can only have been
    // written against today's documentation.
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

  it('strips repeat even with non-default value', () => {
    const v1 = {
      version: 1,
      duration: 5,
      repeat: 3,
      camera: { preset: 'fullscreen' },
      createContent: '() => ({})',
      createTimeline: '() => gsap.timeline()',
    }
    const result = migrateConfig(v1)
    expect(result.version).toBe(2)
    expect(result).not.toHaveProperty('repeat')
  })
})
