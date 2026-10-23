import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_CAM_STYLE,
  DEFAULT_CURSOR_STYLE,
  DEFAULT_FRAME_STYLE,
} from '@vosjs/studio-core'
import { run } from '../run'
import { formatTimeline, takeTimeline } from '../timeline'
import type { ProjectDoc } from '@vosjs/studio-core'
import type { ActionsFile } from '../actions'

const meta = (
  durationMs: number,
  steps: ProjectDoc['source']['meta']['steps'],
) => ({
  dpr: 1,
  zoom: 1,
  t0: 0,
  durationMs,
  width: 1280,
  height: 720,
  fps: 30,
  producer: 'cli' as const,
  steps,
})

/**
 * A joined take, cut: the primary trimmed to 2..12 with a 2× span over
 * 4..6, a media m1 played 1..5 after it, a zoom on the primary and one
 * the trim leaves out, a caption anchored to m1's step, a freeze, a score.
 */
function cut(): ProjectDoc {
  return {
    source: {
      videoKey: 'recording.webm',
      cursor: [],
      meta: meta(14000, [
        { step: 0, id: 'open', do: 'click', tStart: 3, tEnd: 3.5 },
        { step: 1, id: 'gone', do: 'click', tStart: 13, tEnd: 13.4 },
      ]),
    },
    media: [
      {
        id: 'm1',
        videoKey: 'm1/recording.webm',
        cursor: [],
        meta: meta(6000, [
          { step: 0, id: 'share', do: 'click', tStart: 2, tEnd: 2.5 },
        ]),
        script: {
          steps: [{ do: 'click', id: 'share', caption: 'Share it' }],
        },
      },
    ],
    segments: [
      { in: 2, out: 12 },
      { in: 1, out: 5, media: 'm1' },
    ],
    speed: [{ id: 's1', in: 4, out: 6, rate: 2 }],
    freeze: [{ id: 'f1', media: 'm1', at: 4, seconds: 1 }],
    zoom: [
      {
        id: 'z1',
        in: 3,
        out: 5,
        level: 1.8,
        cx: 0.5,
        cy: 0.5,
        source: 'manual',
      },
      { id: 'z2', in: 12.5, out: 13.5, level: 1.5, cx: 0.5, cy: 0.5 },
    ],
    overlays: [
      {
        id: 'c1',
        kind: 'text',
        text: [{ text: 'Share ' }, { text: 'it', weight: 700 }],
        preset: 'caption',
        start: 0,
        duration: 2,
        transform: { x: 0.5, y: 0.9, scale: 1, rotation: 0 },
        anchor: { step: 'share', media: 'm1', offset: 0.5 },
      },
    ],
    audio: [
      {
        id: 'score',
        key: 'music/theme.mp3',
        name: 'Theme',
        start: 0,
        in: 10,
        out: 25,
        duration: 120,
        gain: 0.5,
        fadeIn: 0,
        fadeOut: 1.5,
      },
    ],
    cursor: DEFAULT_CURSOR_STYLE,
    cam: DEFAULT_CAM_STYLE,
    frame: DEFAULT_FRAME_STYLE,
    export: { resolution: '1080p', fps: 30, format: 'mp4' },
  }
}

const actions: ActionsFile = {
  steps: [
    { do: 'click', selector: '#open', id: 'open', caption: 'Open it' },
    { do: 'click', selector: '#gone', id: 'gone' },
  ],
} as unknown as ActionsFile

