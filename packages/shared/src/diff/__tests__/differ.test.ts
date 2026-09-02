import { describe, expect, it } from 'vitest'
import { coalesce } from '../coalesce'
import { diffConfig } from '../diffConfig'
import { diffDoc } from '../diffDoc'
import { summarize } from '../summarize'

/**
 * Golden triples (docA, docB) → ops → summary, pinned byte-identical: the
 * summary is what lands in the agent's context, so a drifting differ is a
 * lying changelog. Includes the known trap cases.
 */

const baseDoc = {
  segments: [{ in: 0, out: 10 }],
  zoom: [
    { id: 'z1', in: 1, out: 3, level: 2, cx: 0.5, cy: 0.5 },
    { id: 'z3', in: 4.2, out: 5.0, level: 2.2, cx: 0.4, cy: 0.6 },
  ],
  tilt: [{ id: 't1', in: 2, out: 4, rx: 4, ry: -6 }],
  audio: [],
  cursor: { smoothing: 0.15, size: 24 },
  cam: { visible: true },
  frame: { padding: 0.08 },
  export: { resolution: '1080p', fps: 30, format: 'mp4' },
}

describe('diffDoc', () => {
  it('the analysis example: modify + remove, summarized', () => {
    const b = {
      ...baseDoc,
      zoom: [baseDoc.zoom[0], { ...baseDoc.zoom[1], out: 4.6, level: 1.8 }],
      tilt: [],
    }
    const ops = diffDoc(baseDoc, b)
    expect(ops).toEqual([
      {
        op: 'modify',
        track: 'zoom',
        id: 'z3',
        props: { level: [2.2, 1.8], out: [5.0, 4.6] },
      },
      {
        op: 'remove',
        track: 'tilt',
        id: 't1',
        props: { in: [undefined, 2], out: [undefined, 4] },
      },
    ])
    expect(summarize(ops)).toBe(
      'zoom z3: level 2.2→1.8, end 5s→4.6s; tilt t1 removed',
    )
  })

  it('TRAP: a moved span is a modify (id identity), never remove+add', () => {
    const b = {
      ...baseDoc,
      zoom: [baseDoc.zoom[0], { ...baseDoc.zoom[1], in: 6.0, out: 6.8 }],
    }
    const ops = diffDoc(baseDoc, b)
    expect(ops).toHaveLength(1)
    expect(ops[0].op).toBe('modify')
    expect(ops[0].id).toBe('z3')
  })

  it('TRAP: delete + recreate under a NEW id is remove+add, never a move', () => {
    const b = {
      ...baseDoc,
      zoom: [
        baseDoc.zoom[0],
        { id: 'z9', in: 4.2, out: 5.0, level: 2.2, cx: 0.4, cy: 0.6 },
      ],
    }
    const ops = diffDoc(baseDoc, b)
    expect(ops.map((o) => `${o.op} ${o.id}`)).toEqual(['remove z3', 'add z9'])
  })

  it('trim reports kept-footage movement, not raw segment arrays', () => {
    const b = { ...baseDoc, segments: [{ in: 0.4, out: 10 }] }
    const ops = diffDoc(baseDoc, b)
    expect(ops).toEqual([
      {
        op: 'modify',
        track: 'segments',
        id: 'segments',
        props: { duration: [10, 9.6] },
      },
    ])
    expect(summarize(ops)).toBe('trim: kept footage 10s→9.6s')
  })

  it('identical docs produce zero ops and the empty summary', () => {
    expect(diffDoc(baseDoc, baseDoc)).toEqual([])
    expect(summarize([])).toBe('no changes')
  })

  it('cam pose spans (MO) diff as an id-keyed track and summarize', () => {
    const a = {
      ...baseDoc,
      camMotion: [{ id: 'm1', in: 2, out: 5, x: 0.2, y: 0.8, size: 0.25 }],
    }
    const b = {
      ...baseDoc,
      camMotion: [
        { id: 'm1', in: 2, out: 5, x: 0.8, y: 0.8, size: 0.4 },
        { id: 'm2', in: 6, out: 8, size: 0.5 },
      ],
    }
    const ops = diffDoc(a, b)
    expect(ops).toEqual([
      {
        op: 'modify',
        track: 'camMove',
        id: 'm1',
        props: { size: [0.25, 0.4], x: [0.2, 0.8] },
      },
      {
        op: 'add',
        track: 'camMove',
        id: 'm2',
        props: { in: [undefined, 6], out: [undefined, 8] },
      },
    ])
    expect(summarize(ops)).toBe(
      'camMove m1: size 0.25→0.4, x 0.2→0.8; camMove m2 added (6s–8s)',
    )
  })
})

