/**
 * The take digest — the agent's eyes. Slices the FOOTAGE
 * (never the composed render) at the moments the cursor telemetry says
 * matter: one full frame + a crop around the target rect per moment, per-
 * second motion bins, the scene changes those bins reveal, the planners'
 * proposals beside each moment, all in the doc's own normalized units.
 *
 * Two page passes on one bare page over the take server: (1) motion bins by
 * seeking every source second and diffing a 64×36 luma thumbnail — cheap,
 * and the second witness for "nothing happened here"; (2) the moment frames.
 * CLI takes reuse their screencast JPEGs (nearest tMs) instead of decoding.
 * Everything the agent reads lands in `digest/` beside the take; `vos push`
 * never uploads it.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  DIGEST_CROP_MAX,
  DIGEST_FULL_MAX,
  DIGEST_VERSION,
  MOTION_DELTA,
  buildDigest,
  cropBox,
  frameGeometry,
  momentsFromDoc,
  outputDurationOf,
  planForDigest,
  sceneChanges,
} from '@vosjs/studio-core'
import { RECORDING_NAME, loadTake, readJson } from './take'
import { startTakeServer, waitForPageDone } from './server'
import type {
  Digest,
  DigestImageRef,
  Moment,
  ProjectDoc,
  PxRect,
  TranscriptSegment,
} from '@vosjs/studio-core'
import type { Browser } from 'playwright'

export const DIGEST_DIR = 'digest'
// Geometry, thresholds and the document shape are studio-core's (shared
// with the fleet's digest job): one crop geometry, one builder.
export {
  DIGEST_CROP_MAX,
  DIGEST_FULL_MAX,
  DIGEST_VERSION,
} from '@vosjs/studio-core'

export interface DigestOptions {
  outDir?: string
  full?: number
  crop?: number
  /** Skip the browser passes (moments only; activity null). */
  frames?: boolean
  transcript?: readonly TranscriptSegment[] | null
  /** A reference doc whose style fields are REPORTED (never applied here). */
  style?: { from: string; doc: ProjectDoc } | null
}

export type { Digest } from '@vosjs/studio-core'

export interface DigestResult {
  file: string
  outDir: string
  digest: Digest
  bytes: number
}

interface FrameSource {
  kind: 'video' | 'frames'
  url?: string
  frames?: { t: number; url: string }[]
}

/** Pass 1 (in page): frame size + per-second motion bins. */
async function binsInPage(opts: {
  source: FrameSource
  durationS: number
  delta: number
}) {
  const w = window as unknown as Record<string, any>
  try {
    const getFrame = await (window as any).__digestSource(opts.source)
    // The INTRINSIC size (videoWidth / naturalWidth), stamped on the source
    // by the page — a <video> element's own .width is its CSS box (0 here).
    const size = { width: getFrame.width, height: getFrame.height }
    await getFrame(0)
    const cw = 64
    const ch = 36
    const c = document.createElement('canvas')
    c.width = cw
    c.height = ch
    const ctx = c.getContext('2d', { willReadFrequently: true })!
    let prev: Uint8ClampedArray | null = null
    const bins: number[] = []
    const n = Math.max(1, Math.ceil(opts.durationS))
    for (let i = 0; i < n; i++) {
      const el = await getFrame(Math.min(opts.durationS, i + 0.5))
      ctx.drawImage(el, 0, 0, cw, ch)
      const d = ctx.getImageData(0, 0, cw, ch).data
      const luma = new Uint8ClampedArray(cw * ch)
      for (let p = 0; p < luma.length; p++) {
        const o = p * 4
        luma[p] = (d[o] * 299 + d[o + 1] * 587 + d[o + 2] * 114) / 1000
      }
      if (!prev) bins.push(0)
      else {
        let changed = 0
        for (let p = 0; p < luma.length; p++)
          if (Math.abs(luma[p] - prev[p]) > opts.delta) changed++
        bins.push(Math.round((changed / luma.length) * 1000) / 1000)
      }
      prev = luma
      w.__progress = (i + 1) / n
    }
    w.__done = { ok: true, bins, width: size.width, height: size.height }
  } catch (e) {
    w.__error = String((e instanceof Error && e.stack) || e)
  }
}

