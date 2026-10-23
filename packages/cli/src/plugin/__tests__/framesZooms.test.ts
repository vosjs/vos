/**
 * `vos frames --at-zooms` tells the truth: it stills the apex of every zoom
 * span on every media of the take, at the output time the span plays, and
 * renders each apex again with the zooms off, so a zoom whose frame matches
 * its zoom-off twin is flagged instead of passing as a still.
 *
 * The apex list is pure; the render half runs a real browser over a take
 * made here (two generated recordings), skipped and said where no browser
 * launches or the engine's modules cannot be fetched.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closeBrowser } from './closeBrowser'
import {
  DEFAULT_CAM_STYLE,
  DEFAULT_CURSOR_STYLE,
  DEFAULT_FRAME_STYLE,
} from '@vosjs/studio-core'
import { esmShModules } from '@vosjs/core/addons'
import { ZOOM_UNRENDERED_BELOW, framesTake, zoomApexes } from '../framesTake'
import { makeFixtureVideo } from './videoFixture'
import type { ProjectDoc, RecordingMeta } from '@vosjs/studio-core'
import type { Browser } from 'playwright'

const meta = (seconds: number): RecordingMeta => ({
  dpr: 1,
  zoom: 1,
  t0: 0,
  durationMs: seconds * 1000,
  width: 320,
  height: 180,
  fps: 15,
})

/**
 * Six seconds of the primary, then three of media `b`. z1 zooms the
 * primary, z2 zooms `b` (its seconds are b's, so it plays at 6.5..7.5),
 * z3 is a span at level 1 (present, and nothing to see), z4 sits in the
 * primary's last two seconds, which the cut drops.
 */
function takeDoc(): ProjectDoc {
  return {
    source: { videoKey: 'recording.webm', cursor: [], meta: meta(8) },
    media: [{ id: 'b', videoKey: 'b.webm', cursor: [], meta: meta(3) }],
    segments: [
      { in: 0, out: 6 },
      { in: 0, out: 3, media: 'b' },
    ],
    zoom: [
      { id: 'z1', in: 1, out: 2, level: 2, cx: 0.3, cy: 0.35 },
      { id: 'z3', in: 4, out: 5, level: 1, cx: 0.5, cy: 0.5 },
      { id: 'z4', in: 6.5, out: 7.5, level: 2, cx: 0.5, cy: 0.5 },
      { id: 'z2', in: 0.5, out: 1.5, level: 2, cx: 0.7, cy: 0.6, media: 'b' },
    ],
    audio: [],
    cursor: { ...DEFAULT_CURSOR_STYLE, visible: false },
    cam: DEFAULT_CAM_STYLE,
    frame: DEFAULT_FRAME_STYLE,
    export: { resolution: '720p', fps: 30, format: 'mp4' },
  }
}

describe('zoomApexes', () => {
  it('lists the apex of every media’s zoom span at the output time it plays', () => {
    const { apexes } = zoomApexes(takeDoc())
    expect(apexes.map((a) => [a.id, a.media ?? null, a.time])).toEqual([
      ['z1', null, 1.5],
      ['z3', null, 4.5],
      // b's 0.5..1.5 plays after the primary's six seconds.
      ['z2', 'b', 7],
    ])
  })

  it('stills a span once per time a replayed cut plays it', () => {
    const doc = takeDoc()
    // A cold open of the primary's 1..2.5, then the cut as before.
    doc.segments = [{ in: 1, out: 2.5 }, ...doc.segments]
    const { apexes } = zoomApexes(doc)
    expect(
      apexes.filter((a) => a.id === 'z1').map((a) => [a.start, a.end]),
    ).toEqual([
      [0, 1],
      [2.5, 3.5],
    ])
  })

  it('skips a span the cut keeps nothing of, and one naming a media the take lacks, saying why', () => {
    const doc = takeDoc()
    doc.zoom.push({
      id: 'z5',
      in: 0,
      out: 1,
      level: 2,
      cx: 0.5,
      cy: 0.5,
      media: 'c',
    })
    const { skipped } = zoomApexes(doc)
    expect(skipped.map((s) => s.id)).toEqual(['z4', 'z5'])
    expect(skipped[0].reason).toMatch(/the cut keeps none of it/)
    expect(skipped[1].reason).toMatch(/names media "c"/)
  })
})

let browser: Browser | null = null
let skipReason = ''
let dir = ''

beforeAll(async () => {
  try {
    const res = await fetch(esmShModules().three, {
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) throw new Error(`the engine's modules answer ${res.status}`)
    const { launchBrowser } = await import('../../browser')
    browser = await launchBrowser()
  } catch (e) {
    skipReason = e instanceof Error ? e.message.split('\n')[0] : String(e)
    return
  }
  dir = await mkdtemp(join(tmpdir(), 'vos-frames-zooms-'))
  const recording = await makeFixtureVideo(browser, {
    width: 320,
    height: 180,
    fps: 15,
    seconds: 8,
    scenes: [{ at: 0, kind: 'busy', color: '#3a7bd5' }],
  })
  const other = await makeFixtureVideo(browser, {
    width: 320,
    height: 180,
    fps: 15,
    seconds: 3,
    scenes: [{ at: 0, kind: 'busy', color: '#c2702f' }],
  })
  await writeFile(join(dir, 'recording.webm'), recording)
  await writeFile(join(dir, 'b.webm'), other)
  await writeFile(join(dir, 'meta.json'), JSON.stringify(meta(8)))
  await writeFile(join(dir, 'cursor.json'), '[]')
  await writeFile(join(dir, 'doc.json'), JSON.stringify(takeDoc()))
}, 120_000)

afterAll(async () => {
  await closeBrowser(browser)
  if (dir) await rm(dir, { recursive: true, force: true })
}, 30_000)

describe('vos frames --at-zooms over a real render', () => {
  it('stills both media’s zooms, flags the one that does not render, and keeps only its twin', async () => {
    if (!browser) return console.warn(`skipped: ${skipReason}`)
    const outDir = join(dir, 'stills')
    const r = await framesTake(browser, dir, {
      times: [],
      atZooms: true,
      width: 320,
      height: 180,
      outDir,
    })
    const zooms = r.frames.filter((f) => f.kind === 'zoom')
    expect(zooms.map((f) => [f.zoomId, f.media ?? null, f.time])).toEqual([
      ['z1', null, 1.5],
      ['z3', null, 4.5],
      ['z2', 'b', 7],
    ])
    const by = Object.fromEntries(zooms.map((f) => [f.zoomId, f]))
    expect(by.z1.rendered).toBe(true)
    expect(by.z2.rendered).toBe(true)
    expect(by.z1.difference).toBeGreaterThan(ZOOM_UNRENDERED_BELOW * 5)
    expect(by.z2.difference).toBeGreaterThan(ZOOM_UNRENDERED_BELOW * 5)
    expect(by.z3.rendered).toBe(false)
    expect(by.z3.difference).toBeLessThan(ZOOM_UNRENDERED_BELOW)
    expect(by.z3.twin && existsSync(by.z3.twin)).toBe(true)
    expect(by.z1.twin).toBeUndefined()
    expect(r.skippedZooms?.map((s) => s.id)).toEqual(['z4'])
    // Only the flagged zoom's twin stays; none is left in the take dir.
    expect(
      readdirSync(outDir).filter((n) => n.startsWith('zoomoff-')),
    ).toHaveLength(1)
    expect(readdirSync(dir).filter((n) => n.endsWith('.png'))).toEqual([])
  }, 240_000)
})