const baseConfig = {
  version: 2,
  duration: 8,
  camera: { preset: 'orthographic' },
  params: [
    {
      key: 'glow',
      label: 'Glow',
      kind: 'number',
      min: 0,
      max: 1,
      default: 0.4,
    },
    {
      key: 'speed',
      label: 'Speed',
      kind: 'number',
      min: 0.5,
      max: 2,
      default: 1,
    },
  ],
  presets: [{ name: 'Calm', values: { glow: 0.2 } }],
  data: { glow: 0.4, speed: 1 },
  createContent: '(ctx) => {\n  const a = 1\n  return {}\n}',
  createTimeline: '(ctx, c, d) => tl',
}

describe('diffConfig', () => {
  it('knob turn: typed value change keyed by param key', () => {
    const b = { ...baseConfig, data: { ...baseConfig.data, glow: 0.7 } }
    const ops = diffConfig(baseConfig, b)
    expect(ops).toEqual([
      {
        op: 'modify',
        track: 'knob',
        id: 'glow',
        props: { value: [0.4, 0.7] },
      },
    ])
    expect(summarize(ops)).toBe('knob glow: 0.4→0.7')
  })

  it('content-knob values collapse newlines and truncate in summaries', () => {
    const long = 'The launch line\neveryone reads twice, then reads again'
    expect(
      summarize([
        {
          op: 'modify',
          track: 'knob',
          id: 'headline',
          props: { value: ['SplitText', long] },
        },
      ]),
    ).toBe(
      'knob headline: SplitText→"The launch line everyone reads twice, t…"',
    )
  })

  it('knob add carries its kind in the summary', () => {
    expect(
      summarize([
        {
          op: 'add',
          track: 'knob',
          id: 'font',
          props: { kind: [undefined, 'font'] },
        },
      ]),
    ).toBe('knob font added (font)')
  })

  it('TRAP: a renamed param (same spec) is one replaced knob, not remove+add', () => {
    const b = {
      ...baseConfig,
      params: [
        baseConfig.params[0],
        {
          key: 'tempo',
          label: 'Tempo',
          kind: 'number',
          min: 0.5,
          max: 2,
          default: 1,
        },
      ],
      data: { glow: 0.4, tempo: 1 },
    }
    const ops = diffConfig(baseConfig, b)
    // Data keys declared as params ride the knob op — never doubled as
    // data-track noise.
    expect(ops).toEqual([
      {
        op: 'modify',
        track: 'knob',
        id: 'tempo',
        props: { key: ['speed', 'tempo'] },
      },
    ])
    expect(summarize(ops)).toBe('replaced knob speed with tempo')
  })

  it('a retired knob with a DIFFERENT replacement spec is remove+add', () => {
    const b = {
      ...baseConfig,
      params: [
        baseConfig.params[0],
        {
          key: 'mood',
          kind: 'select',
          options: ['warm', 'noir'],
          default: 'warm',
        },
      ],
      data: { glow: 0.4, speed: 1, mood: 'warm' },
    }
    const ops = diffConfig(baseConfig, b)
    const knobOps = ops.filter((o) => o.track === 'knob')
    expect(knobOps.map((o) => `${o.op} ${o.id}`)).toEqual([
      'remove speed',
      'add mood',
    ])
  })

  it('function strings collapse to a line magnitude', () => {
    const b = {
      ...baseConfig,
      createContent: '(ctx) => {\n  const a = 2\n  const b = 3\n  return {}\n}',
    }
    const ops = diffConfig(baseConfig, b)
    expect(ops).toEqual([
      { op: 'modify', track: 'code', id: 'createContent', lines: 2 },
    ])
    expect(summarize(ops)).toBe('code createContent changed (2 lines)')
  })

  it('duration + look changes read as prose', () => {
    const b = {
      ...baseConfig,
      duration: 10,
      presets: [{ name: 'Calm', values: { glow: 0.1 } }],
    }
    const ops = diffConfig(baseConfig, b)
    expect(summarize(ops)).toBe('look "Calm" changed; duration 8s→10s')
  })
})

