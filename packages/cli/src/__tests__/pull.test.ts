import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { formatChanges, readMeta, writeMeta } from '../platform'

describe('formatChanges', () => {
  it('renders attributed lines with labels and notes', () => {
    const lines = formatChanges([
      {
        versionId: 'v-2',
        versionNumber: 2,
        origin: 'studio',
        label: 'warmer',
        note: 'nudged the palette after review',
        summary: 'param hue 0.2 → 0.35; zoom z1 level 1.6 → 1.8',
      },
      { versionNumber: 3, origin: 'agent', summary: 'speed span added 4–7s' },
    ])
    expect(lines).toEqual([
      'v2 (studio · warmer): param hue 0.2 → 0.35; zoom z1 level 1.6 → 1.8',
      '    note: nudged the palette after review',
      'v3 (agent): speed span added 4–7s',
    ])
  })

  it('tolerates sparse entries', () => {
    expect(formatChanges([{}])).toEqual(['v? (unknown): '])
  })
})

describe('meta tracking', () => {
  let dir: string
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('round-trips and merges patches', () => {
    dir = mkdtempSync(join(tmpdir(), 'vos-meta-'))
    expect(readMeta(dir)).toBeNull()
    writeMeta(dir, { id: 'abc', currentVersionId: 'v1', title: 'T' })
    writeMeta(dir, { currentVersionId: 'v2' })
    const meta = readMeta(dir)
    expect(meta).toMatchObject({ id: 'abc', currentVersionId: 'v2', title: 'T' })
    // pretty-printed on disk (human-inspectable, diff-friendly)
    expect(readFileSync(join(dir, 'meta.json'), 'utf8')).toContain('\n  "id"')
  })
})