/** Pass 2 (in page): the moment frames, crops and the contact sheet. */
async function framesInPage(opts: {
  source: FrameSource
  shots: {
    id: string
    label: string
    t: number
    full: string
    crop: string | null
    region: { x: number; y: number; w: number; h: number }
    box: { x: number; y: number; w: number; h: number } | null
  }[]
  fullMax: number
  cropMax: number
  sheet: string
}) {
  const w = window as unknown as Record<string, any>
  try {
    const getFrame = await (window as any).__digestSource(opts.source)
    const sizes: Record<string, { width: number; height: number }> = {}
    const toPng = (c: HTMLCanvasElement) =>
      new Promise<Blob>((res, rej) =>
        c.toBlob(
          (b) => (b ? res(b) : rej(new Error('toBlob failed'))),
          'image/png',
        ),
      )
    const save = async (name: string, c: HTMLCanvasElement) => {
      await fetch('/save?name=' + name, {
        method: 'POST',
        body: await toPng(c),
      })
      sizes[name] = { width: c.width, height: c.height }
    }
    const fit = (bw: number, bh: number, max: number) => {
      const s = Math.min(1, max / Math.max(bw, bh))
      return {
        w: Math.max(1, Math.round(bw * s)),
        h: Math.max(1, Math.round(bh * s)),
      }
    }
    const tiles: { label: string; c: HTMLCanvasElement }[] = []
    for (let i = 0; i < opts.shots.length; i++) {
      const s = opts.shots[i]
      const el = await getFrame(s.t)
      const full = document.createElement('canvas')
      const f = fit(s.region.w, s.region.h, opts.fullMax)
      full.width = f.w
      full.height = f.h
      full
        .getContext('2d')!
        .drawImage(
          el,
          s.region.x,
          s.region.y,
          s.region.w,
          s.region.h,
          0,
          0,
          f.w,
          f.h,
        )
      await save(s.full, full)
      let tileSrc = full
      if (s.crop && s.box) {
        const crop = document.createElement('canvas')
        const k = fit(s.box.w, s.box.h, opts.cropMax)
        crop.width = k.w
        crop.height = k.h
        crop
          .getContext('2d')!
          .drawImage(el, s.box.x, s.box.y, s.box.w, s.box.h, 0, 0, k.w, k.h)
        await save(s.crop, crop)
        tileSrc = crop
      }
      const tile = document.createElement('canvas')
      const tw = 240
      const th = Math.max(1, Math.round((tw * tileSrc.height) / tileSrc.width))
      tile.width = tw
      tile.height = th
      tile.getContext('2d')!.drawImage(tileSrc, 0, 0, tw, th)
      tiles.push({ label: s.label, c: tile })
      w.__progress = (i + 1) / opts.shots.length
    }
    // The contact sheet: crops (or fulls) in time order, ids burned in.
    if (tiles.length) {
      const cols = Math.min(6, tiles.length)
      const tw = 240
      const th = Math.max(...tiles.map((t) => t.c.height))
      const rows = Math.ceil(tiles.length / cols)
      const sheet = document.createElement('canvas')
      sheet.width = cols * (tw + 8) + 8
      sheet.height = rows * (th + 26) + 8
      const ctx = sheet.getContext('2d')!
      ctx.fillStyle = '#111'
      ctx.fillRect(0, 0, sheet.width, sheet.height)
      ctx.font = '12px ui-monospace, Menlo, monospace'
      tiles.forEach((t, i) => {
        const x = 8 + (i % cols) * (tw + 8)
        const y = 8 + Math.floor(i / cols) * (th + 26)
        ctx.drawImage(t.c, x, y)
        ctx.fillStyle = '#eee'
        ctx.fillText(t.label, x, y + th + 16)
      })
      await save(opts.sheet, sheet)
    }
    w.__done = { ok: true, sizes }
  } catch (e) {
    w.__error = String((e instanceof Error && e.stack) || e)
  }
}

/** The bare page: a frame source over a <video> (seek + settle) or JPEGs. */
export function digestPageHtml(): string {
  return `<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,">
<style>html,body{margin:0;background:#000}video,img{position:absolute;left:-99999px}</style>
</head><body><script>
window.__digestSource = async (source) => {
  const raf = () => new Promise((r) => requestAnimationFrame(r))
  if (source.kind === 'video') {
    const blob = await (await fetch(source.url)).blob()
    const v = document.createElement('video')
    v.muted = true
    v.preload = 'auto'
    v.src = URL.createObjectURL(blob)
    document.body.appendChild(v)
    await new Promise((res, rej) => {
      v.addEventListener('loadeddata', () => res(), { once: true })
      v.addEventListener('error', () => rej(new Error('video failed to load')), { once: true })
    })
    const settle = async () => {
      const t0 = performance.now()
      let last = ''
      while (performance.now() - t0 < 4000) {
        await raf()
        if (!v.seeking && v.readyState >= 2) {
          const now = v.currentTime.toFixed(3)
          if (now === last) return
          last = now
        } else last = ''
      }
    }
    const getFrame = async (t) => {
      const target = Math.max(0, Math.min(t, Math.max(0, (v.duration || t) - 0.02)))
      if (Math.abs(v.currentTime - target) > 0.0005 || v.readyState < 2) {
        await new Promise((res) => {
          const on = () => { v.removeEventListener('seeked', on); res() }
          v.addEventListener('seeked', on)
          v.currentTime = target
        })
      }
      await settle()
      return v
    }
    const first = await getFrame(0)
    getFrame.width = first.videoWidth
    return Object.assign(getFrame, { width: v.videoWidth, height: v.videoHeight })
  }
  const frames = source.frames
  const img = new Image()
  document.body.appendChild(img)
  const load = (url) => new Promise((res, rej) => {
    if (img.src.endsWith(url) && img.complete) return res(img)
    img.onload = () => res(img)
    img.onerror = () => rej(new Error('frame failed to load: ' + url))
    img.src = url
  })
  const getFrame = async (t) => {
    let best = frames[0]
    for (const f of frames) if (Math.abs(f.t - t) < Math.abs(best.t - t)) best = f
    await load(best.url)
    return img
  }
  const first = await getFrame(0)
  return Object.assign(getFrame, { width: first.naturalWidth, height: first.naturalHeight })
}
window.__pageReady__ = true
</script></body></html>`
}

