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
import { FULL_BLEED_FRAME, cmdJoin, joinDocs } from '../join'
import {
  STEP_CAPTIONS_FROM,
  bareCaptionsFlag,
  landStepCaptions,
} from '../stepCaptions'
import { lintDoc } from '../validateDoc'
import { writeFixtureMp4 } from './fixtureMedia'
import type {
  OverlayClip,
  ProjectDoc,
  StepSpan,
  TextOverlayClip,
} from '@vosjs/studio-core'

let root: string
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'vos-join-'))
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
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

function takeDoc(
  over: Partial<ProjectDoc> & { source: ProjectDoc['source'] },
): ProjectDoc {
  return {
    segments: [],
    zoom: [],
    audio: [],
    cursor: DEFAULT_CURSOR_STYLE,
    cam: DEFAULT_CAM_STYLE,
    frame: DEFAULT_FRAME_STYLE,
    export: { resolution: '1080p', fps: 30, format: 'mp4' },
    ...over,
  }
}

/** A take directory: footage bytes, meta, actions with captions, doc.json. */
async function writeTake(
  name: string,
  doc: ProjectDoc,
  captions: Record<string, string>,
): Promise<string> {
  const dir = join(root, name)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'recording.webm'), `footage of ${name}`)
  await writeFile(join(dir, 'meta.json'), JSON.stringify(doc.source.meta))
  await writeFile(join(dir, 'cursor.json'), JSON.stringify(doc.source.cursor))
  const steps = (doc.source.meta.steps ?? []).map((s) => ({
    do: 'click',
    selector: `#${s.id}`,
    id: s.id,
    ...(s.id && captions[s.id] ? { caption: captions[s.id] } : {}),
  }))
  await writeFile(join(dir, 'actions.json'), JSON.stringify({ steps }))
  await writeFile(join(dir, 'doc.json'), JSON.stringify(doc))
  return dir
}

const takeA = () =>
  takeDoc({
    source: {
      videoKey: 'recording.webm',
      cursor: [],
      meta: meta(10000, [
        { step: 0, id: 'open', do: 'click', tStart: 2, tEnd: 2.5 },
        { step: 1, id: 'save', do: 'click', tStart: 6, tEnd: 6.5 },
      ]),
    },
    segments: [{ in: 0, out: 10 }],
    zoom: [{ id: 'z1', in: 1, out: 3, level: 1.5, cx: 0.5, cy: 0.5 }],
    overlays: [text('title', 0.5)],
  })

const takeB = () =>
  takeDoc({
    source: {
      videoKey: 'recording.webm',
      cursor: [],
      meta: meta(8000, [
        { step: 0, id: 'share', do: 'click', tStart: 3, tEnd: 3.4 },
      ]),
    },
    // B is trimmed: its first second is cut.
    segments: [{ in: 1, out: 8 }],
    zoom: [{ id: 'z1', in: 3, out: 4, level: 1.6, cx: 0.4, cy: 0.4 }],
    speed: [{ id: 's1', in: 5, out: 7, rate: 2 }],
    overlays: [
      text('note', 1),
      // In B's own cut, step `share` (source 3) plays at 2; the callout
      // sits half a second after it.
      text('callout', 2.5, { pin: { step: 'share' } }),
    ],
  })

describe('vos join', () => {
  it('joins two takes and a video file into one take that validates', async () => {
    const a = await writeTake('a', takeA(), {
      open: 'Open the panel',
      save: 'Save the change',
    })
    const b = await writeTake('b', takeB(), { share: 'Share the link' })
    const clip = join(root, 'clip.mp4')
    await writeFixtureMp4(clip, { seconds: 2 })
    const out = join(root, 'film')

    expect(await cmdJoin([a, b, clip, '--out', out, '--captions'])).toBe(0)
    const doc = JSON.parse(
      await readFile(join(out, 'doc.json'), 'utf8'),
    ) as ProjectDoc

    // The primary's frame and cut; each next input a media, in order.
    expect(doc.frame).toEqual(DEFAULT_FRAME_STYLE)
    expect(doc.media!.map((m) => [m.id, m.videoKey])).toEqual([
      ['m1', 'm1/recording.webm'],
      ['m2', 'm2/recording.mp4'],
    ])
    expect(doc.media![0].meta.steps![0].id).toBe('share')
    expect(doc.media![1]).toMatchObject({
      cursor: [],
      frame: FULL_BLEED_FRAME,
      meta: { width: 640, height: 360, durationMs: 2000 },
    })
    expect(doc.segments).toEqual([
      { in: 0, out: 10 },
      { in: 1, out: 8, media: 'm1' },
      { in: 0, out: 2, media: 'm2' },
    ])
    // Spans tagged with their media and renamed per input.
    expect(doc.zoom.map((z) => [z.id, z.media])).toEqual([
      ['z1', undefined],
      ['m1-z1', 'm1'],
    ])
    expect(doc.speed).toEqual([
      { id: 'm1-s1', in: 5, out: 7, rate: 2, media: 'm1' },
    ])
    // B's layers: the plain one moved to where B now starts (10 s), the
    // pinned one anchored to its step (source 3 on m1 plays at 10 + 2).
    const byId = new Map(doc.overlays!.map((o) => [o.id, o]))
    expect(byId.get('title')!.start).toBe(0.5)
    expect(byId.get('m1-note')!.start).toBe(11)
    const callout = byId.get('m1-callout')!
    expect(callout.pin).toBeUndefined()
    expect(callout.anchor).toEqual({ step: 'share', media: 'm1', offset: 0.5 })
    expect(callout.start).toBe(12.5)
    // The step captions, anchored to their steps.
    const steps = doc.overlays!.filter((o) => o.from === STEP_CAPTIONS_FROM)
    expect(
      steps.map((o) => [o.id, (o as TextOverlayClip).text, o.anchor, o.start]),
    ).toEqual([
      [
        'step-open',
        'Open the panel',
        { step: 'open', at: 'end', offset: 0.2 },
        2.7,
      ],
      [
        'step-save',
        'Save the change',
        { step: 'save', at: 'end', offset: 0.2 },
        6.7,
      ],
      [
        'step-m1-share',
        'Share the link',
        { step: 'share', media: 'm1', at: 'end', offset: 0.2 },
        12.6,
      ],
    ])
    // Every file the document names is in the new take.
    for (const f of [
      'recording.webm',
      'm1/recording.webm',
      'm2/recording.mp4',
      'meta.json',
      'actions.json',
    ])
      expect(existsSync(join(out, f))).toBe(true)
    expect(existsSync(join(out, 'vos.json'))).toBe(false)
    expect(lintDoc(doc).problems).toEqual([])

    // An existing --out is refused, and replaced with --force.
    await expect(cmdJoin([a, b, '--out', out])).rejects.toThrow(/--force/)
    expect(await cmdJoin([a, b, '--out', out, '--force'])).toBe(0)
    const again = JSON.parse(
      await readFile(join(out, 'doc.json'), 'utf8'),
    ) as ProjectDoc
    expect(again.media!.map((m) => m.id)).toEqual(['m1'])
  })

  it('refuses an --out inside an input, and one input', async () => {
    const a = await writeTake('solo', takeA(), {})
    await expect(cmdJoin([a, '--out', join(root, 'x')])).rejects.toThrow(
      /vos join/,
    )
    const b = await writeTake('solo-b', takeB(), {})
    await expect(cmdJoin([a, b, '--out', join(a, 'inner')])).rejects.toThrow(
      /overlaps/,
    )
  })
})

