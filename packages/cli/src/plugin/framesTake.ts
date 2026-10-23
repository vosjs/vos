/**
 * Stills from a take — the agent's eyes on a cut. Lowers + compiles exactly like
 * render, then seeks each requested time in ONE page and captures the canvas
 * as PNG at the exact output resolution. No encoder, no chunks.
 *
 * Times are OUTPUT seconds (what the rendered video shows). `--at-zooms`
 * samples the apex (output-time midpoint) of every zoom span — where quality
 * lives — on every media of the take, and renders each apex a second time
 * with the zooms off: a zoom whose frame matches its zoom-off twin did not
 * render, and the still alone would never say so.
 */
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { compileVosConfig } from '@vosjs/core'
import {
  docStillTime,
  lowerToComposition,
  momentsFromDoc,
  planForDigest,
  ratedSegments,
  resolveExportSize,
  cameraSpanExtents,
  spanOutputExtents,
} from '@vosjs/studio-core'
import { loadTake } from './take'
import { startTakeServer, waitForPageDone } from './server'
import { renderPageHtml } from './renderAnimation'
import {
  applyAndValidate,
  applyDocOverrides,
  hasOverrides,
  resolveBackdropSlug,
} from './docOverride'
import { DIGEST_DIR } from './digestTake'
import type { DocOverrides } from './docOverride'
import type { Moment, ProjectDoc } from '@vosjs/studio-core'
import type { Browser, BrowserContext } from 'playwright'

const VIDEO_TOKEN = '__VOS_CLI_VIDEO__'

/**
 * The supersample factor a still renders at: a small --size (a 440
 * px frame, a 240 px one) renders at two or three times its
 * pixels and downscales once with the high-quality resampler,
 * so footage recorded at 1920 px is not one bilinear tap away from a
 * 270 px card. A still already past 1800 px on its long side renders 1:1.
 */
export function stillSupersample(w: number, h: number): number {
  return Math.min(3, Math.max(1, Math.ceil(1800 / Math.max(1, w, h))))
}

export interface FramesTakeOptions {
  /** OUTPUT-time seconds; each may also be given as a percent of duration upstream. */
  times: number[]
  /** Also sample every zoom span's output-time apex. */
  atZooms?: boolean
  /**
   * Also sample every digest moment that survives into the output (reads
   * digest/digest.json when present, else derives the moments — no frames).
   */
  atMoments?: boolean
  /** Also sample the frame that stands for the take (docStillTime). */
  atStill?: boolean
  width?: number
  height?: number
  outDir?: string
  /** In-memory doc overrides (--set / --frame / --background); lint-gated. */
  overrides?: DocOverrides
  /**
   * Render THIS document over the take's footage instead of its doc.json
   * (a variant built in memory). Cloned before any override.
   */
  doc?: ProjectDoc
}

export interface CapturedFrame {
  file: string
  time: number
  /** 'time' = requested instant, 'zoom' = a zoom-span apex, 'moment' = a digest moment. */
  kind: 'time' | 'zoom' | 'moment' | 'still'
  momentId?: string
  /** A zoom apex: the span it stills. */
  zoomId?: string
  /** A zoom apex on another media of the take: that media's id. */
  media?: string
  /**
   * A zoom apex: whether the zoom shows in the frame, judged against the
   * same output time rendered with the zooms off.
   */
  rendered?: boolean
  /** Mean absolute difference from the zoom-off twin (0..1 of full range). */
  difference?: number
  /** The zoom-off twin's still, written only when the zoom did not render. */
  twin?: string
}

/** A zoom span with no apex to still, and why. */
export interface SkippedZoom {
  id: string
  media?: string
  /** The span's SOURCE extent, seconds of its media. */
  in: number
  out: number
  reason: string
}

export interface FramesTakeResult {
  frames: CapturedFrame[]
  width: number
  height: number
  duration: number
  outDir: string
  /** Zoom spans `atZooms` could not still (outside the cut, an unknown media). */
  skippedZooms?: SkippedZoom[]
}

/** A zoom span's apex: the midpoint of its OUTPUT window. */
export interface ZoomApex {
  id: string
  media?: string
  time: number
  start: number
  end: number
}

/**
 * Every zoom span's apex, on every media of the take: each span's source
 * extent mapped through the rated segments onto the output, the mapping the
 * lowering builds the camera track from. A span of another media is read
 * in that media's seconds; a span the cut keeps nothing of is skipped and
 * said, never stilled at a time it does not play.
 */