describe('vos info <take>', () => {
  afterEach(() => vi.restoreAllMocks())

  it('resolves every step, span, layer and sound into output seconds', () => {
    const t = takeTimeline(cut(), new Map([['', actions]]))
    // The primary: 2..4 (2 s), 4..6 at 2× (1 s), 6..12 (6 s) → 0..9.
    // m1: 1..4 (3 s), the freeze (1 s), 4..5 (1 s) → 9..14.
    expect(t.segments).toEqual([
      { index: 0, media: '', in: 2, out: 12, start: 0, end: 9 },
      { index: 1, media: 'm1', in: 1, out: 5, start: 9, end: 14 },
    ])
    expect(t.footage).toBe(14)
    expect(t.media[0].steps).toEqual([
      {
        step: 0,
        id: 'open',
        do: 'click',
        in: 3,
        out: 3.5,
        caption: 'Open it',
        output: { start: 1, end: 1.5 },
      },
      { step: 1, id: 'gone', do: 'click', in: 13, out: 13.4, output: null },
    ])
    // m1's caption comes from its embedded script.
    expect(t.media[1].steps[0]).toMatchObject({
      id: 'share',
      caption: 'Share it',
      output: { start: 10, end: 10.5 },
    })
    expect(t.speed).toEqual([
      {
        id: 's1',
        media: '',
        in: 4,
        out: 6,
        rate: 2,
        output: { start: 2, end: 3 },
      },
    ])
    expect(t.freeze).toEqual([
      {
        id: 'f1',
        media: 'm1',
        at: 4,
        seconds: 1,
        output: { start: 12, end: 13 },
      },
    ])
    expect(t.zoom.map((z) => [z.id, z.output])).toEqual([
      ['z1', { start: 1, end: 2.5 }],
      ['z2', null],
    ])
    expect(t.overlays).toEqual([
      {
        id: 'c1',
        kind: 'text',
        text: 'Share it',
        start: 10.5,
        end: 12.5,
        anchor: { step: 'share', media: 'm1', offset: 0.5 },
      },
    ])
    expect(t.audio).toEqual([
      { id: 'score', name: 'Theme', start: 0, end: 15, in: 10, out: 25 },
    ])
    expect(t.end).toBe(14)
    const text = formatTimeline(t, 'take')
    expect(text).toMatch(/^take: output 14\.00 s \(footage 14\.00 s\), 2 media/)
    expect(text).toMatch(/z2 +primary +12\.50–13\.50 .*→ \(cut\)/)
    expect(text).toMatch(/c1 +text +10\.50–12\.50 anchor m1:share \+0\.5/)
  })

  it('lists every place a span and a step play on a cut that replays them', () => {
    const doc = cut()
    // A cold open of the primary's 3.2..4.5 (z1 and step "open" sit in
    // it), then the cut as before, 1.3 s later.
    doc.segments = [{ in: 3.2, out: 4.5 }, ...doc.segments]
    doc.speed = []
    const t = takeTimeline(doc, new Map([['', actions]]))
    const z1 = t.zoom.find((z) => z.id === 'z1')!
    expect(z1.output).toEqual({ start: 0, end: 1.3 })
    expect(z1.also).toEqual([{ start: 2.3, end: 4.3 }])
    // A step is where an anchor on it lands: its longest pass, the main
    // play here (0.5 s against the cold open's 0.3 s).
    expect(t.media[0].steps[0].output).toEqual({ start: 2.3, end: 2.8 })
    expect(t.media[0].steps[0].also).toEqual([{ start: 0, end: 0.3 }])
    const text = formatTimeline(t, 'take')
    expect(text).toMatch(
      /z1 +primary +3\.00–5\.00 .*→ 0\.00–1\.30, also 2\.30–4\.30/,
    )
    expect(text).toMatch(/2\.30–2\.80 .*\(also 0\.00–0\.30\)/)
  })

  it('says where a camera span rests instead of moving the camera', () => {
    const doc = cut()
    // The same cold open with its camera at rest: z1 moves the camera only
    // in the main play.
    doc.segments = [
      { in: 3.2, out: 4.5, camera: 'rest' },
      ...doc.segments,
    ] as ProjectDoc['segments']
    doc.speed = []
    const t = takeTimeline(doc, new Map([['', actions]]))
    const z1 = t.zoom.find((z) => z.id === 'z1')!
    expect(z1.output).toEqual({ start: 2.3, end: 4.3 })
    expect(z1.also).toBeUndefined()
    expect(z1.rests).toEqual([{ start: 0, end: 1.3 }])
    expect(formatTimeline(t, 'take')).toMatch(
      /z1 +primary +3\.00–5\.00 .*→ 2\.30–4\.30, at rest in 0\.00–1\.30/,
    )
  })

  it('pairs each resolved layer with its own anchor when a layer before it is placed nowhere', () => {
    const doc = cut()
    const caption = doc.overlays![0]
    const { start: _start, ...noStart } = caption
    void _start
    doc.overlays = [
      // Anchored to a step the cut leaves out, and no start: plays nowhere.
      { ...noStart, id: 'lost', anchor: { step: 'gone' } },
      { ...noStart, id: 'end', anchor: { step: 'share', media: 'm1' } },
    ] as typeof doc.overlays
    const t = takeTimeline(doc, new Map([['', actions]]))
    expect(t.overlays).toEqual([
      expect.objectContaining({
        id: 'end',
        start: 10,
        anchor: { step: 'share', media: 'm1' },
      }),
    ])
  })

  it('is what vos info prints for a take directory', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vos-info-'))
    const doc = cut()
    await writeFile(join(dir, 'meta.json'), JSON.stringify(doc.source.meta))
    await writeFile(join(dir, 'actions.json'), JSON.stringify(actions))
    await writeFile(join(dir, 'doc.json'), JSON.stringify(doc))
    const out: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((c) => {
      out.push(String(c))
      return true
    })
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    expect(await run(['info', dir, '--json'])).toBe(0)
    const done = JSON.parse(out.join('').trim().split('\n').at(-1)!) as {
      event: string
      end: number
      zoom: { id: string }[]
    }
    expect(done.event).toBe('done')
    expect(done.end).toBe(14)
    expect(done.zoom.map((z) => z.id)).toEqual(['z1', 'z2'])
  })
})
