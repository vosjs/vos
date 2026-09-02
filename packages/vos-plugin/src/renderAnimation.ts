/**
 * Generic deterministic render harness — runs compiled vos animation code in
 * headless page(s) and returns encoded video bytes.
 *
 * Chunk-parallel (R1 of the rendering plan): because vos evaluation is a pure
 * function of time, the timeline shards into independent frame ranges. Each
 * chunk renders in its own page with chunk-LOCAL timestamps and byte-identical
 * encoder params; the finalize step stream-copies the chunks into one file
 * (@vosso/render-core concat — no re-encode, keyframe per chunk by
 * construction). parallel=1 renders exactly like the historical single-flight
 * path (one chunk, no concat).
 *
 * Take-flavored details (video token, recording file) are optional so the
 * same harness renders studio takes and plain compositions (films, verify
 * fixtures) alike.
 */
import { readFile, rm } from 'node:fs/promises'
import { tweenRuntimeCode } from '@vosjs/tween/bundle'
import { elementsBundleCode } from '@vosjs/elements/bundle'
import { concatEncodedVideo, planChunks } from '@vosso/render-core'
import { startTakeServer, waitForPageDone } from './server'
import type { RenderChunk } from '@vosso/render-core'
import type { Browser } from 'playwright'

const MEDIABUNNY_URL = 'https://esm.sh/mediabunny@1.27.3?target=es2022'
const THREE_URL = 'https://esm.sh/three@0.183.0?target=es2022'
const THREE_ADDONS = 'https://esm.sh/three@0.183.0&target=es2022/examples/jsm/'

export interface RenderAnimationOptions {
  /** Compiled vos animation code (module exporting initVos). */
  animationCode: string
  /** Directory the page server roots at; chunk artifacts land here too. */
  workDir: string
  /** Source video file name inside workDir (studio takes), served → blob URL. */
  videoFile?: string
  /** Token inside animationCode replaced with the video blob URL. */
  videoToken?: string
  width: number
  height: number
  fps: number
  duration: number
  format: 'webm' | 'mp4'
  /** Max simultaneous chunk pages; 1 = single-flight (no concat). */
  parallel?: number
  /**
   * First GLOBAL frame to render (a range render: seek time starts here while
   * output timestamps stay zero-based). duration then covers the range only.
   */
  frameOffset?: number
  /** Encoder bitrate override (draft renders); default 10 Mbps. */
  bitrate?: number
  /**
   * Mix + mux an audio track in the SAME render (single-flight only — audio
   * stays out of chunks by design, mirroring the cloud single-flight path).
   * `producerCode` defines window.__vosAudioProducer__ (render-core);
   * `data` is the lowered composition data (videoToken replaced in-page).
   * `duration` is the FULL timeline — the producer builds the whole mix and
   * the page slices its own frame window, so a range render keeps audio.
   */
  audio?: { producerCode: string; data: unknown; duration: number }
  onProgress?: (fraction: number) => void
}

export interface RenderAnimationResult {
  bytes: Uint8Array
  totalFrames: number
  /** Number of chunks actually rendered (1 = single-flight). */
  chunks: number
}

export function renderPageHtml(): string {
  const importmap = JSON.stringify({
    imports: { three: THREE_URL, 'three/addons/': THREE_ADDONS },
  })
  return `<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,">
<style>html,body{margin:0;padding:0;background:#000;overflow:hidden}canvas{display:block}</style>
<script type="importmap">${importmap}</script>
</head><body>
<script type="module">
  import * as THREE from 'three'
  ${tweenRuntimeCode}
  // Vos Element System (bundled IIFE) — the same injection the engine's
  // render template performs. Take configs never touch ctx.elements, but a
  // POSTER program (the deliver --poster leg) is element text + an image
  // over the ground, and without this the elements silently never draw.
  ${elementsBundleCode}
  window.__vos__ = window.__vos__ || {}
  window.__vos__.elements = __vosElementsFactory.createVosElements(THREE)
  window.__gsap__ = globalThis.__vosTween.createTweenRecorder()
  window.__THREE__ = THREE
  window.__pageReady__ = true
</script></body></html>`
}

