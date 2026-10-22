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
  /** A flat colour, or a busy picture (stripes, rings, text) under a hue. */
  kind: 'solid' | 'busy'
  /** A busy scene's picture moves this many pixels a second (a pan). */
  pan?: number
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
