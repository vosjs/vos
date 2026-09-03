import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadVosConfig, configDuration, directoryKind } from '../loadConfig'
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

describe('directories', () => {
  async function dirWith(files: Record<string, unknown>): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'vos-cli-dir-'))
    for (const [name, value] of Object.entries(files)) {
      await writeFile(
        join(dir, name),
        typeof value === 'string' ? value : JSON.stringify(value),
      )
    }
    return dir
  }

  it('tells a take from a program directory by what doc.json carries', async () => {
    const take = await dirWith({ 'doc.json': { source: { videoKey: 'x' } } })
    const program = await dirWith({ 'config.json': MINIMAL })
    const programWithDoc = await dirWith({
      'config.json': MINIMAL,
      'doc.json': { docSchemaVersion: 2, program: {} },
    })
    const broken = await dirWith({ 'doc.json': '{not json' })
    const empty = await dirWith({})
    expect(directoryKind(take)).toBe('take')
    expect(directoryKind(program)).toBe('program')
    expect(directoryKind(programWithDoc)).toBe('program')
    expect(directoryKind(broken)).toBe('take')
    expect(directoryKind(empty)).toBe('none')
    expect(directoryKind(join(program, 'config.json'))).toBe('none')
    expect(directoryKind(join(empty, 'missing'))).toBe('none')
  })

  it('loads a program directory from its config.json', async () => {
    const dir = await dirWith({ 'config.json': MINIMAL })
    const { config, warnings } = await loadVosConfig(dir)
    expect(configDuration(config)).toBe(3)
    expect(warnings).toEqual([])
    expect(config.stack).toBeUndefined()
  })

  it('composes a program directory with its program document', async () => {
    const dir = await dirWith({
      'config.json': MINIMAL,
      'doc.json': {
        docSchemaVersion: 2,
        program: {},
        overlays: [
          {
            id: 't0',
            kind: 'text',
            start: 0.5,
            duration: 1,
            text: 'Ship it',
            preset: 'title',
            transform: { x: 0.5, y: 0.8, scale: 1, rotation: 0 },
          },
        ],
      },
    })
    const { config, warnings } = await loadVosConfig(dir)
    expect(configDuration(config)).toBe(3)
    expect(warnings.some((w) => w.includes('composed'))).toBe(true)
    const stack = config.stack as {
      id: string
      data: Record<string, unknown>
    }[]
    expect(stack.map((e) => e.id)).toEqual(['vosso.studio'])
    expect(
      (stack[0].data.overlays as { id: string }[]).map((o) => o.id),
    ).toEqual(['t0'])
  })

  it('refuses a take directory in words that name the take pipeline', async () => {
    const dir = await dirWith({ 'doc.json': { source: { videoKey: 'x' } } })
    await expect(loadVosConfig(dir)).rejects.toThrow(UsageError)
    await expect(loadVosConfig(dir)).rejects.toThrow(/vos render/)
  })

  it('refuses a directory that holds neither', async () => {
    const dir = await dirWith({ 'notes.md': '# hi' })
    await expect(loadVosConfig(dir)).rejects.toThrow(UsageError)
    await expect(loadVosConfig(dir)).rejects.toThrow(/no config.json/)
  })
})
