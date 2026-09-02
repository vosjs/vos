/**
 * Frames → CFR WebM. The VFR screencast JPEGs are drawn hold-last-frame onto a
 * canvas at a fixed 30fps and encoded with mediabunny (WebCodecs) inside a
 * headless page — no ffmpeg dependency.
 */
import { startTakeServer, waitForPageDone } from './server'
import { RECORDING_NAME } from './take'
import type { Browser } from 'playwright'

const MEDIABUNNY_URL = 'https://esm.sh/mediabunny@1.27.3?target=es2022'

const ENCODE_HTML = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<script type="module">
try {
  const MB = await import('${MEDIABUNNY_URL}')
  const frames = await (await fetch('/frames.json')).json()
  const meta = await (await fetch('/meta.json')).json()
  const W = meta.captureWidth ?? meta.width, H = meta.captureHeight ?? meta.height
  const FPS = 30
  const durSec = meta.durationMs / 1000
  const cv = document.createElement('canvas')
  cv.width = W; cv.height = H
  const c2 = cv.getContext('2d')
  const output = new MB.Output({ format: new MB.WebMOutputFormat(), target: new MB.BufferTarget() })
  const src = new MB.CanvasSource(cv, { codec: 'vp9', bitrate: 8_000_000 })
  output.addVideoTrack(src, { frameRate: FPS })
  await output.start()
  let fi = -1
  const total = Math.ceil(durSec * FPS)
  for (let i = 0; i < total; i++) {
    const t = i / FPS
    let next = fi
    while (next + 1 < frames.length && frames[next + 1].tMs <= t * 1000) next++
    if (next < 0) next = 0
    if (next !== fi) {
      fi = next
      const blob = await (await fetch('/frames/' + frames[fi].file)).blob()
      const bmp = await createImageBitmap(blob)
      c2.drawImage(bmp, 0, 0, W, H)
      bmp.close()
    }
    await src.add(t, 1 / FPS)
    window.__progress = i / total
  }
  await output.finalize()
  const buf = output.target.buffer
  await fetch('/save?name=${RECORDING_NAME}', { method: 'POST', body: buf })
  window.__done = { ok: true, bytes: buf.byteLength }
} catch (e) { window.__error = String(e && e.stack || e) }
</script></body></html>`

export async function encodeRecording(
  browser: Browser,
  takeDir: string,
  onProgress: (fraction: number) => void,
): Promise<{ bytes: number }> {
  const server = await startTakeServer(takeDir, { '/encode.html': ENCODE_HTML })
  const page = await browser.newPage()
  try {
    await page.goto(`${server.base}/encode.html`)
    const done = await waitForPageDone(page, 'encode', onProgress, 600_000)
    return { bytes: Number(done.bytes ?? 0) }
  } finally {
    await page.close()
    server.close()
  }
}
