/**
 * Digest page — the fleet's eyes for a take. One bare page decodes the
 * recording through a <video> and does what the CLI's digest page does
 * locally: per-source-second motion bins (64×36 luma diff, changed-pixel
 * fraction), the scene instants those bins reveal, one FOOTAGE frame plus a
 * crop per moment, and a contact sheet. Every image PUTs itself to the ingest
 * route as a `digest-*` part (the page's bytes never marshal through the
 * browser session), then a manifest with the bins and every image's size.
 *
 * Same completion contract as every render page: `__renderComplete` with
 * `{ success, uploaded: true }` or `{ success: false, error }`.
 *
 * The bins must be byte-comparable with the CLI's (`MOTION_DELTA` 24, one
 * seek per source second at i + 0.5, 64×36): they feed the speed planner.
 */

export interface DigestShot {
  /** Part stem; the page writes `<name>.full.png` and, with a box, `<name>.crop.png`. */
  name: string
  /** Source instant, seconds. */
  t: number
  /** Crop box in FRAME px, or null for a full-only moment. */
  box: { x: number; y: number; w: number; h: number } | null
  /** A short label for the contact sheet. */
  label: string
}

export interface DigestPageOptions {
  /** The recording, reachable from the page (a `?rt=` asset URL). */
  videoUrl: string
  /** Source duration, seconds. */
  durationS: number
  /** The region of the frame the doc renders (a window take's crop, or all). */
  region: { x: number; y: number; w: number; h: number }
  shots: DigestShot[]
  /** Long edges (px) of the emitted images. */
  fullMax: number
  cropMax: number
  /** Changed-pixel luma threshold for the bins. */
  motionDelta: number
  /** Scene rule: a bin at/above `motion` after one at/below `quiet`. */
  scene: { motion: number; quiet: number }
  /** `…/api/render/ingest/{jobId}?token=…` — parts append `&part=digest-<name>`. */
  uploadUrl: string
}

