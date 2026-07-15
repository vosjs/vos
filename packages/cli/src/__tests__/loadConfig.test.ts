import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadVosConfig, configDuration } from '../loadConfig'
import { UsageError } from '../args'

const MINIMAL = {
  version: 2,
  duration: 3,
  scene: { background: '#000000' },
  camera: { preset: 'fullscreen' },
  createContent: '(ctx) => {}',
  createTimeline: '(ctx, content, duration) => ctx.gsap.timeline()',
}

async function writeTmp(name: string, value: unknown): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'vos-cli-'))
  const file = join(dir, name)
  await writeFile(file, JSON.stringify(value))
  return file
}

describe('loadVosConfig', () => {
  it('loads and validates a minimal config', async () => {
    const file = await writeTmp('a.json', MINIMAL)
    const { config, warnings } = await loadVosConfig(file)
    expect(configDuration(config)).toBe(3)
    expect(warnings).toEqual([])
  })

  it('unwraps API { config } envelopes', async () => {
    const file = await writeTmp('b.json', { config: MINIMAL })
    const { config, warnings } = await loadVosConfig(file)
    expect(configDuration(config)).toBe(3)
    expect(warnings.some((w) => w.includes('envelope'))).toBe(true)
  })

  it('rejects invalid JSON with a usage error', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vos-cli-'))
    const file = join(dir, 'bad.json')
    await writeFile(file, '{nope')
    await expect(loadVosConfig(file)).rejects.toThrow(UsageError)
  })

  it('rejects configs that fail the schema', async () => {
    const file = await writeTmp('c.json', { version: 2, duration: 3 })
    await expect(loadVosConfig(file)).rejects.toThrow(UsageError)
  })
})