export function zoomApexes(doc: ProjectDoc): {
  apexes: ZoomApex[]
  skipped: SkippedZoom[]
} {
  const rated = ratedSegments(doc)
  const media = new Set((doc.media ?? []).map((m) => m.id))
  const apexes: ZoomApex[] = []
  const skipped: SkippedZoom[] = []
  for (const z of doc.zoom) {
    const of = z.media ? { media: z.media } : {}
    if (z.media && !media.has(z.media)) {
      skipped.push({
        id: z.id,
        ...of,
        in: z.in,
        out: z.out,
        reason: `names media "${z.media}", which the take does not carry`,
      })
      continue
    }
    const exts = cameraSpanExtents(rated, z.in, z.out, z.media)
    if (!exts.length) {
      skipped.push({
        id: z.id,
        ...of,
        in: z.in,
        out: z.out,
        reason: spanOutputExtents(rated, z.in, z.out, z.media).length
          ? 'every pass of it plays in a segment whose camera rests'
          : 'the cut keeps none of it, so it never plays',
      })
      continue
    }
    // A cut that replays the span's seconds plays its zoom each time the
    // camera plays them: one apex per occurrence, none in a resting pass.
    for (const ext of exts)
      apexes.push({
        id: z.id,
        ...of,
        time: (ext.start + ext.end) / 2,
        start: ext.start,
        end: ext.end,
      })
  }
  return { apexes, skipped }
}

/**
 * Below this mean absolute difference (0..1 of full range, over a small
 * grayscale of the frame) a zoomed apex is the zoom-off frame: the zoom did
 * not render. Two renders of the same frame agree to well under a level in
 * 255; a zoom of the smallest level the planner proposes moves every edge
 * of the picture and lands far above it.
 */
export const ZOOM_UNRENDERED_BELOW = 0.004

/** The long side of the grayscale a frame is compared at, in pixels. */
const SIGNATURE_LONG_SIDE = 96

/** Mean absolute difference of two equal-length grayscale signatures, 0..1. */
export function signatureDifference(
  a: ArrayLike<number>,
  b: ArrayLike<number>,
): number {
  if (a.length !== b.length || a.length === 0) return 1
  let sum = 0
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i])
  return sum / a.length / 255
}

/** The warning a zoom that did not render prints. */
export function unrenderedZoomLine(f: CapturedFrame): string {
  return `zoom ${f.zoomId ?? '?'} at ${f.time.toFixed(2)}s did not render (its frame matches the zoom-off frame${f.twin ? `: ${f.twin}` : ''})`
}

