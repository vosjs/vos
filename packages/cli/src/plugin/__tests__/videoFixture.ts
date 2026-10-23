/**
 * Tiny video files made for a test, in the browser with the mediabunny this
 * package installs (VP9 + Opus in WebM, the codecs every Chromium encodes),
 * so the fixtures are generated rather than checked in. A file is a list of
 * scenes, each drawn for its stretch, and an optional sine tone.
 */
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { startTakeServer } from '../server'
import type { Browser } from 'playwright'

export interface FixtureScene {
  /** Output seconds the scene starts at. */
  at: number
  /**
   * A flat colour; a busy picture (stripes, rings, text) under a hue; a
   * page (a light ground with a few boxes and lines, like an app); or a
   * sparse one (small light boxes on a dark ground, like a canvas seen
   * whole); or a canvas app on a card over a dark ground, light and
   * mostly empty, holding a `board` (outlined boxes, thin arrows, notes,
   * a small form) and a dark `block` over part of it when asked.
   */
  kind: 'solid' | 'busy' | 'page' | 'sparse' | 'canvas'
  /** A canvas scene draws its board. */
  board?: boolean
  /** A canvas scene draws a dark block over its board (an embed appearing). */
  block?: boolean
  /** A busy scene's picture moves this many pixels a second (a pan). */
  pan?: number
  /** The picture drawn this much larger, about the frame's centre. */
  scale?: number
  /** A zoom from `scale` to `to` over `over` seconds from the scene's start, eased in and out. */
  zoom?: { to: number; over: number }
  color: string
}

export interface FixtureSpec {
  width: number
  height: number
  fps: number
  seconds: number
  scenes: FixtureScene[]
  /** A sine on both channels, amplitude 0..1; 0 is digital silence. Absent: no audio track. */
  tone?: { amplitude: number; hz?: number }
}

let bundle: string | null = null
async function mediabunnyCode(): Promise<string> {
  if (bundle) return bundle
  const entry = createRequire(import.meta.url).resolve('mediabunny')
  bundle = await readFile(join(dirname(entry), 'mediabunny.min.mjs'), 'utf8')
  return bundle
}