export function buildDigestPage(options: DigestPageOptions): string {
  const config = JSON.stringify(options).replace(/</g, '\\u003c')
  return `<!doctype html>
<html>
<head><meta charset="utf-8"><title>vos digest</title><link rel="icon" href="data:,">
<style>html,body{margin:0;background:#000}video{position:absolute;left:-99999px}</style>
</head>
<body>
<script type="module">
const cfg = ${config}
const raf = () => new Promise((r) => requestAnimationFrame(r))
const done = (v) => { window.__renderComplete = v }
try {
  // One page per job: the whole recording comes down once, then every seek
  // is local (a network-backed paused <video> gets suspended within seconds).
  const blob = await (await fetch(cfg.videoUrl)).blob()
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
  const seek = async (t) => {
    const target = Math.max(0, Math.min(t, Math.max(0, (v.duration || t) - 0.02)))
    if (Math.abs(v.currentTime - target) > 0.0005 || v.readyState < 2) {
      await new Promise((res) => {
        const on = () => { v.removeEventListener('seeked', on); res() }
        v.addEventListener('seeked', on)
        v.currentTime = target
      })
    }
    await settle()
  }
  const W = v.videoWidth
  const H = v.videoHeight
  const region = {
    x: Math.max(0, Math.min(cfg.region.x, W)),
    y: Math.max(0, Math.min(cfg.region.y, H)),
    w: Math.max(1, Math.min(cfg.region.w, W - cfg.region.x)),
    h: Math.max(1, Math.min(cfg.region.h, H - cfg.region.y)),
  }

  // Pass 1: motion bins, one per source second.
  const bw = 64, bh = 36
  const bc = document.createElement('canvas')
  bc.width = bw; bc.height = bh
  const bctx = bc.getContext('2d', { willReadFrequently: true })
  let prev = null
  const bins = []
  const n = Math.max(1, Math.ceil(cfg.durationS))
  for (let i = 0; i < n; i++) {
    await seek(Math.min(cfg.durationS, i + 0.5))
    bctx.drawImage(v, 0, 0, bw, bh)
    const d = bctx.getImageData(0, 0, bw, bh).data
    const luma = new Uint8ClampedArray(bw * bh)
    for (let p = 0; p < luma.length; p++) {
      const o = p * 4
      luma[p] = (d[o] * 299 + d[o + 1] * 587 + d[o + 2] * 114) / 1000
    }
    if (!prev) bins.push(0)
    else {
      let changed = 0
      for (let p = 0; p < luma.length; p++) if (Math.abs(luma[p] - prev[p]) > cfg.motionDelta) changed++
      bins.push(Math.round((changed / luma.length) * 1000) / 1000)
    }
    prev = luma
    window.__renderProgress = 0.4 * ((i + 1) / n)
  }
  const scenes = []
  for (let i = 1; i < bins.length; i++) {
    if (bins[i] >= cfg.scene.motion && bins[i - 1] <= cfg.scene.quiet) scenes.push(i)
  }

  // Pass 2: frames, crops, the sheet — each PUT as its own part.
  const sizes = {}
  const toPng = (c) => new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/png'))
  const put = async (name, body, type) => {
    const r = await fetch(cfg.uploadUrl + '&part=digest-' + name, { method: 'PUT', headers: { 'content-type': type }, body })
    if (!r.ok) throw new Error('upload of ' + name + ' failed: ' + r.status)
  }
  const save = async (name, c) => {
    await put(name, await toPng(c), 'image/png')
    sizes[name] = { width: c.width, height: c.height }
  }
  const fit = (w, h, max) => {
    const s = Math.min(1, max / Math.max(w, h))
    return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) }
  }
  const draw = (src, sx, sy, sw, sh, max) => {
    const c = document.createElement('canvas')
    const f = fit(sw, sh, max)
    c.width = f.w; c.height = f.h
    c.getContext('2d').drawImage(src, sx, sy, sw, sh, 0, 0, f.w, f.h)
    return c
  }
  const tiles = []
  const shots = cfg.shots.map((s) => ({ ...s, scene: false }))
  for (const s of scenes) shots.push({ name: 'scene-' + s, t: Math.min(cfg.durationS, s + 0.04), box: null, label: 'scene ' + s + 's', scene: true })
  shots.sort((a, b) => a.t - b.t)
  for (let i = 0; i < shots.length; i++) {
    const s = shots[i]
    await seek(s.t)
    const full = draw(v, region.x, region.y, region.w, region.h, cfg.fullMax)
    await save(s.name + '.full.png', full)
    let tileSrc = full
    if (s.box) {
      const b = s.box
      const crop = draw(v, b.x, b.y, b.w, b.h, cfg.cropMax)
      await save(s.name + '.crop.png', crop)
      tileSrc = crop
    }
    const tw = 240
    const th = Math.max(1, Math.round((tw * tileSrc.height) / tileSrc.width))
    const tile = document.createElement('canvas')
    tile.width = tw; tile.height = th
    tile.getContext('2d').drawImage(tileSrc, 0, 0, tw, th)
    tiles.push({ label: s.label, c: tile })
    window.__renderProgress = 0.4 + 0.55 * ((i + 1) / shots.length)
  }
  if (tiles.length) {
    const cols = Math.min(6, tiles.length)
    const tw = 240
    const th = Math.max(...tiles.map((t) => t.c.height))
    const rows = Math.ceil(tiles.length / cols)
    const sheet = document.createElement('canvas')
    sheet.width = cols * (tw + 8) + 8
    sheet.height = rows * (th + 26) + 8
    const ctx = sheet.getContext('2d')
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
    await save('sheet.png', sheet)
  }
  await put('manifest.json', new Blob([JSON.stringify({ width: W, height: H, bins, scenes, sizes })], { type: 'application/json' }), 'application/json')
  done({ success: true, uploaded: true, bins: bins.length, shots: shots.length })
} catch (e) {
  done({ success: false, error: String((e && e.stack) || e) })
}
</script>
</body>
</html>`
}