/** Runs inside the render page: seek each time, settle, capture PNG, POST it. */
async function stillsInPage(opts: {
  animationCode: string
  token: string
  videoUrl: string
  W: number
  H: number
  /** Render at W*ss × H*ss, downscale to W × H for the PNG. */
  ss: number
  shots: { time: number; name: string }[]
  /** Shots whose small grayscale is handed back, for a comparison. */
  sigNames: string[]
  sigW: number
  sigH: number
}) {
  const w = window as unknown as Record<string, any>
  const RW = opts.W * opts.ss
  const RH = opts.H * opts.ss
  try {
    const vblob = await (await fetch(opts.videoUrl)).blob()
    const vurl = URL.createObjectURL(vblob)
    const code = opts.animationCode.split(opts.token).join(vurl)
    // An import spelled as text: a transform that rewrites `import()` in
    // this function (a test runner's) would break it in the page.
    const load = new Function('u', 'return import(u)') as (
      u: string,
    ) => Promise<any>
    const mod = await load(
      URL.createObjectURL(new Blob([code], { type: 'text/javascript' })),
    )

    w.__vos__ = w.__vos__ || {}
    w.__vos__.isPaused = true

    const deps = {
      THREE: w.__THREE__,
      gsap: w.__gsap__,
      resolution: {
        width: RW,
        height: RH,
        pixelRatio: 1,
        drawingBufferWidth: RW,
        drawingBufferHeight: RH,
      },
      preserveDrawingBuffer: true,
    }
    const result = await mod.initVos(document.body, deps)
    if (result.assetsReady) await result.assetsReady
    const { timeline } = result
    timeline.pause()
    timeline.seek(0, false)

    const canvas = document.querySelector('canvas') as HTMLCanvasElement
    canvas.width = RW
    canvas.height = RH
    canvas.style.width = RW + 'px'
    canvas.style.height = RH + 'px'
    // The downscale target, when supersampled.
    const out = document.createElement('canvas')
    out.width = opts.W
    out.height = opts.H

    const raf = () => new Promise((r) => requestAnimationFrame(r))
    const wvr = () =>
      w.__vos__?.waitForVideosReady ? w.__vos__.waitForVideosReady() : null
    const pending = () => w.__vos__?.pendingDecodes?.size ?? 0
    const toPng = () =>
      new Promise<Blob>((res, rej) => {
        let src = canvas
        if (opts.ss > 1) {
          const g = out.getContext('2d')!
          g.imageSmoothingEnabled = true
          g.imageSmoothingQuality = 'high'
          g.clearRect(0, 0, opts.W, opts.H)
          g.drawImage(canvas, 0, 0, opts.W, opts.H)
          src = out
        }
        src.toBlob(
          (b) => (b ? res(b) : rej(new Error('toBlob failed'))),
          'image/png',
        )
      })

    // Every still is a COLD seek — html5-path videos update currentTime
    // asynchronously, so wait for a completed, stable seek before capturing
    // (mirrors renderInPage's chunk-start guard; see renderAnimation.ts).
    const collectVideos = (): HTMLVideoElement[] => {
      const out = new Set<HTMLVideoElement>()
      const cache = w.__vos__?.videoCache
      if (cache) {
        const vals =
          cache instanceof Map ? [...cache.values()] : Object.values(cache)
        for (const v of vals) {
          if (v?.tagName === 'VIDEO') out.add(v)
          else if (v?.el?.tagName === 'VIDEO') out.add(v.el)
          else if (v?.video?.tagName === 'VIDEO') out.add(v.video)
        }
      }
      document.querySelectorAll('video').forEach((v) => out.add(v))
      return [...out]
    }
    const videosSettled = () =>
      collectVideos().every((v) => !v.seeking && v.readyState >= 2)
    const waitVideosSettled = async (maxMs: number) => {
      const t0 = performance.now()
      let stableTimes = ''
      while (performance.now() - t0 < maxMs) {
        await raf()
        if (videosSettled()) {
          const times = collectVideos()
            .map((v) => v.currentTime.toFixed(3))
            .join(',')
          if (times === stableTimes) return
          stableTimes = times
        } else {
          stableTimes = ''
        }
      }
    }

    // The frame as a small grayscale, for a comparison in node.
    const sigCanvas = document.createElement('canvas')
    sigCanvas.width = opts.sigW
    sigCanvas.height = opts.sigH
    const signature = (): number[] => {
      const g = sigCanvas.getContext('2d', { willReadFrequently: true })!
      g.imageSmoothingEnabled = true
      g.imageSmoothingQuality = 'high'
      g.clearRect(0, 0, opts.sigW, opts.sigH)
      g.drawImage(canvas, 0, 0, opts.sigW, opts.sigH)
      const px = g.getImageData(0, 0, opts.sigW, opts.sigH).data
      const out: number[] = new Array(opts.sigW * opts.sigH)
      for (let p = 0, q = 0; p < px.length; p += 4, q++)
        out[q] = Math.round(
          0.299 * px[p] + 0.587 * px[p + 1] + 0.114 * px[p + 2],
        )
      return out
    }
    const sigWanted = new Set(opts.sigNames)
    const sigs: Record<string, number[]> = {}

    for (let i = 0; i < opts.shots.length; i++) {
      const shot = opts.shots[i]
      timeline.seek(shot.time, false)
      await wvr()
      await raf()
      if (pending() > 0) {
        await wvr()
        await raf()
      }
      await waitVideosSettled(8000)
      const png = await toPng()
      if (sigWanted.has(shot.name)) sigs[shot.name] = signature()
      await fetch('/save?name=' + shot.name, { method: 'POST', body: png })
      w.__progress = (i + 1) / opts.shots.length
    }
    w.__done = { ok: true, count: opts.shots.length, sigs }
  } catch (e) {
    w.__error = String((e instanceof Error && e.stack) || e)
  }
}

