import { describe, expect, it } from 'vitest'
import { lintDoc } from '../validateDoc'
import type { ProjectDoc } from '@vosso/studio-core'

/** Minimal doc — only the fields lintDoc reads; 20s of 1280×720 footage. */
function makeDoc(over: Partial<ProjectDoc> = {}): ProjectDoc {
  return {
    source: {
      videoKey: 'blob:recording',
      cursor: [],
      meta: {
        dpr: 1,
        zoom: 1,
        t0: 0,
        durationMs: 20000,
        width: 1280,
        height: 720,
        fps: 30,
        hasAudio: false,
        captureWidth: 1280,
        captureHeight: 720,
      },
    },
    segments: [{ in: 0, out: 20 }],
    zoom: [],
    audio: [],
    cursor: { smoothing: 0.5, size: 1 },
    cam: {},
    frame: {
      background: '#111',
      padding: 48,
      radius: 12,
      shadow: 0.4,
      border: 0,
      aspectRatio: 'auto',
      browserBar: { kind: 'none' },
    },
    export: { resolution: '720p', fps: 30, format: 'mp4' },
    ...over,
  } as unknown as ProjectDoc
}

describe('lintDoc', () => {
  it('passes a clean doc', () => {
    const r = lintDoc(
      makeDoc({
        zoom: [
          {
            id: 'z1',
            in: 1,
            out: 3,
            level: 1.8,
            cx: 0.5,
            cy: 0.4,
            source: 'auto',
          },
          {
            id: 'u1',
            in: 5,
            out: 8,
            level: 2.2,
            cx: 0.64,
            cy: 0.5,
            source: 'manual',
          },
        ],
      }),
    )
    expect(r.problems).toEqual([])
    expect(r.warnings).toEqual([])
  })

  it('catches the pixel-coords trap (cx/cy must be normalized [0..1])', () => {
    const r = lintDoc(
      makeDoc({
        zoom: [{ id: 'z1', in: 1, out: 3, level: 1.8, cx: 640, cy: 360 }],
      }),
    )
    expect(
      r.problems.some((p) => p.includes('cx=640') && p.includes('NORMALIZED')),
    ).toBe(true)
    expect(r.problems.some((p) => p.includes('cy=360'))).toBe(true)
  })

  it('catches overlapping zoom spans and out-of-footage spans', () => {
    const r = lintDoc(
      makeDoc({
        zoom: [
          { id: 'z1', in: 1, out: 5, level: 1.8, cx: 0.5, cy: 0.5 },
          { id: 'z2', in: 4, out: 7, level: 1.8, cx: 0.5, cy: 0.5 },
          { id: 'z3', in: 18, out: 30, level: 1.8, cx: 0.5, cy: 0.5 },
        ],
      }),
    )
    expect(r.problems.some((p) => p.includes('z2 overlaps zoom z1'))).toBe(true)
    expect(
      r.problems.some(
        (p) => p.includes('z3') && p.includes('exceeds the footage'),
      ),
    ).toBe(true)
  })

  it('catches level, rate, and export enum violations', () => {
    const r = lintDoc(
      makeDoc({
        zoom: [{ id: 'z1', in: 1, out: 3, level: 9, cx: 0.5, cy: 0.5 }],
        speed: [{ id: 's1', in: 4, out: 6, rate: 40 }],
        export: { resolution: '8k' as never, fps: 24 as never, format: 'mp4' },
      }),
    )
    expect(r.problems.some((p) => p.includes('level=9'))).toBe(true)
    expect(r.problems.some((p) => p.includes('rate=40'))).toBe(true)
    expect(r.problems.some((p) => p.includes('export.resolution "8k"'))).toBe(
      true,
    )
    expect(r.problems.some((p) => p.includes('fps must be 30 or 60'))).toBe(
      true,
    )
  })

  it('warns (not errors) on footage-upscaling export and sub-minimum spans', () => {
    const r = lintDoc(
      makeDoc({
        zoom: [{ id: 'z1', in: 1, out: 1.1, level: 1.8, cx: 0.5, cy: 0.5 }],
        export: { resolution: '4k', fps: 30, format: 'mp4' },
      }),
    )
    expect(r.problems).toEqual([])
    expect(r.warnings.some((w) => w.includes('upscales the footage'))).toBe(
      true,
    )
    expect(
      r.warnings.some((w) => w.includes('z1') && w.includes('minimum')),
    ).toBe(true)
  })

  const withBg = (bgm: unknown) =>
    lintDoc(
      makeDoc({
        frame: {
          background: '#111',
          backgroundMedia: bgm,
          padding: 48,
          radius: 12,
          shadow: 0.4,
          border: 0,
          aspectRatio: 'auto',
          browserBar: { kind: 'none' },
        },
      } as unknown as Partial<ProjectDoc>),
    )

  it('accepts a valid video background', () => {
    const r = withBg({ kind: 'video', key: '/bg.webm', duration: 10, dim: 0.2 })
    expect(r.problems).toEqual([])
    expect(r.warnings).toEqual([])
  })

  it('accepts a valid image background', () => {
    const r = withBg({
      kind: 'image',
      key: 'https://assets.vos.so/x.jpg',
      dim: 0,
    })
    expect(r.problems).toEqual([])
  })

  it('flags a video background with no key, bad kind, and out-of-range dim', () => {
    const r = withBg({ kind: 'gif', key: '', dim: 1.5 })
    expect(r.problems.some((p) => p.includes('kind must be'))).toBe(true)
    expect(r.problems.some((p) => p.includes('key must be'))).toBe(true)
    expect(r.problems.some((p) => p.includes('dim must be 0..1'))).toBe(true)
  })

  it('errors on a non-positive video duration, warns when duration is absent', () => {
    expect(
      withBg({
        kind: 'video',
        key: '/bg.webm',
        duration: 0,
        dim: 0,
      }).problems.some((p) => p.includes('duration must be > 0')),
    ).toBe(true)
    const r = withBg({ kind: 'video', key: '/bg.webm', dim: 0 })
    expect(r.problems).toEqual([])
    expect(r.warnings.some((w) => w.includes('no `duration`'))).toBe(true)
  })

  const withCard = (card: unknown) =>
    lintDoc(makeDoc({ card } as unknown as Partial<ProjectDoc>))

  // `card` was removed (decided 2026-08-03) — a doc written against the old
  // schema must be TOLD, not silently rendered without its pose.
  it('accepts valid tilt spans + tiltStyle', () => {
    const r = lintDoc(
      makeDoc({
        tilt: [
          { id: 't-z0', in: 1, out: 4, rx: 6, ry: -9, source: 'auto' },
          { id: 'u0', in: 8, out: 11, rx: -10, ry: 0, source: 'manual' },
        ],
        tiltStyle: 'medium',
      } as Partial<ProjectDoc>),
    )
    expect(r.problems).toEqual([])
    expect(r.warnings).toEqual([])
  })

  it('catches tilt overlap, degree range, bad source, and bad tiltStyle', () => {
    const r = lintDoc(
      makeDoc({
        tilt: [
          { id: 'a', in: 1, out: 5, rx: 90, ry: 0 },
          { id: 'b', in: 4, out: 8, rx: 0, ry: 5, source: 'wand' },
        ],
        tiltStyle: 'loud',
      } as unknown as Partial<ProjectDoc>),
    )
    expect(
      r.problems.some((p) => p.includes('rx=90') && p.includes('DEGREES')),
    ).toBe(true)
    expect(r.problems.some((p) => p.includes('overlaps'))).toBe(true)
    expect(
      r.problems.some((p) => p.includes("source must be 'manual' or 'auto'")),
    ).toBe(true)
    expect(r.problems.some((p) => p.includes('tiltStyle'))).toBe(true)
  })

  it('warns on dramatic combined lean and sub-minimum tilt spans', () => {
    const r = lintDoc(
      makeDoc({
        tilt: [
          { id: 'a', in: 1, out: 3, rx: 20, ry: -15 },
          { id: 'b', in: 5, out: 5.4, rx: 5, ry: 0 },
        ],
      } as Partial<ProjectDoc>),
    )
    expect(r.problems).toEqual([])
    expect(r.warnings.some((w) => w.includes('reads dramatic'))).toBe(true)
    expect(r.warnings.some((w) => w.includes('under the 0.8s minimum'))).toBe(
      true,
    )
  })

  it('accepts valid camMotion spans on a take with a cam track', () => {
    const doc = makeDoc({
      camMotion: [
        { id: 'm1', in: 2, out: 5, x: 0.5, y: 0.55, size: 0.45 },
        { id: 'm2', in: 8, out: 12, size: 0.2, ease: 'power2.out' },
      ],
    })
    ;(doc.source as { camKey?: string }).camKey = 'blob:cam'
    const r = lintDoc(doc)
    expect(r.problems).toEqual([])
    expect(r.warnings).toEqual([])
  })

  it('accepts transition speeds and flags unknown ones', () => {
    const ok = lintDoc(
      makeDoc({
        zoom: [
          {
            id: 'z1',
            in: 1,
            out: 3,
            level: 1.8,
            cx: 0.5,
            cy: 0.5,
            transition: 'instant',
          },
        ],
        tilt: [{ id: 't1', in: 5, out: 8, rx: 6, ry: -9, transition: 'slow' }],
      } as Partial<ProjectDoc>),
    )
    expect(ok.problems).toEqual([])
    const bad = lintDoc(
      makeDoc({
        zoom: [
          {
            id: 'z1',
            in: 1,
            out: 3,
            level: 1.8,
            cx: 0.5,
            cy: 0.5,
            transition: 'zippy',
          },
        ] as never,
      }),
    )
    expect(
      bad.problems.some(
        (p) => p.includes('transition must be') && p.includes('zippy'),
      ),
    ).toBe(true)
  })

  it('catches camMotion fraction/size/source violations and overlap', () => {
    const doc = makeDoc({
      camMotion: [
        { id: 'm1', in: 2, out: 6, x: 640, y: 0.5, size: 0.45 },
        { id: 'm2', in: 5, out: 9, size: 0.9, source: 'wand' },
      ] as never,
    })
    ;(doc.source as { camKey?: string }).camKey = 'blob:cam'
    const r = lintDoc(doc)
    expect(
      r.problems.some((p) => p.includes('m1') && p.includes('FRACTIONS')),
    ).toBe(true)
    expect(r.problems.some((p) => p.includes('m2') && p.includes('size'))).toBe(
      true,
    )
    expect(
      r.problems.some((p) => p.includes("source must be 'manual' or 'auto'")),
    ).toBe(true)
    expect(r.problems.some((p) => p.includes('overlaps'))).toBe(true)
  })

  it('warns on camMotion without a cam track, empty poses, and short spans', () => {
    const r = lintDoc(
      makeDoc({
        camMotion: [
          { id: 'm1', in: 2, out: 2.3, x: 0.5 },
          { id: 'm2', in: 4, out: 6 },
        ],
      }),
    )
    expect(r.problems).toEqual([])
    expect(r.warnings.some((w) => w.includes('no cam track'))).toBe(true)
    expect(
      r.warnings.some((w) => w.includes('m2') && w.includes('rest pose')),
    ).toBe(true)
    expect(
      r.warnings.some((w) => w.includes('m1') && w.includes('0.5s minimum')),
    ).toBe(true)
  })

  it('flags any `card` field as removed, pointing at tilt spans', () => {
    const r = withCard({ tilt: { rx: 8, ry: -12 }, entrance: 'rise' })
    expect(r.problems.some((p) => p.includes('card was removed'))).toBe(true)
    expect(r.problems.some((p) => p.includes('doc.tilt'))).toBe(true)
  })

  it('flags frame.vignette as removed', () => {
    const doc = makeDoc()
    ;(doc.frame as unknown as Record<string, unknown>).vignette = 0.4
    const r = lintDoc(doc)
    expect(
      r.problems.some((p) => p.includes('frame.vignette was removed')),
    ).toBe(true)
  })

  const withOverlays = (overlays: unknown) =>
    lintDoc(makeDoc({ overlays } as unknown as Partial<ProjectDoc>))

  it('accepts a valid text overlay', () => {
    const r = withOverlays([
      {
        id: 't0',
        kind: 'text',
        start: 1,
        duration: 3,
        text: 'Ship it',
        preset: 'title',
        transform: { x: 0.5, y: 0.82, scale: 1, rotation: 0 },
        enter: 'rise',
        exit: 'fade',
      },
    ])
    expect(r.problems).toEqual([])
    expect(r.warnings).toEqual([])
  })

  it('flags bad overlay kind, timing, transform, and transitions', () => {
    const r = withOverlays([
      {
        id: 't0',
        kind: 'sticker',
        start: -1,
        duration: 0,
        text: 'x',
        preset: 'title',
        transform: { x: 'mid', y: 100 },
        enter: 'spin',
      },
    ])
    expect(
      r.problems.some((p) =>
        p.includes('kind must be "text" | "image" | "video"'),
      ),
    ).toBe(true)
    expect(r.problems.some((p) => p.includes('start must be'))).toBe(true)
    expect(r.problems.some((p) => p.includes('duration must be'))).toBe(true)
    expect(
      r.problems.some((p) => p.includes('transform.x/y must be numbers')),
    ).toBe(true)
    expect(r.problems.some((p) => p.includes('enter must be'))).toBe(true)
  })

  it('accepts a valid media overlay and flags a bad one', () => {
    const ok = withOverlays([
      {
        id: 'm0',
        kind: 'video',
        start: 0,
        duration: 3,
        key: '/clip.webm',
        width: 0.4,
        radius: 12,
        opacity: 0.9,
        loop: true,
        transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0 },
      },
    ])
    expect(ok.problems).toEqual([])
    const bad = withOverlays([
      {
        id: 'm1',
        kind: 'image',
        start: 0,
        duration: 3,
        key: '',
        width: 2,
        opacity: 5,
        transform: { x: 0.5, y: 0.5 },
      },
    ])
    expect(
      bad.problems.some((p) => p.includes('key must be a non-empty')),
    ).toBe(true)
    expect(
      bad.problems.some((p) => p.includes('width must be a fraction')),
    ).toBe(true)
    expect(bad.problems.some((p) => p.includes('opacity must be 0..1'))).toBe(
      true,
    )
  })

  it('errors on pixel-looking overlay coords (the fraction trap)', () => {
    const r = withOverlays([
      {
        id: 't0',
        kind: 'text',
        start: 0,
        duration: 2,
        text: 'x',
        preset: 'caption',
        transform: { x: 960, y: 885 },
      },
    ])
    expect(r.problems.some((p) => p.includes('look like PIXELS'))).toBe(true)
  })

  it('warns on off-frame overlay coords', () => {
    const r = withOverlays([
      {
        id: 't0',
        kind: 'text',
        start: 0,
        duration: 2,
        text: 'x',
        preset: 'caption',
        transform: { x: 1.6, y: 0.5 },
      },
    ])
    expect(r.problems).toEqual([])
    expect(r.warnings.some((w) => w.includes('outside the frame'))).toBe(true)
  })

  it('warns (not errors) on an unknown overlay preset', () => {
    const r = withOverlays([
      {
        id: 't0',
        kind: 'text',
        start: 0,
        duration: 2,
        text: 'x',
        preset: 'display',
        transform: { x: 0.5, y: 0.5 },
      },
    ])
    expect(r.problems).toEqual([])
    expect(r.warnings.some((w) => w.includes('not a known preset'))).toBe(true)
  })

  it('reverse-ordered but non-overlapping spans are fine (sorted before checks)', () => {
    const r = lintDoc(
      makeDoc({
        zoom: [
          { id: 'z2', in: 5, out: 8, level: 1.8, cx: 0.5, cy: 0.5 },
          { id: 'z1', in: 1, out: 3, level: 1.8, cx: 0.5, cy: 0.5 },
        ],
      }),
    )
    expect(r.problems).toEqual([])
  })

  // The frame is the fixture's own, plus whatever the border case is about.
  // Cast for the same reason makeDoc does: these are partial docs on purpose.
  const borderDoc = (over: Record<string, unknown>) =>
    makeDoc({
      frame: {
        background: '#111',
        padding: 48,
        radius: 12,
        shadow: 0.4,
        border: 0.6,
        aspectRatio: 'auto',
        browserBar: { kind: 'none' },
        ...over,
      },
    } as unknown as Partial<ProjectDoc>)

  it('accepts a border with its own width and colour', () => {
    const r = lintDoc(borderDoc({ borderWidth: 8, borderColor: '#00aaff' }))
    expect(r.problems).toEqual([])
  })

  it('refuses a border width ON_FRAME would silently replace with the hairline', () => {
    const problems = (over: Record<string, unknown>) =>
      lintDoc(borderDoc(over)).problems.join(' ')
    expect(problems({ borderWidth: 0 })).toContain('frame.borderWidth')
    expect(problems({ borderWidth: 40 })).toContain('frame.borderWidth')
    expect(problems({ borderColor: '' })).toContain('frame.borderColor')
  })

  it('says so when a width or colour is set but the border is off', () => {
    const r = lintDoc(borderDoc({ border: 0, borderWidth: 8 }))
    expect(r.problems.join(' ')).toContain('frame.border is 0')
  })

  it('warns when the border is wider than the padding (the frame crops it)', () => {
    // The border grows outward into the padding ring; past the frame edge it
    // crops flat. Still renders, so a warning, never a problem.
    const r = lintDoc(borderDoc({ borderWidth: 12, padding: 8 }))
    expect(r.problems).toEqual([])
    expect(r.warnings.join(' ')).toContain('wider than frame.padding')
  })

  it('a border narrower than the padding warns nothing', () => {
    const r = lintDoc(borderDoc({ borderWidth: 8 })) // fixture padding 48
    expect(r.problems).toEqual([])
    expect(r.warnings.filter((w) => w.includes('frame.padding'))).toEqual([])
  })
})

