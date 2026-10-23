import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_CAM_STYLE,
  DEFAULT_CURSOR_STYLE,
  DEFAULT_FRAME_STYLE,
} from '@vosjs/studio-core'
import { cmdJoin } from '../join'
import { JOIN_RECORD_NAME, matchInputs } from '../rejoin'
import { lintDoc } from '../validateDoc'
import type { ProjectDoc, StepSpan, TextOverlayClip } from '@vosjs/studio-core'
import type { JoinRecord, RejoinReport } from '../rejoin'

let root: string
let writes: string[] = []
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'vos-rejoin-'))
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    writes.push(String(chunk))
    return true
  })
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
})
afterAll(async () => {
  vi.restoreAllMocks()
  await rm(root, { recursive: true, force: true })
})

const meta = (durationMs: number, steps: StepSpan[]) => ({
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

const text = (
  id: string,
  start: number,
  over: Partial<TextOverlayClip> = {},
): TextOverlayClip => ({
  id,
  kind: 'text',
  text: id,
  preset: 'label',
  start,
  duration: 1,
  transform: { x: 0.5, y: 0.2, scale: 1, rotation: 0 },
  ...over,
})

/** A take: footage bytes of its own, meta, actions, doc.json. */
async function writeTake(
  name: string,
  durationMs: number,
  steps: StepSpan[],
  over: Partial<ProjectDoc> = {},
): Promise<string> {
  const dir = join(root, name)
  await mkdir(dir, { recursive: true })
  const doc: ProjectDoc = {
    source: {
      videoKey: 'recording.webm',
      cursor: [],
      meta: meta(durationMs, steps),
    },
    segments: [{ in: 0, out: durationMs / 1000 }],
    zoom: [],
    audio: [],
    cursor: DEFAULT_CURSOR_STYLE,
    cam: DEFAULT_CAM_STYLE,
    frame: DEFAULT_FRAME_STYLE,
    export: { resolution: '1080p', fps: 30, format: 'mp4' },
    ...over,
  }
  await writeFile(join(dir, 'recording.webm'), `footage of ${name}`)
  await writeFile(join(dir, 'meta.json'), JSON.stringify(doc.source.meta))
  await writeFile(
    join(dir, 'actions.json'),
    JSON.stringify({
      steps: steps.map((s) => ({
        do: 'click',
        selector: `#${s.id}`,
        id: s.id,
      })),
    }),
  )
  await writeFile(join(dir, 'doc.json'), JSON.stringify(doc))
  return dir
}

const step = (n: number, id: string, t: number): StepSpan => ({
  step: n,
  id,
  do: 'click',
  tStart: t,
  tEnd: t + 0.5,
})

const readDoc = async (dir: string) =>
  JSON.parse(await readFile(join(dir, 'doc.json'), 'utf8')) as ProjectDoc
const writeDoc = (dir: string, doc: ProjectDoc) =>
  writeFile(join(dir, 'doc.json'), JSON.stringify(doc, null, 2))

/** The done event of the last command run with --json. */
function done(): Record<string, unknown> & {
  keptEdits?: RejoinReport
} {
  const events = writes
    .flatMap((l) => l.split('\n'))
    .filter((l) => l.startsWith('{'))
    .map((l) => JSON.parse(l) as Record<string, unknown>)
  writes = []
  return events.reverse().find((e) => e.event === 'done') as Record<
    string,
    unknown
  >
}

let a: string
let b: string
let c: string
let d: string
beforeAll(async () => {
  a = await writeTake('a', 10000, [step(0, 'open', 2), step(1, 'save', 6)], {
    zoom: [
      { id: 'z1', in: 1, out: 3, level: 1.5, cx: 0.5, cy: 0.5, source: 'auto' },
      { id: 'z2', in: 5, out: 7, level: 1.8, cx: 0.4, cy: 0.4, source: 'auto' },
    ],
  })
  b = await writeTake('b', 8000, [step(0, 'share', 3)], {
    zoom: [
      { id: 'z1', in: 2, out: 4, level: 1.6, cx: 0.4, cy: 0.4, source: 'auto' },
    ],
  })
  c = await writeTake('c', 6000, [step(0, 'done', 1)])
  d = await writeTake('d', 4000, [step(0, 'intro', 0.5)])
})

/**
 * The edits a person makes after `vos join a b`: a trim, b's clip moved to
 * the front as a cold open, a speed span and a zoom kept on b, a zoom
 * rejected on a, a caption anchored to b's step, a label placed over a's
 * footage, one over b's, an ending past the footage, the frame, the still,
 * the export, and a score.
 */
function edit(doc: ProjectDoc): ProjectDoc {
  return {
    ...doc,
    // b (m1) opens the film; a is trimmed to 1..9.
    segments: [
      { in: 2, out: 5, media: 'm1' },
      { in: 1, out: 9 },
    ],
    speed: [{ id: 's1', media: 'm1', in: 2.5, out: 3, rate: 2 }],
    zoom: [
      { ...doc.zoom.find((z) => z.id === 'm1-z1')!, source: 'manual' },
      { ...doc.zoom.find((z) => z.id === 'z1')!, source: 'manual' },
    ],
    rejected: [{ id: 'r0', lane: 'zoom', in: 5, out: 7, note: 'by hand' }],
    overlays: [
      text('cap-share', 0, {
        anchor: { step: 'share', media: 'm1', offset: 0.2 },
      }),
      // At 4 s: over a's footage (output 2.75..10.75).
      text('over-a', 4),
      // At 1 s: over b's cold open (output 0..2.75).
      text('over-b', 1),
      // Past the footage (it ends at 10.75).
      text('ending', 11),
    ],
    frame: { ...doc.frame, background: '#101010', radius: 14 },
    still: 6,
    export: { resolution: '2k', fps: 60, format: 'mp4' },
    audio: [
      {
        id: 'score',
        key: 'https://assets.example.test/music/theme.mp3',
        start: 0,
        in: 0,
        out: 11,
        duration: 120,
        gain: 0.5,
        name: 'Theme',
        fadeIn: 0,
        fadeOut: 1.5,
      },
    ],
  }
}

describe('vos join --keep-edits', () => {
  it('adds an input and keeps every edit, ids by source file', async () => {
    const out = join(root, 'film-add')
    expect(await cmdJoin([a, b, '--out', out])).toBe(0)
    const record = JSON.parse(
      await readFile(join(out, JOIN_RECORD_NAME), 'utf8'),
    ) as JoinRecord
    expect(record.inputs.map((x) => [x.path, x.media])).toEqual([
      ['../a', ''],
      ['../b', 'm1'],
    ])
    const edited = edit(await readDoc(out))
    await writeDoc(out, edited)
    await writeFile(join(out, 'vos.json'), '{"vosId":"keep-me"}')

    expect(
      await cmdJoin([a, b, c, '--out', out, '--keep-edits', '--json']),
    ).toBe(0)
    const report = done().keptEdits!
    const doc = await readDoc(out)
    // The edits stand; c lands after them, as m2.
    expect(doc.segments).toEqual([
      ...edited.segments,
      { in: 0, out: 6, media: 'm2' },
    ])
    expect(doc.speed).toEqual(edited.speed)
    expect(doc.zoom).toEqual(edited.zoom)
    expect(doc.rejected).toEqual(edited.rejected)
    expect(doc.frame).toEqual(edited.frame)
    expect(doc.export).toEqual(edited.export)
    expect(doc.still).toBe(6)
    expect(doc.audio).toEqual(edited.audio)
    const byId = new Map(doc.overlays!.map((o) => [o.id, o]))
    expect(byId.get('over-a')!.start).toBe(4)
    expect(byId.get('over-b')!.start).toBe(1)
    // The ending stays past the footage, which grew by c's 6 s.
    expect(byId.get('ending')!.start).toBe(17)
    expect(byId.get('cap-share')!.anchor).toEqual({
      step: 'share',
      media: 'm1',
      offset: 0.2,
    })
    expect(doc.media!.map((m) => m.id)).toEqual(['m1', 'm2'])
    // A media carries its script, so its captions are read from the take.
    expect(doc.media![1].script).toMatchObject({ steps: [{ id: 'done' }] })
    expect(report.kept.map((k) => k.id)).toEqual(['', 'm1'])
    expect(report.added).toEqual([{ label: c, id: 'm2' }])
    expect(report.dropped).toEqual([])
    expect(report.shifted).toEqual(['ending'])
    // The rest of the take is left as it was.
    expect(await readFile(join(out, 'vos.json'), 'utf8')).toContain('keep-me')
    expect(existsSync(join(out, 'm2/recording.webm'))).toBe(true)
    expect(lintDoc(doc).problems).toEqual([])
  })

  it('drops a removed input with its edits, named, and never reuses its id', async () => {
    const out = join(root, 'film-drop')
    expect(await cmdJoin([a, b, c, '--out', out])).toBe(0)
    const joined = await readDoc(out)
    await writeDoc(out, {
      ...edit(joined),
      segments: [...edit(joined).segments, { in: 0, out: 6, media: 'm2' }],
    })
    expect(
      await cmdJoin([a, c, d, '--out', out, '--keep-edits', '--json']),
    ).toBe(0)
    const report = done().keptEdits!
    const doc = await readDoc(out)
    // b's cold open is gone; c keeps m2; d is m3 (m1 stays retired).
    expect(doc.segments).toEqual([
      { in: 1, out: 9 },
      { in: 0, out: 6, media: 'm2' },
      { in: 0, out: 4, media: 'm3' },
    ])
    expect(doc.media!.map((m) => m.id)).toEqual(['m2', 'm3'])
    expect(doc.speed).toBeUndefined()
    expect(doc.zoom.map((z) => z.id)).toEqual(['z1'])
    const ids = doc.overlays!.map((o) => o.id)
    expect(ids).not.toContain('cap-share')
    expect(ids).not.toContain('over-b')
    // a's footage now starts at 0 (it started at 2.75): its label follows it.
    expect(doc.overlays!.find((o) => o.id === 'over-a')!.start).toBe(1.25)
    // The still sat over a's footage and follows it the same way.
    expect(doc.still).toBe(3.25)
    expect(report.dropped).toEqual([
      {
        input: '../b',
        id: 'm1',
        why: 'removed',
        segments: 1,
        spans: 2,
        layers: ['cap-share', 'over-b'],
        sound: [],
      },
    ])
    expect(report.added).toEqual([{ label: d, id: 'm3' }])
    expect(existsSync(join(out, 'm1'))).toBe(false)
    expect(lintDoc(doc).problems).toEqual([])
  })

  it('places a new input before the next kept one, and regroups on a reorder', async () => {
    const out = join(root, 'film-order')
    expect(await cmdJoin([a, b, c, '--out', out])).toBe(0)
    const joined = await readDoc(out)
    // The person moves c (m2) to the front.
    await writeDoc(out, {
      ...joined,
      segments: [joined.segments[2], joined.segments[0], joined.segments[1]],
    })
    expect(await cmdJoin([a, d, b, c, '--out', out, '--keep-edits'])).toBe(0)
    let doc = await readDoc(out)
    // d (new) goes before b, the next kept input; c stays at the front.
    expect(doc.segments.map((s) => s.media ?? '')).toEqual([
      'm2',
      '',
      'm3',
      'm1',
    ])
    // A reorder of the kept inputs: argument order again, each input's own
    // segments in their edited order.
    expect(
      await cmdJoin([a, c, b, d, '--out', out, '--keep-edits', '--json']),
    ).toBe(0)
    expect(done().keptEdits!.regrouped).toBe(true)
    doc = await readDoc(out)
    expect(doc.segments.map((s) => s.media ?? '')).toEqual([
      '',
      'm2',
      'm1',
      'm3',
    ])
  })

  it('reads changed footage as a new recording, and refuses another primary', async () => {
    const e = await writeTake('e', 5000, [step(0, 'go', 1)])
    const out = join(root, 'film-change')
    expect(await cmdJoin([a, e, '--out', out])).toBe(0)
    const joined = await readDoc(out)
    await writeDoc(out, {
      ...joined,
      speed: [{ id: 's1', media: 'm1', in: 1, out: 2, rate: 2 }],
    })
    // e is re-recorded in place.
    await writeFile(join(e, 'recording.webm'), 'new footage of e')
    expect(await cmdJoin([a, e, '--out', out, '--keep-edits', '--json'])).toBe(
      0,
    )
    const report = done().keptEdits!
    expect(report.dropped).toMatchObject([
      { id: 'm1', why: 'changed', spans: 1 },
    ])
    expect(report.added).toEqual([{ label: e, id: 'm2' }])
    const doc = await readDoc(out)
    expect(doc.speed).toBeUndefined()
    expect(doc.segments).toEqual([
      { in: 0, out: 10 },
      { in: 0, out: 5, media: 'm2' },
    ])
    await expect(cmdJoin([b, a, '--out', out, '--keep-edits'])).rejects.toThrow(
      /not the primary/,
    )
    await expect(
      cmdJoin([a, e, '--out', out, '--keep-edits', '--force']),
    ).rejects.toThrow(/pass one/)
    await expect(cmdJoin([a, e, '--out', out])).rejects.toThrow(/--keep-edits/)
  })

  it('matches a take joined before join.json by the footage it holds', async () => {
    const out = join(root, 'film-old')
    expect(await cmdJoin([a, b, '--out', out])).toBe(0)
    await rm(join(out, JOIN_RECORD_NAME))
    const edited = edit(await readDoc(out))
    await writeDoc(out, edited)
    expect(
      await cmdJoin([a, b, c, '--out', out, '--keep-edits', '--json']),
    ).toBe(0)
    const report = done().keptEdits!
    expect(report.kept.map((k) => k.id)).toEqual(['', 'm1'])
    expect(report.dropped).toEqual([])
    const doc = await readDoc(out)
    expect(doc.speed).toEqual(edited.speed)
    expect(existsSync(join(out, JOIN_RECORD_NAME))).toBe(true)
  })

  it('is deterministic: the same re-join twice writes the same document', async () => {
    const out = join(root, 'film-twice')
    expect(await cmdJoin([a, b, '--out', out])).toBe(0)
    await writeDoc(out, edit(await readDoc(out)))
    expect(await cmdJoin([a, b, c, '--out', out, '--keep-edits'])).toBe(0)
    const once = await readFile(join(out, 'doc.json'), 'utf8')
    expect(await cmdJoin([a, b, c, '--out', out, '--keep-edits'])).toBe(0)
    expect(await readFile(join(out, 'doc.json'), 'utf8')).toBe(once)
  })
})

describe('matchInputs', () => {
  it('pairs a repeated input in order, and tells a change from a removal', () => {
    const prev = [
      { path: 'x', kind: 'take' as const, footage: 'X', media: '' },
      { path: 'y', kind: 'take' as const, footage: 'Y', media: 'm1' },
      { path: 'x', kind: 'take' as const, footage: 'X', media: 'm2' },
      { path: 'z', kind: 'take' as const, footage: 'Z', media: 'm3' },
    ]
    const r = matchInputs(prev, [
      { path: 'x', footage: 'X' },
      { path: 'moved/y', footage: 'Y' },
      { path: 'x', footage: 'X' },
      { path: 'z', footage: 'Z2' },
    ])
    expect(r.match).toEqual([0, 1, 2, null])
    expect(r.changed).toEqual([3])
    expect(r.removed).toEqual([])
  })
})