export async function digestTake(
  browser: Browser | null,
  dir: string,
  opts: DigestOptions = {},
): Promise<DigestResult> {
  const take = await loadTake(dir)
  if (!take.doc) throw new Error(`${dir} has no doc.json — run plan first`)
  const doc = take.doc
  const meta = doc.source.meta
  // Re-planned once the bins exist: the speed planner tells playback from
  // idle only with the activity witness.
  let plan = planForDigest(doc)
  // A transcript.json beside the take (Whisper's shape) is picked up
  // unasked; --transcript names another file.
  const transcript = opts.transcript ?? (await discoverTranscript(dir))
  const outDir = resolve(opts.outDir ?? join(dir, DIGEST_DIR))
  await mkdir(outDir, { recursive: true })
  const fullMax = opts.full ?? DIGEST_FULL_MAX
  const cropMax = opts.crop ?? DIGEST_CROP_MAX
  const wantFrames = opts.frames !== false && browser !== null
  const durS = meta.durationMs / 1000

  let bins: number[] | null = null
  let frameW: number | null = null
  let frameH: number | null = null
  let sizes: Partial<Record<string, { width: number; height: number }>> = {}
  let sheet: string | null = null
  let moments: Moment[]
  const boxes = new Map<string, PxRect>()

  // The frame source: screencast JPEGs when the take has them, else the video.
  let source: FrameSource = { kind: 'video', url: `/${RECORDING_NAME}` }
  if (existsSync(take.paths.framesIndex) && existsSync(take.paths.framesDir)) {
    const index = await readJson<{ file: string; tMs: number }[]>(
      take.paths.framesIndex,
    )
    if (Array.isArray(index) && index.length) {
      source = {
        kind: 'frames',
        frames: index.map((f) => ({
          t: f.tMs / 1000,
          url: `/frames/${f.file}`,
        })),
      }
    }
  }

  if (wantFrames) {
    if (source.kind === 'video' && !existsSync(take.paths.recording))
      throw new Error(
        `${dir} has no ${RECORDING_NAME} — pull it with \`vos pull --media\` first`,
      )
    const server = await startTakeServer(dir, {
      '/digest.html': digestPageHtml(),
    })
    const context = await browser.newContext({
      viewport: { width: 640, height: 360 },
    })
    try {
      const page = await context.newPage()
      page.on('console', (m) => {
        if (m.type() === 'error')
          process.stderr.write(`   [digest page] ${m.text()}\n`)
      })
      await page.addInitScript(() => {
        ;(globalThis as unknown as Record<string, unknown>).__name = (
          f: unknown,
        ) => f
      })
      await page.goto(`${server.base}/digest.html`)
      await page.waitForFunction('window.__pageReady__ === true')

      // Pass 1: bins.
      void page
        .evaluate(binsInPage, { source, durationS: durS, delta: MOTION_DELTA })
        .catch(() => {})
      const b = await waitForPageDone(
        page,
        'digest bins',
        () => {},
        60_000 + durS * 400,
      )
      bins = b.bins as number[]
      plan = planForDigest(doc, bins)
      frameW = b.width as number
      frameH = b.height as number

      moments = momentsFromDoc(doc, plan, {
        bins,
        scenes: sceneChanges(bins),
        transcript,
      })

      // Pass 2: frames.
      const geo = frameGeometry(doc, frameW, frameH)
      const shots = moments
        .filter((m) => m.at !== null)
        .map((m) => {
          const box = cropBox(m, geo, meta)
          if (box) boxes.set(m.id, box)
          return {
            id: m.id,
            label: `${m.id} ${m.kind} ${m.source.in.toFixed(1)}s`,
            t: m.at!,
            full: `${m.id}.full.png`,
            crop: box ? `${m.id}.crop.png` : null,
            region: geo.region,
            box,
          }
        })
      await page.evaluate('window.__done = null; window.__progress = null')
      void page
        .evaluate(framesInPage, {
          source,
          shots,
          fullMax,
          cropMax,
          sheet: 'sheet.png',
        })
        .catch(() => {})
      const f = await waitForPageDone(
        page,
        'digest frames',
        () => {},
        60_000 + shots.length * 4_000,
      )
      sizes = f.sizes as Record<string, { width: number; height: number }>
      for (const name of Object.keys(sizes)) {
        const from = join(dir, name)
        const to = join(outDir, name)
        if (from !== to && existsSync(from)) await rename(from, to)
      }
      if (sizes['sheet.png']) sheet = 'sheet.png'
    } finally {
      await context.close()
      server.close()
    }
  } else {
    // --no-frames after a real pass (the skill re-digests after retiming to
    // read fresh OUTPUT times): the prior digest's bins, scenes and images
    // are measurements of the FOOTAGE, which retiming does not change —
    // carry them forward instead of dropping them.
    const prior = await readPriorDigest(outDir)
    bins = prior?.activity ?? null
    if (bins) plan = planForDigest(doc, bins)
    frameW = prior?.take.frameWidth ?? null
    frameH = prior?.take.frameHeight ?? null
    moments = momentsFromDoc(doc, plan, {
      bins,
      scenes: bins ? sceneChanges(bins) : [],
      transcript,
    })
    if (prior) {
      for (const m of moments) {
        const p = prior.moments.find(
          (x) =>
            x.id === m.id && x.kind === m.kind && x.source.in === m.source.in,
        )
        if (!p) continue
        for (const f of [p.full, p.crop]) {
          if (!f) continue
          const size = await pngSize(join(outDir, f))
          if (size) sizes[f] = size
        }
        if (p.box) boxes.set(m.id, p.box)
      }
      if (prior.images.sheet && existsSync(join(outDir, prior.images.sheet)))
        sheet = prior.images.sheet
    }
  }

  const images = new Map<string, DigestImageRef>()
  for (const m of moments) {
    const full = sizes[`${m.id}.full.png`] ? `${m.id}.full.png` : null
    const crop = sizes[`${m.id}.crop.png`] ? `${m.id}.crop.png` : null
    if (!full && !crop) continue
    images.set(m.id, {
      full,
      crop,
      box: crop ? (boxes.get(m.id) ?? null) : null,
      fullSize: full ? (sizes[full] ?? null) : null,
      cropSize: crop ? (sizes[crop] ?? null) : null,
    })
  }
  const digest = buildDigest({
    doc,
    plan,
    moments,
    outputDuration: outputDurationOf(doc),
    bins,
    frame:
      frameW !== null && frameH !== null
        ? { width: frameW, height: frameH }
        : null,
    images,
    sheet,
    style: opts.style ?? null,
    transcript,
  })
  const file = join(outDir, 'digest.json')
  const body = JSON.stringify(digest, null, 2)
  await writeFile(file, body)
  return { file, outDir, digest, bytes: Buffer.byteLength(body) }
}

