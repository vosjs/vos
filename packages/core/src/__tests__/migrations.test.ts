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

  it('treats missing version as v1', () => {
    const noVersion = {
      duration: 8,
      repeat: -1,
      camera: { preset: 'perspective' },
      createContent: '() => ({})',
      createTimeline: '() => gsap.timeline()',
    }
    const result = migrateConfig(noVersion)
    expect(result.version).toBe(2)
    expect(result).not.toHaveProperty('repeat')
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
