import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { dropScreencastFrames, ensureTakeDir } from '../take'

async function takeWithFrames() {
  const dir = mkdtempSync(join(tmpdir(), 'vos-frames-'))
  const paths = await ensureTakeDir(dir)
  writeFileSync(join(paths.framesDir, '000001.jpg'), Buffer.alloc(1000))
  writeFileSync(join(paths.framesDir, '000002.jpg'), Buffer.alloc(500))
  writeFileSync(paths.framesIndex, '[]')
  return paths
}

describe('releasing the screencast frames', () => {
  it('drops the frames and their index once the recording is on disk', async () => {
    const paths = await takeWithFrames()
    writeFileSync(paths.recording, Buffer.alloc(64))
    expect(await dropScreencastFrames(paths)).toBe(1500)
    expect(existsSync(paths.framesDir)).toBe(false)
    expect(existsSync(paths.framesIndex)).toBe(false)
    expect(existsSync(paths.recording)).toBe(true)
  })

  // The frames are the only copy of the footage until the encode lands.
  it('touches nothing when the recording is missing or empty', async () => {
    const none = await takeWithFrames()
    expect(await dropScreencastFrames(none)).toBe(0)
    expect(existsSync(join(none.framesDir, '000001.jpg'))).toBe(true)

    const empty = await takeWithFrames()
    writeFileSync(empty.recording, Buffer.alloc(0))
    expect(await dropScreencastFrames(empty)).toBe(0)
    expect(existsSync(empty.framesIndex)).toBe(true)
  })

  it('is a no-op on a take that never had frames', async () => {
    const paths = await takeWithFrames()
    writeFileSync(paths.recording, Buffer.alloc(64))
    await dropScreencastFrames(paths)
    expect(await dropScreencastFrames(paths)).toBe(0)
  })
})
