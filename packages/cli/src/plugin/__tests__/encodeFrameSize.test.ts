/**
 * The encoder never resizes a frame. Its canvas is the take's recorded size
 * (meta.captureWidth/captureHeight, the first frame's own), and a frame of
 * any other size used to be stretched onto it without a word, which would
 * turn a surface that moved mid-take into a distorted video. Now such a
 * take fails to encode, naming the frame and both sizes. Real JPEGs, made
 * by the browser at two sizes, through the CLI's own encode page. Skipped,
 * and said, where no browser launches.
 */
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { encodeRecording } from '../encode'
import type { Browser } from 'playwright'

let browser: Browser | null = null
let skip = ''

beforeAll(async () => {
  try {
    const { launchBrowser } = await import('../../browser')
    browser = await launchBrowser()
  } catch (e) {
    skip = e instanceof Error ? e.message.split('\n')[0] : String(e)
  }
}, 60_000)

afterAll(async () => {
  await browser?.close()
})

/** A JPEG of exactly width x height, from the browser itself. */
async function jpeg(width: number, height: number): Promise<Buffer> {
  const page = await browser!.newPage({ viewport: { width, height } })
  await page.setContent(
    '<body style="margin:0;background:linear-gradient(#e33,#33e);height:100vh"></body>',
  )
  const shot = await page.screenshot({ type: 'jpeg', quality: 60 })
  await page.close()
  return shot
}

async function takeOf(sizes: [number, number][]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'vos-encode-'))
  await mkdir(join(dir, 'frames'))
  const frames = []
  for (const [i, [w, h]] of sizes.entries()) {
    const file = `frame-${String(i).padStart(5, '0')}.jpg`
    await writeFile(join(dir, 'frames', file), await jpeg(w, h))
    frames.push({ file, tMs: i * 100 })
  }
  await writeFile(join(dir, 'frames.json'), JSON.stringify(frames))
  const [w, h] = sizes[0]
  await writeFile(
    join(dir, 'meta.json'),
    JSON.stringify({
      width: 320,
      height: 240,
      captureWidth: w,
      captureHeight: h,
      durationMs: sizes.length * 100,
    }),
  )
  return dir
}

describe('the encoder never resizes a frame', () => {
  it('encodes frames of the recorded size', async () => {
    if (!browser) {
      console.warn(`skipped: no browser (${skip})`)
      return
    }
    const dir = await takeOf([
      [320, 240],
      [320, 240],
      [320, 240],
    ])
    const { bytes } = await encodeRecording(browser, dir, () => {})
    expect(bytes).toBeGreaterThan(0)
    expect(existsSync(join(dir, 'recording.webm'))).toBe(true)
  }, 60_000)

  it('refuses a frame of another size, naming it and both sizes', async () => {
    if (!browser) return
    const dir = await takeOf([
      [320, 240],
      [320, 240],
      [320, 205],
    ])
    await expect(encodeRecording(browser, dir, () => {})).rejects.toThrow(
      /frame-00002\.jpg is 320x205, the take is 320x240.*never resized/,
    )
    expect(existsSync(join(dir, 'recording.webm'))).toBe(false)
  }, 60_000)
})