/** Seek and capture `shots` in one fresh page; the signatures asked for come back. */
async function captureShots(
  context: BrowserContext,
  base: string,
  opts: {
    animationCode: string
    videoUrl: string
    width: number
    height: number
    ss: number
    shots: { time: number; name: string }[]
    sigNames: string[]
  },
): Promise<Record<string, number[]>> {
  const long = Math.max(opts.width, opts.height)
  const side = (n: number) =>
    Math.max(1, Math.round((n / long) * SIGNATURE_LONG_SIDE))
  const page = await context.newPage()
  try {
    page.on('console', (m) => {
      if (m.type() === 'error')
        process.stderr.write(`   [stills page] ${m.text()}\n`)
    })
    await page.addInitScript(() => {
      ;(globalThis as unknown as Record<string, unknown>).__name = (
        f: unknown,
      ) => f
    })
    await page.goto(`${base}/render.html`)
    await page.waitForFunction('window.__pageReady__ === true')
    void page
      .evaluate(stillsInPage, {
        animationCode: opts.animationCode,
        token: VIDEO_TOKEN,
        videoUrl: opts.videoUrl,
        W: opts.width,
        H: opts.height,
        ss: opts.ss,
        shots: opts.shots,
        sigNames: opts.sigNames,
        sigW: side(opts.width),
        sigH: side(opts.height),
      })
      .catch(() => {})
    const done = await waitForPageDone(
      page,
      'stills',
      () => {},
      120_000 + opts.shots.length * 4_000,
    )
    return (done.sigs as Record<string, number[]> | undefined) ?? {}
  } finally {
    await page.close()
  }
}

export async function framesTake(
  browser: Browser,
  dir: string,
  opts: FramesTakeOptions,
): Promise<FramesTakeResult> {
  const take = await loadTake(dir)
  const doc = opts.doc ? structuredClone(opts.doc) : take.doc
  if (!doc) throw new Error(`${dir} has no doc.json — run plan first`)

  // Product-surface overrides (--set/--frame/--background): patch + lint the doc
  // in memory (doc.json untouched) so a still can preview any presentation.
  if (opts.overrides && hasOverrides(opts.overrides)) {
    await resolveBackdropSlug(opts.overrides)
    applyAndValidate(doc, opts.overrides)
  }

  const res = resolveExportSize(doc)
  const width = opts.width ?? res.width
  const height = opts.height ?? res.height

  doc.source.videoKey = VIDEO_TOKEN
  const lowered = lowerToComposition(doc)
  const animationCode = compileVosConfig(lowered.config as never, {
    tweenEngine: 'vos',
  })
  const duration = lowered.duration

  const clamp = (t: number) =>
    Math.min(Math.max(0, t), Math.max(0, duration - 1 / 30))
  const shots: {
    time: number
    kind: 'time' | 'zoom' | 'moment' | 'still'
    momentId?: string
    zoomId?: string
    media?: string
  }[] = opts.times.map((t) => ({
    time: clamp(t),
    kind: 'time',
  }))
  let skippedZooms: SkippedZoom[] | undefined
  if (opts.atZooms) {
    const { apexes, skipped } = zoomApexes(doc)
    for (const a of apexes)
      shots.push({
        time: clamp(a.time),
        kind: 'zoom',
        zoomId: a.id,
        ...(a.media ? { media: a.media } : {}),
      })
    skippedZooms = skipped
  }
  if (opts.atMoments) {
    for (const m of await momentsFor(dir, doc)) {
      if (m.outputAt === null) continue
      shots.push({ time: clamp(m.outputAt), kind: 'moment', momentId: m.id })
    }
  }
  if (opts.atStill)
    shots.push({ time: clamp(docStillTime(doc)), kind: 'still' })
  shots.sort((a, b) => a.time - b.time)
  if (!shots.length && !skippedZooms?.length)
    throw new Error(
      'no frame times — pass --times/--frame, --at-zooms, --at-moments or --at-still',
    )

  const outDir = resolve(opts.outDir ?? join(dir, 'stills'))
  await mkdir(outDir, { recursive: true })
  const stamp = (i: number, t: number) =>
    `${String(i).padStart(2, '0')}-${t.toFixed(2)}s.png`
  const named = shots.map((s, i) => ({
    ...s,
    name:
      s.kind === 'moment'
        ? `moment-${s.momentId}-${s.time.toFixed(2)}s.png`
        : `${s.kind === 'zoom' ? 'zoom' : 'frame'}-${stamp(i, s.time)}`,
    twinName: s.kind === 'zoom' ? `zoomoff-${stamp(i, s.time)}` : undefined,
  }))
  const zoomShots = named.filter((n) => n.kind === 'zoom')

  const server = await startTakeServer(dir, {
    '/render.html': renderPageHtml(),
  })
  const ss = stillSupersample(width, height)
  const context = await browser.newContext({
    viewport: { width: width * ss, height: height * ss },
  })
  const videoUrl = `/${take.paths.recordingName}`
  try {
    const sigs = named.length
      ? await captureShots(context, server.base, {
          animationCode,
          videoUrl,
          width,
          height,
          ss,
          shots: named.map(({ time, name }) => ({ time, name })),
          sigNames: zoomShots.map((n) => n.name),
        })
      : {}

    // The zoom-off twin of every apex: the same document with no zoom
    // spans (what `--set zoom=[]` makes), at the same times.
    let twinSigs: Record<string, number[]> = {}
    if (zoomShots.length) {
      const twinDoc = structuredClone(doc)
      applyDocOverrides(twinDoc, { set: ['zoom=[]'] })
      const twinLowered = lowerToComposition(twinDoc)
      twinSigs = await captureShots(context, server.base, {
        animationCode: compileVosConfig(twinLowered.config as never, {
          tweenEngine: 'vos',
        }),
        videoUrl,
        width,
        height,
        ss,
        shots: zoomShots.map((n) => ({ time: n.time, name: n.twinName! })),
        sigNames: zoomShots.map((n) => n.twinName!),
      })
    }

    // The take server saves into its root (the take dir) — move into outDir.
    const frames: CapturedFrame[] = []
    for (const n of named) {
      const from = join(dir, n.name)
      const to = join(outDir, n.name)
      if (from !== to) await rename(from, to)
      const frame: CapturedFrame = {
        file: to,
        time: n.time,
        kind: n.kind,
        ...(n.momentId ? { momentId: n.momentId } : {}),
        ...(n.zoomId ? { zoomId: n.zoomId } : {}),
        ...(n.media ? { media: n.media } : {}),
      }
      if (n.twinName) {
        const a = sigs[n.name]
        const b = twinSigs[n.twinName]
        const twinFrom = join(dir, n.twinName)
        if (a && b) {
          const difference = signatureDifference(a, b)
          frame.rendered = difference >= ZOOM_UNRENDERED_BELOW
          frame.difference = Math.round(difference * 1e5) / 1e5
          // The twin is kept only beside a zoom that did not render: it is
          // the evidence, and every other one would only crowd the folder.
          if (!frame.rendered) {
            const twinTo = join(outDir, n.twinName)
            if (twinFrom !== twinTo) await rename(twinFrom, twinTo)
            frame.twin = twinTo
          }
        }
        if (!frame.twin) await rm(twinFrom, { force: true })
      }
      frames.push(frame)
    }
    return {
      frames,
      width,
      height,
      duration,
      outDir,
      ...(skippedZooms ? { skippedZooms } : {}),
    }
  } finally {
    await context.close()
    server.close()
  }
}