/** `<take>/transcript.json` when present and well-formed; never throws. */
async function discoverTranscript(
  dir: string,
): Promise<TranscriptSegment[] | null> {
  const file = join(dir, 'transcript.json')
  if (!existsSync(file)) return null
  try {
    return parseTranscript(JSON.parse(await readFile(file, 'utf8')))
  } catch {
    return null
  }
}

/** The digest already in outDir, when it parses; never throws. */
async function readPriorDigest(outDir: string): Promise<Digest | null> {
  try {
    const raw = JSON.parse(
      await readFile(join(outDir, 'digest.json'), 'utf8'),
    ) as Digest
    return raw.digestVersion === DIGEST_VERSION && Array.isArray(raw.moments)
      ? raw
      : null
  } catch {
    return null
  }
}

/** Width/height from a PNG header (IHDR), or null when the file is not one. */
async function pngSize(
  file: string,
): Promise<{ width: number; height: number } | null> {
  try {
    const buf = await readFile(file)
    if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
  } catch {
    return null
  }
}

/** Accept Whisper's `{segments:[…]}` or a bare `[{start,end,text}]`. */
export function parseTranscript(raw: unknown): TranscriptSegment[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as any).segments)
      ? (raw as any).segments
      : null
  if (!list)
    throw new Error('transcript must be [{start,end,text}] or {segments:[…]}')
  return (list as Record<string, unknown>[])
    .filter(
      (s) =>
        typeof s.start === 'number' &&
        typeof s.end === 'number' &&
        typeof s.text === 'string',
    )
    .map((s) => ({
      start: s.start as number,
      end: s.end as number,
      text: s.text as string,
    }))
}