/**
 * Runs inside the render page (serialized by Playwright). Renders frames
 * [startFrame, endFrame) — seeks GLOBAL time, captures CHUNK-LOCAL
 * timestamps — so every chunk is an independent, concat-ready file.
 */
async function renderInPage(opts: {
  animationCode: string
  token?: string
  videoUrl?: string
  W: number
  H: number
  fps: number
  startFrame: number
  endFrame: number
  format: 'webm' | 'mp4'
  bitrate: number
  mediabunnyUrl: string
  outName: string
  debug?: boolean
  audioProducerCode?: string
  audioDataJson?: string
  audioDuration?: number
}) {
  const w = window as unknown as Record<string, any>
  try {
    const MB = await import(/* @vite-ignore */ opts.mediabunnyUrl)
    let code = opts.animationCode
    let vurl: string | null = null
    if (opts.videoUrl && opts.token) {
      // Blob URL: HTMLVideoElement seeking needs HTTP range support the take
      // server doesn't provide — a local blob is fully seekable.
      const vblob = await (await fetch(opts.videoUrl)).blob()
      vurl = URL.createObjectURL(vblob)
      code = code.split(opts.token).join(vurl)
    }

    // Audio first: a producer failure aborts before any frame work.
    let audioBuffer: AudioBuffer | null = null
    if (opts.audioProducerCode && opts.audioDataJson) {
      ;(0, eval)(opts.audioProducerCode)
      const dataJson =
        vurl && opts.token
          ? opts.audioDataJson.split(opts.token).join(vurl)
          : opts.audioDataJson
      audioBuffer = await w.__vosAudioProducer__({
        data: JSON.parse(dataJson),
        duration: opts.audioDuration,
        sampleRate: 48000,
      })
    }
    // The producer mixes the WHOLE timeline; mux only this page's own frame
    // window. On a full render the slice is a no-op cap (the RF D1 overlong
    // guard); on a --range render it is what keeps the clip's audio synced.
    if (audioBuffer) {
      const sr = audioBuffer.sampleRate
      const sliceStart = Math.round((opts.startFrame / opts.fps) * sr)
      const wanted = Math.ceil(
        ((opts.endFrame - opts.startFrame) / opts.fps) * sr,
      )
      if (sliceStart > 0 || audioBuffer.length > wanted) {
        const len = Math.max(
          0,
          Math.min(wanted, audioBuffer.length - sliceStart),
        )
        if (len === 0) {
          audioBuffer = null
        } else {
          const sliced = new AudioBuffer({
            length: len,
            numberOfChannels: audioBuffer.numberOfChannels,
            sampleRate: sr,
          })
          for (let ch = 0; ch < audioBuffer.numberOfChannels; ch++) {
            sliced.copyToChannel(
              audioBuffer
                .getChannelData(ch)
                .subarray(sliceStart, sliceStart + len),
              ch,
            )
          }
          audioBuffer = sliced
        }
      }
    }
    const mod = await import(
      /* @vite-ignore */ URL.createObjectURL(
        new Blob([code], { type: 'text/javascript' }),
      )
    )

    // Deterministic export: compositions must seek (not play) their videos.
    w.__vos__ = w.__vos__ || {}
    w.__vos__.isPaused = true

    const deps = {
      THREE: w.__THREE__,
      gsap: w.__gsap__,
      resolution: {
        width: opts.W,
        height: opts.H,
        pixelRatio: 1,
        drawingBufferWidth: opts.W,
        drawingBufferHeight: opts.H,
      },
      preserveDrawingBuffer: true,
    }
    const result = await mod.initVos(document.body, deps)
    if (result.assetsReady) await result.assetsReady
    const { timeline } = result
    timeline.pause()
    timeline.seek(0, false)

    const canvas = document.querySelector('canvas') as HTMLCanvasElement
    canvas.width = opts.W
    canvas.height = opts.H
    canvas.style.width = opts.W + 'px'
    canvas.style.height = opts.H + 'px'

    // Encoder params are PINNED (codec/bitrate identical for every chunk of
    // a render) — stream-copy concat at finalize depends on it.
    const output = new MB.Output({
      format:
        opts.format === 'mp4'
          ? new MB.Mp4OutputFormat()
          : new MB.WebMOutputFormat(),
      target: new MB.BufferTarget(),
    })
    const videoSource = new MB.CanvasSource(canvas, {
      codec: opts.format === 'mp4' ? 'avc' : 'vp9',
      bitrate: opts.bitrate,
    })
    output.addVideoTrack(videoSource, { frameRate: opts.fps })
    let audioSource: any = null
    if (audioBuffer) {
      // AAC first for mp4 (compatibility), Opus fallback — mirrors finalizePage.
      const preferred = opts.format === 'mp4' ? 'aac' : 'opus'
      const audioCodec =
        preferred === 'aac' && !(await MB.canEncodeAudio('aac'))
          ? 'opus'
          : preferred
      audioSource = new MB.AudioBufferSource({
        codec: audioCodec,
        bitrate: MB.QUALITY_HIGH,
      })
      output.addAudioTrack(audioSource)
    }
    await output.start()
    if (audioSource && audioBuffer) {
      await audioSource.add(audioBuffer)
      audioSource.close()
    }

    const frames = opts.endFrame - opts.startFrame
    const raf = () => new Promise((r) => requestAnimationFrame(r))
    const wvr = () =>
      w.__vos__?.waitForVideosReady ? w.__vos__.waitForVideosReady() : null
    const pending = () => w.__vos__?.pendingDecodes?.size ?? 0

    // html5-path videos seek currentTime ASYNCHRONOUSLY — a cold seek into the
    // middle of the timeline (every chunk start) displays the element's stale
    // initial frame until the seek lands, and the readiness hooks above only
    // cover the webcodecs path. Wait until every video element reports a
    // completed, stable seek before capturing. (The per-frame 33ms steps after
    // warm-up keep up on their own — this guards the COLD seeks.)
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
      // Two consecutive settled reads with stable currentTime — a seek that
      // hasn't dispatched yet can read "settled" for one tick.
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

    for (let frame = opts.startFrame; frame < opts.endFrame; frame++) {
      const time = frame / opts.fps
      timeline.seek(time, false)
      await wvr()
      await raf()
      if (pending() > 0) {
        await wvr()
        await raf()
      }
      if (frame === opts.startFrame) await waitVideosSettled(8000)
      if (opts.debug && frame === opts.startFrame) {
        const png: Blob = await new Promise((res, rej) =>
          canvas.toBlob(
            (b) => (b ? res(b) : rej(new Error('toBlob'))),
            'image/png',
          ),
        )
        await fetch(
          '/save?name=' + opts.outName.replace('.tmp', '-first.png'),
          {
            method: 'POST',
            body: png,
          },
        )
      }
      // Chunk-local timestamp: this chunk's file starts at t=0.
      await videoSource.add((frame - opts.startFrame) / opts.fps, 1 / opts.fps)
      w.__progress = (frame - opts.startFrame) / frames
    }

    await output.finalize()
    const buf = output.target.buffer
    await fetch('/save?name=' + opts.outName, { method: 'POST', body: buf })
    w.__done = { ok: true, bytes: buf.byteLength }
  } catch (e) {
    w.__error = String((e instanceof Error && e.stack) || e)
  }
}

