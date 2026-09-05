/**
 * Stills from a take — the agent's eyes AND a first-class asset output
 * (posters, OG cards, store screenshots). Lowers + compiles exactly like
 * render, then seeks each requested time in ONE page and captures the canvas
 * as PNG at the exact output resolution. No encoder, no chunks.
 *
 * Times are OUTPUT seconds (what the rendered video shows). `--at-zooms`
 * samples the apex (output-time midpoint) of every zoom span — where quality
 * lives.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { compileVosConfig } from '@vosjs/core'
import {
  lowerToComposition,
  momentsFromDoc,
  planForDigest,
  ratedSegments,
  resolveExportSize,
  spanOutputExtent,
} from '@vosjs/studio-core'
import { RECORDING_NAME, loadTake } from './take'
import { startTakeServer, waitForPageDone } from './server'
import { renderPageHtml } from './renderAnimation'
import {
  applyAndValidate,
  hasOverrides,
  resolveBackdropSlug,
} from './docOverride'
import { DIGEST_DIR } from './digestTake'
import type { DocOverrides } from './docOverride'
import type { Moment, ProjectDoc } from '@vosjs/studio-core'
import type { Browser } from 'playwright'

const VIDEO_TOKEN = '__VOILA_CLI_VIDEO__'

/**
 * The supersample factor a still renders at: small destinations (a 440
 * px store tile, a 240 px thumbnail) render at two or three times their
 * pixels and downscale once with the browser's high-quality resampler,
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
  width?: number
  height?: number
  outDir?: string
  /** In-memory doc overrides (--set / --frame / --background); lint-gated. */
  overrides?: DocOverrides
}

export interface CapturedFrame {
  file: string
  time: number
  /** 'time' = requested instant, 'zoom' = a zoom-span apex, 'moment' = a digest moment. */
  kind: 'time' | 'zoom' | 'moment'
  momentId?: string
}

export interface FramesTakeResult {
  frames: CapturedFrame[]
  width: number
  height: number
  duration: number
  outDir: string
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
}) {
  const w = window as unknown as Record<string, any>
  const RW = opts.W * opts.ss
  const RH = opts.H * opts.ss
  try {
    const vblob = await (await fetch(opts.videoUrl)).blob()
    const vurl = URL.createObjectURL(vblob)
    const code = opts.animationCode.split(opts.token).join(vurl)
    const mod = await import(
      /* @vite-ignore */ URL.createObjectURL(
        new Blob([code], { type: 'text/javascript' }),
      )
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
      await fetch('/save?name=' + shot.name, { method: 'POST', body: png })
      w.__progress = (i + 1) / opts.shots.length
    }
    w.__done = { ok: true, count: opts.shots.length }
  } catch (e) {
    w.__error = String((e instanceof Error && e.stack) || e)
  }
}

export async function framesTake(
  browser: Browser,
  dir: string,
  opts: FramesTakeOptions,
): Promise<FramesTakeResult> {
  const take = await loadTake(dir)
  if (!take.doc) throw new Error(`${dir} has no doc.json — run plan first`)
  const doc = take.doc

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
    kind: 'time' | 'zoom' | 'moment'
    momentId?: string
  }[] = opts.times.map((t) => ({
    time: clamp(t),
    kind: 'time',
  }))
  if (opts.atZooms) {
    const rated = ratedSegments(doc)
    for (const z of doc.zoom) {
      const ext = spanOutputExtent(rated, z.in, z.out)
      if (ext)
        shots.push({ time: clamp((ext.start + ext.end) / 2), kind: 'zoom' })
    }
  }
  if (opts.atMoments) {
    for (const m of await momentsFor(dir, take.doc)) {
      if (m.outputAt === null) continue
      shots.push({ time: clamp(m.outputAt), kind: 'moment', momentId: m.id })
    }
  }
  shots.sort((a, b) => a.time - b.time)
  if (!shots.length)
    throw new Error(
      'no frame times — pass --times/--frame, --at-zooms or --at-moments',
    )

  const outDir = resolve(opts.outDir ?? join(dir, 'stills'))
  await mkdir(outDir, { recursive: true })
  const named = shots.map((s, i) => ({
    ...s,
    name:
      s.kind === 'moment'
        ? `moment-${s.momentId}-${s.time.toFixed(2)}s.png`
        : `${s.kind === 'zoom' ? 'zoom' : 'frame'}-${String(i).padStart(2, '0')}-${s.time.toFixed(2)}s.png`,
  }))

  const server = await startTakeServer(dir, {
    '/render.html': renderPageHtml(),
  })
  const ss = stillSupersample(width, height)
  const context = await browser.newContext({
    viewport: { width: width * ss, height: height * ss },
  })
  try {
    const page = await context.newPage()
    page.on('console', (m) => {
      if (m.type() === 'error')
        process.stderr.write(`   [stills page] ${m.text()}\n`)
    })
    await page.addInitScript(() => {
      ;(globalThis as unknown as Record<string, unknown>).__name = (
        f: unknown,
      ) => f
    })
    await page.goto(`${server.base}/render.html`)
    await page.waitForFunction('window.__pageReady__ === true')
    void page
      .evaluate(stillsInPage, {
        animationCode,
        token: VIDEO_TOKEN,
        videoUrl: `/${RECORDING_NAME}`,
        W: width,
        H: height,
        ss,
        shots: named.map(({ time, name }) => ({ time, name })),
      })
      .catch(() => {})
    await waitForPageDone(
      page,
      'stills',
      () => {},
      120_000 + named.length * 4_000,
    )

    // The take server saves into its root (the take dir) — move into outDir.
    const frames: CapturedFrame[] = []
    for (const n of named) {
      const from = join(dir, n.name)
      const to = join(outDir, n.name)
      if (from !== to) await rename(from, to)
      frames.push({
        file: to,
        time: n.time,
        kind: n.kind,
        ...(n.momentId ? { momentId: n.momentId } : {}),
      })
    }
    return { frames, width, height, duration, outDir }
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
      },
      null,
      2,
    ),
  )
  return index
}
