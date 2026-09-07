import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CAM_STYLE,
  DEFAULT_CURSOR_STYLE,
  DEFAULT_FRAME_STYLE,
} from '@vosjs/studio-core'
import {
  findPosterDocs,
  posterClassFor,
  posterShotRect,
  posterStillTime,
  posterTextBoxes,
} from '../posterDoc'
import type { ProjectDoc } from '@vosjs/studio-core'

function poster(over: Partial<ProjectDoc> = {}): ProjectDoc {
  return {
    source: {
      videoKey: 'recording.webm',
      cursor: [],
      meta: {
        dpr: 1,
        zoom: 1,
        t0: 0,
        durationMs: 8000,
        width: 1600,
        height: 900,
        fps: 30,
      },
    },
    segments: [{ in: 0, out: 3, hold: 3 }],
    zoom: [],
    audio: [],
    cursor: DEFAULT_CURSOR_STYLE,
    cam: DEFAULT_CAM_STYLE,
    frame: {
      ...DEFAULT_FRAME_STYLE,
      background: '#f0f2f4',
      inset: { left: 0.44, right: -0.06, top: 0.3, bottom: -0.12 },
    },
    overlays: [
      {
        id: 'stage-title',
        kind: 'text',
        text: 'Ship the poster',
        preset: 'title',
        start: 0,
        duration: 6,
        transform: { x: 0.25, y: 0.46, scale: 1, rotation: 0 },
        align: 'left',
        maxWidth: 0.36,
        color: '#111111',
      },
      {
        id: 'late',
        kind: 'text',
        text: 'after the rest',
        preset: 'caption',
        start: 4,
        duration: 2,
        transform: { x: 0.5, y: 0.8, scale: 1, rotation: 0 },
      },
    ],
    export: { resolution: '1080p', fps: 30, format: 'mp4' },
    ...over,
  }
}

describe('posterClassFor', () => {
  it('names the four classes by pixels', () => {
    expect(posterClassFor({ w: 1200, h: 630 })).toBe('landscape')
    expect(posterClassFor({ w: 1080, h: 1080 })).toBe('square')
    expect(posterClassFor({ w: 1080, h: 1920 })).toBe('portrait')
    expect(posterClassFor({ w: 440, h: 280 })).toBe('tile')
    expect(posterClassFor({ w: 240, h: 240 })).toBe('tile')
  })
})

describe('the still, the shot and the words, read from the document', () => {
  it('the still is the rest; a poster with no hold rests on its last frame', () => {
    expect(posterStillTime(poster(), 6)).toBe(3)
    expect(
      posterStillTime(poster({ segments: [{ in: 0, out: 3 }] }), 3),
    ).toBeCloseTo(3 - 1 / 30, 6)
  })

  it('the shot rect is the card, bled where the inset is negative', () => {
    // Under contain the fitted card centres inside the inset area, so its
    // top sits below the area's; under cover the area IS the card.
    const shot = posterShotRect(poster(), { w: 1200, h: 630 })
    expect(shot.x).toBeCloseTo(0.44, 2)
    expect(shot.w).toBeCloseTo(0.62, 2)
    expect(shot.y).toBeGreaterThanOrEqual(0.3)
    expect(shot.x + shot.w).toBeGreaterThan(1)
    const cover = poster()
    cover.frame.fit = 'cover'
    const covered = posterShotRect(cover, { w: 1200, h: 630 })
    expect(covered.y).toBeCloseTo(0.3, 2)
    expect(covered.y + covered.h).toBeGreaterThan(1)
  })

  it('the text boxes are the clips on screen at the still, with role and colour', () => {
    const boxes = posterTextBoxes(poster(), { w: 1200, h: 630 }, 3)
    expect(boxes).toHaveLength(1)
    expect(boxes[0]).toMatchObject({
      role: 'headline',
      label: 'Ship the poster',
      color: '#111111',
    })
    expect(boxes[0].x).toBeGreaterThan(0)
    expect(boxes[0].x + boxes[0].w).toBeLessThan(1)
    expect(posterTextBoxes(poster(), { w: 1200, h: 630 }, 5)).toHaveLength(2)
  })
})

describe('findPosterDocs', () => {
  it('finds a class folder, the all-classes folder, and LAUNCH.md’s roles, in that precedence', async () => {
    const take = await mkdtemp(join(tmpdir(), 'vos-take-'))
    await mkdir(join(take, 'poster', 'landscape'), { recursive: true })
    await writeFile(
      join(take, 'poster', 'landscape', 'doc.json'),
      JSON.stringify(poster()),
    )
    await writeFile(
      join(take, 'poster', 'doc.json'),
      JSON.stringify(poster({ segments: [{ in: 0, out: 2, hold: 1 }] })),
    )
    const named = join(take, 'named.json')
    await writeFile(
      named,
      JSON.stringify(poster({ segments: [{ in: 0, out: 1, hold: 1 }] })),
    )

    const found = await findPosterDocs(take, null)
    expect(found.landscape?.from).toBe('poster/landscape')
    expect(found.landscape?.takeDir).toBe(take)
    expect(found.landscape?.ownFootage).toBe(false)
    expect(found.square?.from).toBe('poster')
    expect(found.portrait?.from).toBe('poster')
    expect(found.tile?.from).toBe('poster')

    const roled = await findPosterDocs(take, {
      'poster-square': 'named.json',
      poster: 'none',
    })
    expect(roled.square?.from).toBe('LAUNCH.md poster-square')
    expect(roled.square?.doc.segments[0].out).toBe(1)
    // `poster: none` stands the all-classes role down; the folders still serve.
    expect(roled.portrait?.from).toBe('poster')
  })

  it('a poster that is its own take renders over its own footage, and carries its vos id', async () => {
    const take = await mkdtemp(join(tmpdir(), 'vos-take-'))
    const own = join(take, 'poster', 'portrait')
    await mkdir(own, { recursive: true })
    await writeFile(join(own, 'doc.json'), JSON.stringify(poster()))
    await writeFile(
      join(own, 'meta.json'),
      JSON.stringify({ durationMs: 8000, width: 1600, height: 900 }),
    )
    await writeFile(join(own, 'recording.webm'), 'bytes')
    await writeFile(
      join(own, 'vos.json'),
      JSON.stringify({ vosId: 'vos-123', versionId: null }),
    )
    const found = await findPosterDocs(take, null)
    expect(found.portrait?.ownFootage).toBe(true)
    expect(found.portrait?.takeDir).toBe(own)
    expect(found.portrait?.vosId).toBe('vos-123')
  })

  it('ignores a file that is not a recording document', async () => {
    const take = await mkdtemp(join(tmpdir(), 'vos-take-'))
    await mkdir(join(take, 'poster'), { recursive: true })
    await writeFile(
      join(take, 'poster', 'doc.json'),
      JSON.stringify({ program: { config: {} } }),
    )
    expect(await findPosterDocs(take, null)).toEqual({})
  })
})