describe('vos join: endings', () => {
  it('drops every input’s ending but the last’s, and says so', () => {
    const part = (label: string, doc: ProjectDoc) => ({
      label,
      kind: 'take' as const,
      doc,
      dir: join(root, label),
      actions: null,
    })
    // A plays 10 s; its outro starts after that. B plays 6 s (1..8 with
    // 5..7 at 2×); its outro starts at 6.5 s of its own cut.
    const a = takeA()
    a.overlays!.push(text('outro', 10.2))
    const b = takeB()
    b.overlays!.push(text('outro', 6.5))
    const mid = takeB()
    mid.overlays!.push(text('outro', 6.5))
    const plan = joinDocs([part('a', a), part('mid', mid), part('b', b)])
    const ids = plan.doc.overlays!.map((o) => [o.id, o.start])
    // A's and the middle input's endings are gone; B's plays at the end:
    // 10 + 6 + 6.5.
    expect(ids.find(([id]) => id === 'outro')).toBeUndefined()
    expect(ids.find(([id]) => id === 'm1-outro')).toBeUndefined()
    expect(ids).toContainEqual(['m2-outro', 22.5])
    expect(plan.notes).toContainEqual(
      expect.stringMatching(
        /^a: dropped outro, which played after its footage/,
      ),
    )
    expect(plan.notes).toContainEqual(
      expect.stringMatching(/^mid: dropped outro, which played/),
    )
    // Layers inside the footage are kept everywhere.
    expect(ids).toContainEqual(['title', 0.5])
    expect(ids).toContainEqual(['m1-note', 11])
    expect(lintDoc(plan.doc).problems).toEqual([])
  })
})

describe('step captions', () => {
  it('a re-run replaces only its own, and skips a step a caption already speaks for', () => {
    const doc = takeA()
    const actions = new Map([
      [
        '',
        {
          steps: [
            {
              do: 'click' as const,
              selector: '#open',
              id: 'open',
              caption: 'Open it',
            },
            {
              do: 'click' as const,
              selector: '#save',
              id: 'save',
              caption: 'Save it',
            },
          ],
        },
      ],
    ])
    // A caption a person anchored to `save` by hand.
    doc.overlays!.push(
      text('mine', 7, { preset: 'caption', anchor: { step: 'save' } }),
    )
    const first = landStepCaptions(doc, actions)
    expect(first.landed.map((l) => l.id)).toEqual(['step-open'])
    expect(first.skipped).toEqual([
      'step "save": a caption is already anchored to it',
    ])
    landStepCaptions(doc, actions)
    expect(doc.overlays!.map((o: OverlayClip) => o.id)).toEqual([
      'title',
      'mine',
      'step-open',
    ])
    expect(lintDoc(doc).problems).toEqual([])
  })

  it('a bare --captions on plan asks for them; --captions none keeps its meaning', () => {
    expect(bareCaptionsFlag(['take', '--captions'])).toEqual([
      'take',
      '--captions=steps',
    ])
    expect(bareCaptionsFlag(['take', '--captions', '--json'])).toEqual([
      'take',
      '--captions=steps',
      '--json',
    ])
    expect(bareCaptionsFlag(['take', '--captions', 'none'])).toEqual([
      'take',
      '--captions',
      'none',
    ])
  })
})
