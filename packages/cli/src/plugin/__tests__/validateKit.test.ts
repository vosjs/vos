import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { validateKit } from '../validateKit'

describe('validateKit', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'vos-kit-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  async function kit(assets: unknown[]) {
    const p = join(dir, 'kit.json')
    await writeFile(p, JSON.stringify({ release: 'v1', assets }))
    return p
  }

  const cut = (path: string, bytes: number) => ({
    channel: 'x',
    asset: 'feed-cut',
    destination: 'x-feed-cut',
    path,
    w: 1920,
    h: 1080,
    bytes,
    seconds: 40,
  })

  it('names a missing file', async () => {
    const v = await validateKit(await kit([cut('x-feed-cut.mp4', 1)]))
    expect(v.valid).toBe(false)
    expect(v.problems.join('\n')).toMatch(/x-feed-cut\.mp4 is missing/)
  })

  it('catches a manifest that lies about the bytes and a file that is not a video', async () => {
    const junk = Buffer.alloc(64, 7)
    await writeFile(join(dir, 'x-feed-cut.mp4'), junk)
    const v = await validateKit(
      await kit([cut('x-feed-cut.mp4', junk.length + 5)]),
    )
    expect(v.valid).toBe(false)
    const words = v.problems.join('\n')
    expect(words).toMatch(/manifest says \d+ bytes, the file is 64/)
    expect(words).toMatch(/could not read|has no video track/)
  })

  it('a moved kit resolves beside its manifest when the recorded absolute path is gone', async () => {
    await writeFile(join(dir, 'notes.txt'), 'hello')
    const v = await validateKit(
      await kit([
        {
          channel: 'demo',
          asset: 'notes',
          path: '/home/runner/work/_temp/take/kit/notes.txt',
          w: 0,
          h: 0,
          bytes: 5,
          seconds: null,
        },
      ]),
    )
    expect(v.problems).toEqual([])
    expect(v.warnings.join('\n')).toMatch(/not a video the kit verifies/)
  })

  it('a destination with no channel spec is said, not verified', async () => {
    await writeFile(join(dir, 'og-card.mp4'), Buffer.alloc(8))
    const v = await validateKit(
      await kit([
        {
          channel: 'og',
          asset: 'card',
          path: 'og-card.mp4',
          w: 1200,
          h: 630,
          bytes: 8,
          seconds: 1,
        },
      ]),
    )
    expect(v.warnings.join('\n')).toMatch(/no channel spec for "og-card"/)
  })
})
