/**
 * Frames → CFR WebM, as a PAGE. The VFR screencast JPEGs are drawn
 * hold-last-frame onto a canvas at a fixed 30fps and encoded with
 * mediabunny (WebCodecs) inside a headless page — no ffmpeg dependency.
 * The CLI serves the take directory to it and reads the bytes back through
 * its own `/save`; the fleet serves the frames through the ingest route and
 * the page PUTs the recording to the same route. One page, two hosts: the
 * URLs and the way out are the host's, the encode is not.
 */

const MEDIABUNNY_URL = 'https://esm.sh/mediabunny@1.55.7?target=es2022'

export interface EncodePageOptions {
  /** Where `frames.json` (the index `[{file, tMs}]`) is fetched from. */
  framesIndexUrl: string
  /** Where `meta.json` is fetched from. */
  metaUrl: string
  /** `<framesBaseUrl><file>` is each JPEG. */
  framesBaseUrl: string
  /** The way out: a POST to the CLI's take server, or a PUT to the ingest route. */
  save: { method: 'POST' | 'PUT'; url: string }
  /** Optional `?rt=`-style query the frame fetches must carry (the fleet's token). */
  frameQuery?: string
}

export function buildEncodePage(o: EncodePageOptions): string {
  const q = o.frameQuery ? `?${o.frameQuery}` : ''
  return `<!doctype html><html><head><meta charset="utf-8"></head><body>
<script type="module">
try {
  const MB = await import('${MEDIABUNNY_URL}')
  const frames = await (await fetch(${JSON.stringify(o.framesIndexUrl)})).json()
  const meta = await (await fetch(${JSON.stringify(o.metaUrl)})).json()
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
      const blob = await (await fetch(${JSON.stringify(o.framesBaseUrl)} + frames[fi].file + ${JSON.stringify(q)})).blob()
      const bmp = await createImageBitmap(blob)
      c2.drawImage(bmp, 0, 0, W, H)
      bmp.close()
    }
    await src.add(t, 1 / FPS)
    window.__progress = i / total
  }
  await output.finalize()
  const buf = output.target.buffer
  const res = await fetch(${JSON.stringify(o.save.url)}, { method: ${JSON.stringify(o.save.method)}, headers: { 'content-type': 'video/webm' }, body: buf })
  if (!res.ok) throw new Error('save failed: ' + res.status)
  // Two hosts, two completion words: the CLI's take server polls __done,
  // the fleet's page runner polls __renderComplete.
  window.__done = { ok: true, bytes: buf.byteLength }
  window.__renderComplete = { success: true, size: buf.byteLength, uploaded: true }
} catch (e) {
  window.__error = String(e && e.stack || e)
  window.__renderComplete = { success: false, error: String(e && e.message || e) }
}
</script></body></html>`
}