async function renderChunk(
  context: Awaited<ReturnType<Browser['newContext']>>,
  serverBase: string,
  chunk: RenderChunk,
  opts: RenderAnimationOptions,
  onChunkProgress: (fraction: number) => void,
): Promise<string> {
  const outName = `render-chunk-${chunk.index}.tmp`
  const page = await context.newPage()
  try {
    page.on('console', (m) => {
      if (m.type() === 'error' || process.env.VOS_RENDER_DEBUG)
        process.stderr.write(
          `   [render page ${chunk.index} ${m.type()}] ${m.text()}\n`,
        )
    })
    if (process.env.VOS_RENDER_DEBUG)
      page.on('pageerror', (e) =>
        process.stderr.write(
          `   [render pageerror ${chunk.index}] ${String(e)}\n`,
        ),
      )
    await page.addInitScript(() => {
      ;(globalThis as unknown as Record<string, unknown>).__name = (
        f: unknown,
      ) => f
    })
    await page.goto(`${serverBase}/render.html`)
    await page.waitForFunction('window.__pageReady__ === true')
    const frameOffset = opts.frameOffset ?? 0
    const audio = opts.audio
    void page
      .evaluate(renderInPage, {
        animationCode: opts.animationCode,
        token: opts.videoToken,
        videoUrl: opts.videoFile ? `/${opts.videoFile}` : undefined,
        W: opts.width,
        H: opts.height,
        fps: opts.fps,
        startFrame: chunk.startFrame + frameOffset,
        endFrame: chunk.endFrame + frameOffset,
        format: opts.format,
        bitrate: opts.bitrate ?? 10_000_000,
        mediabunnyUrl: MEDIABUNNY_URL,
        outName,
        debug: process.env.VOILA_DEBUG_CHUNKS === '1',
        audioProducerCode: audio?.producerCode,
        audioDataJson: audio ? JSON.stringify(audio.data) : undefined,
        audioDuration: audio?.duration,
      })
      .catch(() => {})
    const timeoutMs = 120_000 + chunk.frameCount * 500
    await waitForPageDone(
      page,
      `render chunk ${chunk.index}`,
      onChunkProgress,
      timeoutMs,
    )
    return outName
  } finally {
    await page.close()
  }
}

