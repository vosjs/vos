import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { STYLE_FIELDS } from '@vosso/studio-core'
import { planTake } from '../plan'
import { ensureTakeDir, readJson, writeJson } from '../take'
import type { CursorEvent, ProjectDoc } from '@vosso/studio-core'

/** A track with two clear click clusters the planner will zoom on. */
function track(): CursorEvent[] {
  const events: CursorEvent[] = []
  for (let t = 0; t <= 2000; t += 50)
    events.push({ t, x: 200 + t / 10, y: 200, type: 'move' })
  const rect = { x: 380, y: 180, w: 120, h: 40 }
  events.push({ t: 2100, x: 400, y: 200, type: 'down', button: 0, rect })
  events.push({ t: 2200, x: 400, y: 200, type: 'up', button: 0, rect })
  for (let t = 2300; t <= 6000; t += 50)
    events.push({ t, x: 400 + (t - 2300) / 8, y: 300, type: 'move' })
  const rect2 = { x: 800, y: 400, w: 200, h: 60 }
  events.push({ t: 6100, x: 860, y: 430, type: 'down', button: 0, rect: rect2 })
  events.push({ t: 6200, x: 860, y: 430, type: 'up', button: 0, rect: rect2 })
  for (let t = 6300; t <= 8000; t += 50)
    events.push({ t, x: 860, y: 430, type: 'move' })
  return events
}

async function makeTake(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'voila-take-'))
  const paths = await ensureTakeDir(dir)
  await writeJson(paths.cursor, track())
  await writeJson(paths.meta, {
    dpr: 1,
    zoom: 1,
    t0: 0,
    durationMs: 8000,
    width: 1280,
    height: 720,
    fps: 30,
    captureWidth: 1280,
    captureHeight: 720,
    captureSurface: 'tab',
    producer: 'cli',
  })
  return dir
}

describe('planTake', () => {
  it('fresh takes get an ingested doc with auto zoom spans', async () => {
    const dir = await makeTake()
    const s = await planTake(dir)
    expect(s.fresh).toBe(true)
    expect(s.cursorKept).toBe(true)
    expect(s.zoomAuto).toBeGreaterThanOrEqual(1)
    expect(s.zoomManual).toBe(0)
    const doc = await readJson<ProjectDoc>(join(dir, 'doc.json'))
    expect(doc.source.meta.producer).toBe('cli')
    expect(doc.zoom.every((z) => z.source === 'auto')).toBe(true)
  })

  it('re-planning preserves manual spans and drops overlapping auto suggestions', async () => {
    const dir = await makeTake()
    await planTake(dir)
    const doc = await readJson<ProjectDoc>(join(dir, 'doc.json'))
    // Promote the first span to manual and remember its extent.
    const manual = { ...doc.zoom[0], source: 'manual' as const, level: 3 }
    doc.zoom = [manual]
    await writeJson(join(dir, 'doc.json'), doc, true)

    const s = await planTake(dir)
    expect(s.fresh).toBe(false)
    expect(s.zoomManual).toBe(1)
    const after = await readJson<ProjectDoc>(join(dir, 'doc.json'))
    const kept = after.zoom.find((z) => z.source === 'manual')
    expect(kept).toBeDefined()
    expect(kept?.level).toBe(3)
    // No auto span overlaps the manual one.
    const overlapping = after.zoom.filter(
      (z) => z.source !== 'manual' && z.in < manual.out && manual.in < z.out,
    )
    expect(overlapping).toEqual([])
  })

  it('typing pings plan a typing span framed on the field (TZ)', async () => {
    // The shape the recorder's `type` verb synthesizes: click into the field,
    // then throttled `key` pings while the characters land.
    const dir = await mkdtemp(join(tmpdir(), 'voila-take-'))
    const paths = await ensureTakeDir(dir)
    const rect = { x: 400, y: 300, w: 320, h: 40 }
    const events: CursorEvent[] = [
      { t: 0, x: 100, y: 100, type: 'move' },
      { t: 500, x: 560, y: 320, type: 'down', button: 0, rect },
      { t: 600, x: 560, y: 320, type: 'up', button: 0, rect },
      { t: 800, x: 560, y: 320, type: 'key', rect },
      { t: 1200, x: 560, y: 320, type: 'key', rect },
      { t: 1700, x: 560, y: 320, type: 'key', rect },
    ]
    await writeJson(paths.cursor, events)
    await writeJson(paths.meta, {
      dpr: 1,
      zoom: 1,
      t0: 0,
      durationMs: 4000,
      width: 1280,
      height: 720,
      fps: 30,
      captureWidth: 1280,
      captureHeight: 720,
      captureSurface: 'tab',
      producer: 'cli',
    })
    const s = await planTake(dir)
    expect(s.cursorKept).toBe(true)
    const doc = await readJson<ProjectDoc>(join(dir, 'doc.json'))
    const typing = doc.zoom.filter((z) => z.id.startsWith('k'))
    expect(typing).toHaveLength(1)
    expect(typing[0].in).toBeCloseTo(0, 3) // absorbed click 0.5s − lead 0.5
    expect(typing[0].out).toBeCloseTo(2.8, 3) // last ping 1.7s + typingHold 1.1
    expect(typing[0].cx).toBeCloseTo(560 / 1280, 2) // the field, not the mouse
  })

  // Style is data. --style copies the seed's style fields onto the
  // take, never its cut, and the autos re-plan under the copied camera.
  it('--style copies exactly the style fields and re-plans under them', async () => {
    const seedDir = await makeTake()
    const seed = (await planTake(seedDir)).doc
    seed.zoomStyle = 'none'
    seed.frame.padding = 96
    seed.frame.background = '#123456'
    seed.zoom = [{ id: 'u1', in: 1, out: 2, level: 2, cx: 0.5, cy: 0.5 }]
    seed.overlays = [
      {
        id: 't0',
        kind: 'text',
        start: 0,
        duration: 1,
        text: 'seed',
        preset: 'caption',
        transform: { x: 0.5, y: 0.8, scale: 1, rotation: 0 },
      },
    ]

    const dir = await makeTake()
    const before = (await planTake(dir)).doc
    expect(before.zoom.length).toBeGreaterThan(0)

    const s = await planTake(dir, { style: { from: 'seed', doc: seed } })
    expect(s.styleFrom).toBe('seed')
    expect(s.styleFields).toEqual(
      STYLE_FIELDS.filter((k) => seed[k] !== undefined),
    )
    const doc = await readJson<ProjectDoc>(join(dir, 'doc.json'))
    expect(doc.zoomStyle).toBe('none')
    expect(doc.frame.padding).toBe(96)
    expect(doc.frame.background).toBe('#123456')
    // the seed's CUT never travels
    expect(doc.overlays ?? []).toEqual([])
    expect(doc.zoom.find((z) => z.id === 'u1')).toBeUndefined()
    // and the autos re-planned under the copied camera ('none' plans nothing)
    expect(doc.zoom.filter((z) => z.source === 'auto')).toEqual([])
  })
})