/**
 * The moments to frame: the digest on disk when there is one (its scenes and
 * activity came from a real decode), else derived from the track alone.
 */
async function momentsFor(dir: string, doc: ProjectDoc): Promise<Moment[]> {
  const file = join(dir, DIGEST_DIR, 'digest.json')
  if (existsSync(file)) {
    try {
      const d = JSON.parse(await readFile(file, 'utf8')) as {
        moments?: Moment[]
      }
      if (Array.isArray(d.moments)) return d.moments
    } catch {
      // fall through to a fresh derivation
    }
  }
  return momentsFromDoc(doc, planForDigest(doc))
}

/** Parse a --times list: seconds ("2.5") and percents of duration ("50%"). */
export function parseTimes(spec: string, duration: number): number[] {
  return spec
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      if (s.endsWith('%')) {
        const p = Number(s.slice(0, -1))
        if (!Number.isFinite(p)) throw new Error(`bad time "${s}"`)
        return (p / 100) * duration
      }
      const t = Number(s)
      if (!Number.isFinite(t)) throw new Error(`bad time "${s}"`)
      return t
    })
}

/** Contact-sheet composite via PNGs written by framesTake (no deps; caller may skip). */
export async function writeIndexJson(
  result: FramesTakeResult,
): Promise<string> {
  const index = join(result.outDir, 'stills.json')
  await writeFile(
    index,
    JSON.stringify(
      {
        width: result.width,
        height: result.height,
        duration: result.duration,
        frames: result.frames,
        ...(result.skippedZooms?.length
          ? { skippedZooms: result.skippedZooms }
          : {}),
      },
      null,
      2,
    ),
  )
  return index
}