export async function renderAnimation(
  browser: Browser,
  opts: RenderAnimationOptions,
): Promise<RenderAnimationResult> {
  const totalFrames = Math.ceil(opts.duration * opts.fps)
  const chunks = planChunks(totalFrames, opts.fps, {
    maxParallel: Math.max(1, opts.parallel ?? 1),
  })

  // Audio stays out of chunks by design: only a single-flight render muxes
  // it (renderTake forces parallel=1 when audio is wanted). A range render
  // keeps audio — the page slices its frame window from the full mix.
  const effOpts: RenderAnimationOptions =
    opts.audio && chunks.length > 1 ? { ...opts, audio: undefined } : opts

  const server = await startTakeServer(opts.workDir, {
    '/render.html': renderPageHtml(),
  })
  // One context for all chunk pages: they share the HTTP cache, so CDN
  // module imports (three, mediabunny) are fetched once, not per chunk.
  const context = await browser.newContext({
    viewport: { width: opts.width, height: opts.height },
  })
  try {
    const progress = new Array<number>(chunks.length).fill(0)
    const reportProgress = () => {
      const done = chunks.reduce(
        (sum, c, i) => sum + c.frameCount * progress[i],
        0,
      )
      opts.onProgress?.(done / totalFrames)
    }

    const outNames = await Promise.all(
      chunks.map((chunk) =>
        renderChunk(context, server.base, chunk, effOpts, (fraction) => {
          progress[chunk.index] = fraction
          reportProgress()
        }),
      ),
    )

    const files = await Promise.all(
      outNames.map((name) => readFile(`${opts.workDir}/${name}`)),
    )
    await Promise.all(
      outNames.map((name) => rm(`${opts.workDir}/${name}`, { force: true })),
    )

    if (chunks.length === 1) {
      return { bytes: new Uint8Array(files[0]), totalFrames, chunks: 1 }
    }

    const { bytes } = await concatEncodedVideo(
      chunks.map((chunk, i) => ({
        data: new Uint8Array(files[i]),
        duration: chunk.duration,
      })),
      { format: opts.format, frameRate: opts.fps },
    )
    return { bytes, totalFrames, chunks: chunks.length }
  } finally {
    await context.close()
    server.close()
  }
}
