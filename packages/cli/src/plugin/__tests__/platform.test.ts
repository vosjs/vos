import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  clientId,
  parseVosId,
  platformOrigin,
  readSyncState,
  writeSyncState,
} from '../platform'
import { preflightConfig } from '../program'
import { UsageError } from '../args'

describe('platformOrigin', () => {
  const saved = { ...process.env }
  beforeEach(() => {
    delete process.env.VOS_ORIGIN
    delete process.env.VOS_API_BASE
  })
  afterEach(() => {
    process.env.VOS_ORIGIN = saved.VOS_ORIGIN
    process.env.VOS_API_BASE = saved.VOS_API_BASE
    if (saved.VOS_ORIGIN === undefined) delete process.env.VOS_ORIGIN
    if (saved.VOS_API_BASE === undefined) delete process.env.VOS_API_BASE
  })

  it('defaults to https://vos.so', () => {
    expect(platformOrigin()).toBe('https://vos.so')
  })

  it('reads VOS_ORIGIN and strips trailing slashes', () => {
    process.env.VOS_ORIGIN = 'http://localhost:6060/'
    expect(platformOrigin()).toBe('http://localhost:6060')
  })

  it('accepts the legacy VOS_API_BASE shape (origin + /api)', () => {
    process.env.VOS_API_BASE = 'http://localhost:6060/api'
    expect(platformOrigin()).toBe('http://localhost:6060')
  })

  it('VOS_ORIGIN wins over the legacy env; flags win over both', () => {
    process.env.VOS_ORIGIN = 'http://a.example'
    process.env.VOS_API_BASE = 'http://b.example/api'
    expect(platformOrigin()).toBe('http://a.example')
    expect(platformOrigin({ origin: 'http://c.example' })).toBe(
      'http://c.example',
    )
    expect(platformOrigin({ api: 'http://d.example/api' })).toBe(
      'http://d.example',
    )
  })
})

describe('clientId', () => {
  // A clean environment and no /opt/.devin: the suite itself may run inside
  // an agent's shell, which would otherwise name that agent.
  const none = () => false

  it('defaults to vos-cli when no agent is present', () => {
    expect(clientId({}, none)).toBe('vos-cli')
  })

  it('honors VOS_CLIENT (the agent names its tool)', () => {
    expect(
      clientId({ VOS_CLIENT: 'claude-code/2.1', CLAUDECODE: '1' }, none),
    ).toBe('claude-code/2.1')
  })

  it('rejects oversize and multi-line overrides, falling to detection', () => {
    expect(clientId({ VOS_CLIENT: 'x'.repeat(61) }, none)).toBe('vos-cli')
    expect(clientId({ VOS_CLIENT: 'bad\nclient' }, none)).toBe('vos-cli')
    expect(clientId({ VOS_CLIENT: '   ', CLAUDECODE: '1' }, none)).toBe(
      'claude-code vos-cli',
    )
  })

  it('names the host agent it was spawned by', () => {
    expect(clientId({ CLAUDECODE: '1' }, none)).toBe('claude-code vos-cli')
    expect(clientId({ AI_AGENT: 'claude-code_2-1-284_agent' }, none)).toBe(
      'claude-code vos-cli',
    )
  })
})

describe('parseVosId', () => {
  it('accepts bare ids, watch, embed and query URLs', () => {
    expect(parseVosId('abc_12-3')).toBe('abc_12-3')
    expect(parseVosId('https://vos.so/vos/xyz')).toBe('xyz')
    expect(parseVosId('https://vos.so/embed/vos/xyz')).toBe('xyz')
    expect(parseVosId('https://vos.so/studio?vos=xyz')).toBe('xyz')
  })

  it('rejects things that are neither', () => {
    expect(() => parseVosId('not an id!')).toThrow(UsageError)
    expect(() => parseVosId('https://vos.so/gallery')).toThrow(UsageError)
  })
})

describe('sync state (vos.json + legacy reads)', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'vos-plugin-test-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('round-trips vos.json and merge-writes patches', () => {
    writeSyncState(dir, { vosId: 'v1', versionId: 'ver1', title: 'T' })
    writeSyncState(dir, { vosId: 'v1', versionId: 'ver2' })
    expect(readSyncState(dir)).toMatchObject({
      vosId: 'v1',
      versionId: 'ver2',
      title: 'T',
    })
  })

  it('reads the legacy take push.json', () => {
    writeFileSync(
      join(dir, 'push.json'),
      JSON.stringify({ vosId: 'v2', versionId: 'ver9', pushedAt: 'x' }),
    )
    expect(readSyncState(dir)).toMatchObject({ vosId: 'v2', versionId: 'ver9' })
  })

  it('reads the legacy program meta.json (id + currentVersionId)', () => {
    writeFileSync(
      join(dir, 'meta.json'),
      JSON.stringify({ id: 'v3', currentVersionId: 'ver3', slug: 's' }),
    )
    expect(readSyncState(dir)).toMatchObject({
      vosId: 'v3',
      versionId: 'ver3',
      slug: 's',
    })
  })

  it("never misreads a take's RecordingMeta meta.json as sync state", () => {
    writeFileSync(
      join(dir, 'meta.json'),
      JSON.stringify({
        width: 1280,
        height: 720,
        durationMs: 9000,
        producer: 'cli',
      }),
    )
    expect(readSyncState(dir)).toBeNull()
  })

  it('vos.json wins over both legacy files', () => {
    writeFileSync(
      join(dir, 'push.json'),
      JSON.stringify({ vosId: 'old', versionId: 'o' }),
    )
    writeSyncState(dir, { vosId: 'new', versionId: 'n' })
    expect(readSyncState(dir)?.vosId).toBe('new')
  })
})

describe('preflightConfig', () => {
  it('rejects non-objects', () => {
    const r = preflightConfig('nope')
    expect(r.ok).toBe(false)
    expect(r.issues[0]).toContain('not a JSON object')
  })

  it('reports schema issues instead of throwing', () => {
    const r = preflightConfig({ version: 2, createTimeline: 42 })
    expect(r.ok).toBe(false)
    expect(r.config).toBeNull()
    expect(r.issues.length).toBeGreaterThan(0)
  })

  it('refuses to push a config that declares no version', () => {
    // Migrating an absent version would stamp a GUESS about when the file was
    // authored, and a config.json outlives the era it was written in.
    const r = preflightConfig({
      duration: 5,
      camera: { preset: 'fullscreen' },
      createContent: '() => ({})',
      createTimeline: '() => gsap.timeline()',
    })
    expect(r.ok).toBe(false)
    expect(r.config).toBeNull()
    expect(r.issues[0]).toContain('"version"')
  })
})