describe('framing warnings', () => {
  const rect = { x: 380, y: 180, w: 120, h: 40 } // centre (0.34, 0.31)
  const click = {
    t: 2100,
    x: 400,
    y: 200,
    type: 'down' as const,
    button: 0 as const,
    rect,
  }
  const withClick = (over: Partial<ProjectDoc>) =>
    makeDoc({
      ...over,
      source: { ...makeDoc().source, cursor: [click] } as ProjectDoc['source'],
    })

  it('a zoom that contains what was clicked under it warns nothing', () => {
    const r = lintDoc(
      withClick({
        zoom: [{ id: 'z1', in: 1.5, out: 3, level: 2.2, cx: 0.34, cy: 0.31 }],
      }),
    )
    expect(r.problems).toEqual([])
    expect(r.warnings.filter((w) => w.includes('points beside'))).toEqual([])
  })

  it('a zoom pointing elsewhere warns, naming the click time and the target', () => {
    const r = lintDoc(
      withClick({
        zoom: [{ id: 'z1', in: 1.5, out: 3, level: 2.2, cx: 0.85, cy: 0.85 }],
      }),
    )
    expect(r.problems).toEqual([])
    const w = r.warnings.find((x) => x.includes('points beside'))
    expect(w).toContain('zoom z1')
    expect(w).toContain('2.1s')
    expect(w).toContain('0.34, 0.28')
  })

  it('a caption over the thing being clicked warns; one beside it does not', () => {
    const over = lintDoc(
      withClick({
        overlays: [
          {
            id: 't0',
            kind: 'text',
            start: 1,
            duration: 3,
            text: 'Export',
            preset: 'caption',
            transform: { x: 0.34, y: 0.31, scale: 1, rotation: 0 },
          },
        ],
      }),
    )
    expect(
      over.warnings.some((w) =>
        w.includes('sits over the thing being clicked'),
      ),
    ).toBe(true)
    const beside = lintDoc(
      withClick({
        overlays: [
          {
            id: 't0',
            kind: 'text',
            start: 1,
            duration: 3,
            text: 'Export',
            preset: 'caption',
            transform: { x: 0.5, y: 0.82, scale: 1, rotation: 0 },
          },
        ],
      }),
    )
    expect(beside.warnings.some((w) => w.includes('sits over'))).toBe(false)
  })

  it('a take with no cursor rects (browser recorder) warns nothing', () => {
    const r = lintDoc(
      makeDoc({
        zoom: [{ id: 'z1', in: 1.5, out: 3, level: 2.2, cx: 0.85, cy: 0.85 }],
      }),
    )
    expect(r.warnings.filter((w) => w.includes('points beside'))).toEqual([])
  })
})

