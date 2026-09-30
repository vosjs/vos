import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { STUDIO_ENTRY_ID } from '@vosjs/studio-core'
import { programAudio } from '../programAudio'

/**
 * A local render of a program mixes the sound its document adds. The capture
 * page has no origin, so every clip it cannot fetch by itself is inlined, and
 * a clip that cannot be reached is left out in words, never silently.
 */
function composed(keys: string[]): Record<string, unknown> {
  return {
    version: 2,
    duration: 4,
    stack: [
      {
        id: STUDIO_ENTRY_ID,
        data: {
          audio: keys.map((key) => ({
            key,
            start: 0,
            in: 0,
            out: 4,
            gain: 1,
            loop: false,
            len: 4,
            duck: false,
            env: [],
          })),
          duckEnv: [],
        },
      },
    ],
  }
}

describe('programAudio', () => {
  it('is null when the program adds no sound', async () => {
    const r = await programAudio(
      { version: 2 },
      { baseDir: '.', duration: 4, log: () => {} },
    )
    expect(r).toBeNull()
  })

  it('inlines a file beside the document and says what it could not reach', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vos-audio-'))
    writeFileSync(
      join(dir, 'score.ogg'),
      Buffer.from('OggS\0\u0002\0\0\0\0\0\0\0\0\0\0'),
    )
    const lines: string[] = []
    const r = await programAudio(
      composed(['score.ogg', 'missing.ogg', '/api/assets/a1/file']),
      { baseDir: dir, duration: 4, key: null, log: (l) => lines.push(l) },
    )
    expect(r?.clips).toBe(1)
    expect(r?.producerCode).toContain('data:audio/ogg;base64,')
    expect(lines.some((l) => l.includes('missing.ogg'))).toBe(true)
    expect(lines.some((l) => l.includes('no credential'))).toBe(true)
  })

  it('passes an absolute URL through untouched', async () => {
    const r = await programAudio(
      composed(['https://assets.vos.so/music/bed.mp3']),
      { baseDir: '.', duration: 4, log: () => {} },
    )
    expect(r?.producerCode).toContain('https://assets.vos.so/music/bed.mp3')
  })
})