async function encodeInPage(opts: { mbCode: string; spec: FixtureSpec }) {
  const load = new Function('u', 'return import(u)') as (
    u: string,
  ) => Promise<any>
  const MB = await load(
    URL.createObjectURL(new Blob([opts.mbCode], { type: 'text/javascript' })),
  )
  const { spec } = opts
  const output = new MB.Output({
    format: new MB.WebMOutputFormat(),
    target: new MB.BufferTarget(),
  })
  const canvas = document.createElement('canvas')
  canvas.width = spec.width
  canvas.height = spec.height
  const g = canvas.getContext('2d')!
  const video = new MB.CanvasSource(canvas, {
    codec: 'vp9',
    bitrate: 2_000_000,
  })
  output.addVideoTrack(video, { frameRate: spec.fps })
  const audio = spec.tone
    ? new MB.AudioBufferSource({ codec: 'opus', bitrate: 96_000 })
    : null
  if (audio) output.addAudioTrack(audio)
  await output.start()
  const frames = Math.round(spec.seconds * spec.fps)
  for (let i = 0; i < frames; i++) {
    const t = i / spec.fps
    let scene = spec.scenes[0]
    for (const s of spec.scenes) if (s.at <= t + 1e-9) scene = s
    g.fillStyle = scene.color
    g.fillRect(0, 0, spec.width, spec.height)
    const from = scene.scale ?? 1
    let k = from
    if (scene.zoom) {
      const u = Math.min(1, Math.max(0, (t - scene.at) / scene.zoom.over))
      k = from + (scene.zoom.to - from) * (u * u * (3 - 2 * u))
    }
    g.save()
    g.translate(spec.width / 2, spec.height / 2)
    g.scale(k, k)
    g.translate(-spec.width / 2, -spec.height / 2)
    if (scene.kind === 'page') {
      g.fillStyle = '#20242c'
      g.fillRect(0, 0, spec.width * 0.18, spec.height)
      g.strokeStyle = '#222'
      g.lineWidth = 2
      for (let j = 0; j < 4; j++)
        g.strokeRect(
          spec.width * (0.24 + j * 0.19),
          spec.height * 0.25,
          spec.width * 0.15,
          spec.height * 0.14,
        )
      g.fillStyle = '#f3c77a'
      for (let j = 0; j < 3; j++)
        g.fillRect(
          spec.width * (0.26 + j * 0.2),
          spec.height * 0.55,
          spec.width * 0.16,
          spec.height * 0.22,
        )
      g.fillStyle = '#333'
      g.font = `${Math.round(spec.height / 18)}px sans-serif`
      g.fillText(
        'Sign up  Verify  Pick a plan',
        spec.width * 0.25,
        spec.height * 0.17,
      )
    }
    if (scene.kind === 'canvas') {
      const W = spec.width
      const H = spec.height
      const X = (f: number) => Math.round(W * f) + 0.5
      const Y = (f: number) => Math.round(H * f) + 0.5
      g.fillStyle = '#f8f9fa'
      g.fillRect(W * 0.1, H * 0.05, W * 0.8, H * 0.8)
      if (scene.board) {
        g.fillStyle = '#ffffff'
        g.fillRect(W * 0.22, H * 0.17, W * 0.5, H * 0.54)
        g.strokeStyle = '#d0d4da'
        g.lineWidth = 1
        g.strokeRect(X(0.22), Y(0.17), W * 0.5, H * 0.54)
        g.strokeStyle = '#1d1d1d'
        g.fillStyle = '#1d1d1d'
        g.font = `${Math.max(6, Math.round(H / 40))}px sans-serif`
        for (let j = 0; j < 4; j++) {
          const x = 0.24 + j * 0.12
          g.strokeRect(X(x), Y(0.28), W * 0.095, H * 0.09)
          g.fillText('Step', W * (x + 0.03), H * 0.335)
          if (j < 3) {
            g.beginPath()
            g.moveTo(X(x + 0.095), Y(0.325))
            g.lineTo(X(x + 0.12), Y(0.325))
            g.stroke()
          }
        }
        g.strokeStyle = '#d8453a'
        g.beginPath()
        g.ellipse(W * 0.53, H * 0.325, W * 0.065, H * 0.07, 0, 0, Math.PI * 2)
        g.stroke()
        g.fillStyle = '#fcd59b'
        for (let j = 0; j < 3; j++)
          g.fillRect(W * (0.39 + j * 0.088), H * 0.41, W * 0.08, H * 0.15)
        g.fillStyle = '#f1f1f3'
        g.fillRect(W * 0.23, H * 0.47, W * 0.15, H * 0.22)
        g.fillStyle = '#1d1d1d'
        g.fillRect(W * 0.25, H * 0.63, W * 0.11, H * 0.025)
        g.fillStyle = '#3c3c44'
        g.fillRect(W * 0.57, H * 0.56, W * 0.14, H * 0.14)
      }
      if (scene.block) {
        g.fillStyle = '#050505'
        g.fillRect(W * 0.39, H * 0.4, W * 0.33, H * 0.3)
      }
    }
    if (scene.kind === 'sparse') {
      g.strokeStyle = 'rgba(200,210,120,0.8)'
      g.lineWidth = 1
      for (let y = spec.height * 0.15; y < spec.height * 0.85; y += 9)
        for (let x = spec.width * 0.15; x < spec.width * 0.85; x += 14)
          g.strokeRect(x, y, 8, 4)
    }
    g.restore()
    if (scene.kind === 'busy') {
      const dx = ((scene.pan ?? 0) * (t - scene.at)) % 64
      g.save()
      g.translate(-dx, 0)
      // Detail everywhere, so any change of scale or place moves edges.
      g.fillStyle = 'rgba(0,0,0,0.55)'
      for (let x = 0; x < spec.width + 64; x += 16)
        g.fillRect(x, 0, 6, spec.height)
      g.fillStyle = 'rgba(255,255,255,0.6)'
      for (let y = 0; y < spec.height; y += 22)
        g.fillRect(0, y, spec.width + 64, 5)
      g.strokeStyle = '#111'
      g.lineWidth = 3
      for (let r = 10; r < spec.width; r += 28) {
        g.beginPath()
        g.arc(spec.width * 0.4, spec.height * 0.45, r, 0, Math.PI * 2)
        g.stroke()
      }
      g.fillStyle = '#fff'
      g.font = `bold ${Math.round(spec.height / 6)}px sans-serif`
      g.fillText('vos 123', spec.width * 0.08, spec.height * 0.3)
      g.restore()
    }
    await video.add(t, 1 / spec.fps)
  }
  if (audio && spec.tone) {
    const rate = 48_000
    const length = Math.round(spec.seconds * rate)
    const buf = new AudioBuffer({
      length,
      sampleRate: rate,
      numberOfChannels: 2,
    })
    const hz = spec.tone.hz ?? 997
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c)
      for (let i = 0; i < length; i++)
        d[i] = spec.tone.amplitude * Math.sin((2 * Math.PI * hz * i) / rate)
    }
    await audio.add(buf)
    audio.close()
  }
  video.close()
  await output.finalize()
  const bytes = new Uint8Array(output.target.buffer as ArrayBuffer)
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

/** Encode `spec` to WebM bytes in a page of `browser`. */
export async function makeFixtureVideo(
  browser: Browser,
  spec: FixtureSpec,
): Promise<Buffer> {
  // A page on loopback: WebCodecs needs a secure context, which a bare
  // about:blank is not guaranteed to be.
  const server = await startTakeServer(tmpdir(), {
    '/fixture.html': '<!doctype html><html><body></body></html>',
  })
  const page = await browser.newPage()
  try {
    await page.addInitScript(() => {
      ;(globalThis as unknown as Record<string, unknown>).__name = (
        f: unknown,
      ) => f
    })
    await page.goto(`${server.base}/fixture.html`)
    const b64 = await page.evaluate(encodeInPage, {
      mbCode: await mediabunnyCode(),
      spec,
    })
    return Buffer.from(b64, 'base64')
  } finally {
    await page.close()
    server.close()
  }
}