describe('cover fit', () => {
  const withFrame = (extra: Record<string, unknown>) =>
    lintDoc(
      makeDoc({
        frame: {
          background: '#111',
          padding: 48,
          radius: 12,
          shadow: 0.4,
          border: 0,
          aspectRatio: 'auto',
          browserBar: { kind: 'none' },
          ...extra,
        },
      } as unknown as Partial<ProjectDoc>),
    )

  it('accepts cover with a normalized focus', () => {
    const r = withFrame({ fit: 'cover', focus: { cx: 0.7, cy: 0.3 } })
    expect(r.problems).toEqual([])
  })

  it('refuses an unknown fit and pixel-looking focus values in words', () => {
    const bad = withFrame({ fit: 'fill' })
    expect(bad.problems.some((p) => p.includes('frame.fit must be'))).toBe(true)
    const px = withFrame({ fit: 'cover', focus: { cx: 640, cy: 0.5 } })
    expect(
      px.problems.some((p) =>
        p.includes('frame.focus.cx must be a normalized video fraction'),
      ),
    ).toBe(true)
  })

  it('warns when focus rides a contain frame', () => {
    const r = withFrame({ focus: { cx: 0.5, cy: 0.5 } })
    expect(r.problems).toEqual([])
    expect(r.warnings.some((w) => w.includes('only acts under'))).toBe(true)
  })
})

describe('step anchors', () => {
  const span = (anchor: unknown) =>
    lintDoc(
      makeDoc({
        zoom: [
          {
            id: 'u1',
            in: 1,
            out: 3,
            level: 2,
            cx: 0.5,
            cy: 0.5,
            source: 'manual',
            anchor,
          } as never,
        ],
      }),
    )

  it('accepts a well-formed anchor by id or index', () => {
    expect(span({ step: 'cta' }).problems).toEqual([])
    expect(span({ step: 2, at: 'end', offset: -0.3 }).problems).toEqual([])
  })

  it('refuses a malformed anchor in words', () => {
    expect(
      span({ step: 1.5 }).problems.some((p) => p.includes('anchor.step')),
    ).toBe(true)
    expect(
      span({ step: 'cta', at: 'middle' }).problems.some((p) =>
        p.includes('anchor.at'),
      ),
    ).toBe(true)
    expect(span('cta').problems.some((p) => p.includes('anchor must be'))).toBe(
      true,
    )
  })
})