describe('coalesce', () => {
  it('nets a modify chain to initial→final and drops no-net props', () => {
    const ops = coalesce([
      {
        op: 'modify',
        track: 'zoom',
        id: 'z3',
        props: { level: [2.2, 1.5], out: [5, 4.6] },
      },
      {
        op: 'modify',
        track: 'zoom',
        id: 'z3',
        props: { level: [1.5, 1.8], out: [4.6, 5] },
      },
    ])
    expect(ops).toEqual([
      { op: 'modify', track: 'zoom', id: 'z3', props: { level: [2.2, 1.8] } },
    ])
  })

  it('add then remove vanishes; add then modify stays an add', () => {
    expect(
      coalesce([
        { op: 'add', track: 'tilt', id: 't2' },
        { op: 'remove', track: 'tilt', id: 't2' },
      ]),
    ).toEqual([])
    expect(
      coalesce([
        { op: 'add', track: 'tilt', id: 't2', props: { in: [undefined, 1] } },
        { op: 'modify', track: 'tilt', id: 't2', props: { rx: [4, 6] } },
      ]),
    ).toEqual([
      {
        op: 'add',
        track: 'tilt',
        id: 't2',
        props: { in: [undefined, 1], rx: [4, 6] },
      },
    ])
  })

  it('orders deterministically: track order, then time anchor, then id', () => {
    const ops = coalesce([
      { op: 'modify', track: 'knob', id: 'glow', props: { value: [0.4, 0.7] } },
      { op: 'add', track: 'zoom', id: 'z9', props: { in: [undefined, 6] } },
      { op: 'add', track: 'zoom', id: 'z5', props: { in: [undefined, 2] } },
      {
        op: 'modify',
        track: 'segments',
        id: 'segments',
        props: { duration: [10, 9] },
      },
    ])
    expect(ops.map((o) => o.id)).toEqual(['segments', 'z5', 'z9', 'glow'])
  })

  it('summary caps with "and N smaller changes"', () => {
    const many = Array.from({ length: 15 }, (_, i) => ({
      op: 'modify' as const,
      track: 'zoom',
      id: `z${i}`,
      props: { level: [1, 2] as [unknown, unknown] },
    }))
    const s = summarize(many, { maxItems: 12 })
    expect(s.endsWith('and 3 smaller changes')).toBe(true)
  })
})

describe('determinism', () => {
  it('same inputs ⇒ byte-identical ops and summary', () => {
    const b = {
      ...baseDoc,
      zoom: [baseDoc.zoom[0], { ...baseDoc.zoom[1], level: 1.8 }],
    }
    const run = () => summarize(coalesce(diffDoc(baseDoc, b)))
    expect(run()).toBe(run())
    expect(JSON.stringify(diffDoc(baseDoc, b))).toBe(
      JSON.stringify(diffDoc(baseDoc, b)),
    )
  })
})

describe('speed output-duration line', () => {
  const src = { meta: { durationMs: 30_000 } }
  it('a rate change carries the output cost', () => {
    const a = {
      ...baseDoc,
      source: src,
      segments: [{ in: 0, out: 30 }],
      speed: [{ id: 'sp0', in: 10, out: 20, rate: 2 }],
    }
    const b = {
      ...baseDoc,
      source: src,
      segments: [{ in: 0, out: 30 }],
      speed: [{ id: 'sp0', in: 10, out: 20, rate: 4 }],
    }
    expect(summarize(diffDoc(a, b))).toBe(
      'speed sp0: rate 2→4, output 25s→22.5s',
    )
  })

  it('a new span carries it too (nothing modified, but the video shrank)', () => {
    const a = { ...baseDoc, source: src, segments: [{ in: 0, out: 30 }] }
    const b = {
      ...baseDoc,
      source: src,
      segments: [{ in: 0, out: 30 }],
      speed: [{ id: 'sp0', in: 10, out: 20, rate: 2 }],
    }
    const s = summarize(diffDoc(a, b))
    expect(s).toContain('speed sp0 added')
    expect(s).toContain('output 30s→25s')
  })

  it('says nothing when the cost is unknowable (no source, no segments)', () => {
    const a = { zoom: [], speed: [{ id: 'sp0', in: 1, out: 2, rate: 2 }] }
    const b = { zoom: [], speed: [{ id: 'sp0', in: 1, out: 2, rate: 4 }] }
    expect(summarize(diffDoc(a, b))).toBe('speed sp0: rate 2→4')
  })
})
