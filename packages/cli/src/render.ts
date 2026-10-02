import { compileVosConfig, programSize } from '@vosjs/core'
import { generateRenderTemplate } from '@vosjs/core/runtime'
import { elementsBundleCode } from '@vosjs/elements/bundle'
import { tweenRuntimeCode } from '@vosjs/tween/bundle'
import type { Browser, Page } from 'playwright'
import { ASSET_ROUTE, serveFile } from './programAssets'
import type { ProgramAssets } from './programAssets'

/** Fake secure origin the render page is served from (WebCodecs needs one). */
const RENDER_ORIGIN = 'https://vos-cli.render'

export interface RenderCommonOptions {
  config: Record<string, unknown>
  width: number
  height: number
  /** Phase callback for progress reporting. */
  onPhase?: (phase: string) => void
  /**
   * The program's declared files made reachable for this page
   * (`programAssets`): handed to the engine as `ctx.assets`, with the local
   * ones served from disk on the page's own origin.
   */
  assets?: ProgramAssets | null
}

export interface RenderVideoOptions extends RenderCommonOptions {
  fps: number
  /** Output duration in seconds. */
  duration: number
  format: 'webm' | 'mp4'
  /** The page's audio producer (a program document's sound); absent = silent. */
  audioProducerCode?: string
}

export interface RenderStillOptions extends RenderCommonOptions {
  /** Seek time for the captured frame, seconds. */
  time: number
}

export interface RenderResult {
  bytes: Uint8Array
  mimeType: string
  /** Uncaught exceptions the page threw while it rendered (it may still have
   * written a frame, so a caller says them instead of hiding them). */
  pageErrors: string[]
  /** The engine's own '[vos] …' warnings: causes a picture cannot show. */
  engineNotes: string[]
}

interface RenderComplete {
  success: boolean
  data?: string
  error?: string
}

/** What a captured still shows, measured from its pixels. */
export interface StillPicture {
  /** Every pixel has alpha 0: the frame is empty, whatever the preview showed. */
  transparent: boolean
  /** Every pixel is the same colour. */
  flat: boolean
}

/**
 * The sentences a still earns before anyone looks at it (pure). A fully
 * transparent frame is the one a custom blend or a cleared alpha leaves, and
 * it reads as black in most viewers while the live preview draws over its
 * page: say so, because nothing else will.
 */
export function stillWarnings(
  picture: StillPicture,
  pageErrors: readonly string[],
  engineNotes: readonly string[] = [],
): string[] {
  const out: string[] = []
  if (picture.transparent) {
    out.push(
      'the still is fully transparent (every pixel has alpha 0), though the preview may draw it: something wrote alpha 0, most often a custom material blending (blendDst / blendEquation) or a scene with no background. Give the scene a background or keep the destination alpha in the blend.',
    )
  } else if (picture.flat) {
    out.push(
      'the still is a single flat colour: nothing drew at this time, or everything is hidden; check the time and the program for errors.',
    )
  }
  // The engine's own notes ('[vos] …') name a cause the picture cannot.
  for (const n of new Set(engineNotes)) out.push(n.replace(/^\[vos\]\s*/, ''))
  for (const e of pageErrors.slice(0, 3)) out.push(`the page threw: ${e}`)
  if (pageErrors.length > 3)
    out.push(`the page threw ${pageErrors.length - 3} more errors`)
  return out
}

function compile(
  config: Record<string, unknown>,
  /** Bake these URLs as the program's `ctx.assets` defaults (a preview). */
  assets?: ProgramAssets | null,
): string {
  if (!assets) return compileVosConfig(config as never, { tweenEngine: 'vos' })
  // The compiler asks per ref; the resolved table is per name, so walk the
  // manifest in the same order to answer.
  const byRef = new Map<string, string>()
  const manifest = (config.assets ?? {}) as Record<
    string,
    { ref: string | string[] }
  >
  for (const [name, decl] of Object.entries(manifest)) {
    const got = assets.assets[name]
    const refs = Array.isArray(decl.ref) ? decl.ref : [decl.ref]
    const urls = Array.isArray(got) ? got : [got]
    refs.forEach((ref, i) => {
      if (typeof urls[i] === 'string') byRef.set(`${name}\u0000${ref}`, urls[i])
    })
  }
  return compileVosConfig(config as never, {
    tweenEngine: 'vos',
    resolveAssetRef: (ref, name) => byRef.get(`${name}\u0000${ref}`) ?? ref,
  })
}

/** A page on the render origin reads a served file by its full URL. */
function captureAssets(assets: ProgramAssets | null | undefined): {
  assets?: Record<string, string | string[]>
} {
  if (!assets) return {}
  const absolute = (url: string) =>
    url.startsWith(ASSET_ROUTE) ? `${RENDER_ORIGIN}${url}` : url
  const out: Record<string, string | string[]> = {}
  for (const [name, url] of Object.entries(assets.assets)) {
    out[name] = Array.isArray(url) ? url.map(absolute) : absolute(url)
  }
  return { assets: out }
}

async function runCapturePage(
  browser: Browser,
  html: string,
  opts: {
    width: number
    height: number
    timeoutMs: number
    /** Served path → file on disk (a program's declared files). */
    files?: Record<string, string>
  },
): Promise<RenderComplete & { pageErrors: string[]; engineNotes: string[] }> {
  const context = await browser.newContext({
    viewport: { width: opts.width, height: opts.height },
  })
  const page: Page = await context.newPage()
  const errors: string[] = []
  const pageErrors: string[] = []
  const engineNotes: string[] = []
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
    else if (m.type() === 'warning' && m.text().startsWith('[vos] '))
      engineNotes.push(m.text())
  })
  page.on('pageerror', (e) => {
    pageErrors.push(String(e.message || e))
  })
  try {
    await page.route(`${RENDER_ORIGIN}/**`, (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: html }),
    )
    // The program's own files, on the page's origin. Registered after the
    // page route on purpose: the newest matching route answers first.
    const files = opts.files ?? {}
    if (Object.keys(files).length > 0) {
      await page.route(`${RENDER_ORIGIN}${ASSET_ROUTE}**`, async (route) => {
        const request = route.request()
        const file = files[new URL(request.url()).pathname]
        if (!file) {
          return route.fulfill({ status: 404, body: 'no such declared file' })
        }
        const answer = serveFile(file, await request.headerValue('range'))
        return route.fulfill(answer)
      })
    }
    await page.goto(`${RENDER_ORIGIN}/render`, {
      waitUntil: 'domcontentloaded',
    })
    const start = Date.now()
    for (;;) {
      const done = (await page.evaluate(
        'window.__renderComplete ?? null',
      )) as RenderComplete | null
      if (done) return { ...done, pageErrors, engineNotes }
      if (Date.now() - start > opts.timeoutMs) {
        const all = [...pageErrors, ...errors]
        return {
          success: false,
          error: `render timed out after ${Math.round(opts.timeoutMs / 1000)}s${
            all.length ? ` (page errors: ${all.slice(0, 3).join(' | ')})` : ''
          }`,
          pageErrors,
          engineNotes,
        }
      }
      await new Promise((r) => setTimeout(r, 400))
    }
  } finally {
    await context.close()
  }
}

function decodeDataUrl(
  dataUrl: string,
  pageErrors: string[] = [],
  engineNotes: string[] = [],
): RenderResult {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl)
  if (!m) throw new Error('capture page returned an unexpected payload')
  return {
    bytes: Uint8Array.from(Buffer.from(m[2], 'base64')),
    mimeType: m[1],
    pageErrors,
    engineNotes,
  }
}

/** Render a vos config to a video (WebM/MP4) in a headless browser. */
export async function renderVideo(
  browser: Browser,
  opts: RenderVideoOptions,
): Promise<RenderResult> {
  opts.onPhase?.('compile')
  const code = compile(opts.config)
  const html = generateRenderTemplate(code, {
    mode: 'capture-video',
    capture: {
      width: opts.width,
      height: opts.height,
      duration: opts.duration,
      fps: opts.fps,
      format: opts.format,
      ...(opts.audioProducerCode
        ? { audioProducerCode: opts.audioProducerCode }
        : {}),
      ...captureAssets(opts.assets),
    },
    elementsBundleCode,
    tweenEngine: 'vos',
    tweenBundleCode: tweenRuntimeCode,
  })
  opts.onPhase?.('render')
  // Generous ceiling: startup + CDN module fetch + ~4× realtime per frame batch.
  const timeoutMs = 90_000 + opts.duration * opts.fps * 400
  const done = await runCapturePage(browser, html, {
    width: opts.width,
    height: opts.height,
    timeoutMs,
    files: opts.assets?.files,
  })
  if (!done.success || !done.data)
    throw new Error(done.error ?? 'render failed')
  return decodeDataUrl(done.data, done.pageErrors, done.engineNotes)
}

/** Render a single frame of a vos config to an image in a headless browser. */
export async function renderStill(
  browser: Browser,
  opts: RenderStillOptions,
): Promise<RenderResult> {
  opts.onPhase?.('compile')
  const code = compile(opts.config)
  const html = generateRenderTemplate(code, {
    mode: 'capture-thumbnail',
    capture: {
      width: opts.width,
      height: opts.height,
      duration: Math.max(1, opts.time + 1),
      fps: 30,
      thumbnailTime: opts.time,
      ...captureAssets(opts.assets),
    },
    elementsBundleCode,
    tweenEngine: 'vos',
    tweenBundleCode: tweenRuntimeCode,
  })
  opts.onPhase?.('render')
  const done = await runCapturePage(browser, html, {
    width: opts.width,
    height: opts.height,
    timeoutMs: 120_000,
    files: opts.assets?.files,
  })
  if (!done.success || !done.data)
    throw new Error(done.error ?? 'still render failed')
  return decodeDataUrl(done.data, done.pageErrors, done.engineNotes)
}

/**
 * Measure a captured still's pixels in a browser page (the canvas is the
 * decoder): whether every pixel is transparent, and whether it is one flat
 * colour. Sampled on a grid, so a large still stays cheap.
 */
export async function inspectStill(
  browser: Browser,
  webp: Uint8Array,
): Promise<StillPicture> {
  const page = await browser.newPage()
  try {
    const src = `data:image/webp;base64,${Buffer.from(webp).toString('base64')}`
    return (await page.evaluate(
      `(async () => {
        const img = new Image()
        img.src = ${JSON.stringify(src)}
        await img.decode()
        const w = img.naturalWidth, h = img.naturalHeight
        const c = document.createElement('canvas')
        c.width = w
        c.height = h
        const g = c.getContext('2d', { willReadFrequently: true })
        g.drawImage(img, 0, 0)
        const d = g.getImageData(0, 0, w, h).data
        const step = Math.max(1, Math.floor(Math.sqrt((w * h) / 40000)))
        let transparent = true, flat = true, first = null
        for (let y = 0; y < h; y += step) {
          for (let x = 0; x < w; x += step) {
            const i = (y * w + x) * 4
            if (d[i + 3] !== 0) transparent = false
            const px = d[i] + ',' + d[i + 1] + ',' + d[i + 2] + ',' + d[i + 3]
            if (first === null) first = px
            else if (px !== first) flat = false
          }
        }
        return { transparent, flat }
      })()`,
    )) as StillPicture
  } finally {
    await page.close()
  }
}

/**
 * Re-encode a captured WebP still as PNG or JPEG in a browser page, so a
 * still named `.png` holds PNG bytes. The canvas is the encoder; nothing
 * else is installed for it.
 */
export async function reencodeStill(
  browser: Browser,
  webp: Uint8Array,
  format: 'png' | 'jpeg',
): Promise<Uint8Array> {
  const page = await browser.newPage()
  try {
    const src = `data:image/webp;base64,${Buffer.from(webp).toString('base64')}`
    // A string body: a serialized function would carry the bundler's
    // helpers into a page that has none.
    const dataUrl = (await page.evaluate(
      `(async () => {
        const img = new Image()
        img.src = ${JSON.stringify(src)}
        await img.decode()
        const c = document.createElement('canvas')
        c.width = img.naturalWidth
        c.height = img.naturalHeight
        const g = c.getContext('2d')
        ${format === 'jpeg' ? "g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height)" : ''}
        g.drawImage(img, 0, 0)
        return c.toDataURL(${JSON.stringify(`image/${format}`)}, 0.92)
      })()`,
    )) as string
    return decodeDataUrl(dataUrl).bytes
  } finally {
    await page.close()
  }
}

export interface PreviewPages {
  /** Host page: iframes the player and drives it over the bridge. */
  hostHtml: string
  /** The engine's playback-mode player (waits for a LOAD postMessage). */
  playerHtml: string
}

/**
 * Pages for `vos preview`. The playback template is the iframe HALF of the
 * player bridge — it renders nothing until a host posts `LOAD`, so the CLI
 * serves a minimal host page that sends `LOAD { code, autoplay }` and shows
 * a transport line (time / duration, click to play-pause).
 */
export function previewPages(
  config: Record<string, unknown>,
  /** Declared files, served by the preview server under `ASSET_ROUTE`. */
  assets?: ProgramAssets | null,
): PreviewPages {
  const code = compile(config, assets)
  const playerHtml = generateRenderTemplate(code, {
    mode: 'playback',
    elementsBundleCode,
    tweenEngine: 'vos',
    tweenBundleCode: tweenRuntimeCode,
  })
  const codeJson = JSON.stringify(code).replace(/<\//g, '<\\/')
  // A program that declares its size plays letterboxed at that aspect, the
  // frame it was designed for; one that declares none fills the window.
  const size = programSize(config)
  const frameCss = size
    ? `iframe{position:absolute;inset:0;margin:auto;border:0;width:min(100vw,calc(100vh * ${size.width} / ${size.height}));height:min(100vh,calc(100vw * ${size.height} / ${size.width}))}`
    : 'iframe{position:absolute;inset:0;width:100%;height:100%;border:0}'
  const hostHtml = `<!doctype html><html><head><meta charset="utf-8"><title>vos preview</title>
<style>
  html,body{margin:0;height:100%;background:#000;overflow:hidden}
  ${frameCss}
  #cover{position:fixed;inset:0;cursor:pointer}
  #hud{position:fixed;left:12px;bottom:10px;color:#fff;opacity:.75;font:12px/1.4 ui-monospace,monospace;
       background:rgba(0,0,0,.45);padding:4px 8px;border-radius:6px;pointer-events:none}
</style></head><body>
<iframe id="p" src="/player" allow="autoplay"></iframe>
<div id="cover"></div>
<div id="hud">loading…</div>
<script>
  const code = ${codeJson}
  const frame = document.getElementById('p')
  const hud = document.getElementById('hud')
  let ready = false
  let playing = true
  const post = (msg) => frame.contentWindow && frame.contentWindow.postMessage(msg, '*')
  const load = () => post({ type: 'LOAD', code, autoplay: true })
  window.addEventListener('message', (e) => {
    const msg = e.data || {}
    if (msg.type === 'BRIDGE_READY') load()
    if (msg.type === 'READY') { ready = true; hud.textContent = '0.0 / ' + msg.duration.toFixed(1) + 's — click to pause' }
    if (msg.type === 'UPDATE') hud.textContent = msg.time.toFixed(1) + ' / ' + msg.duration.toFixed(1) + 's — click to ' + (playing ? 'pause' : 'play')
    if (msg.type === 'ERROR') hud.textContent = 'error: ' + msg.error
  })
  // Belt and braces: if BRIDGE_READY raced the host, retry LOAD until READY.
  let tries = 0
  const iv = setInterval(() => {
    if (ready || tries++ > 20) return clearInterval(iv)
    load()
  }, 400)
  // The iframe swallows clicks — capture them on an overlay above it.
  document.getElementById('cover').addEventListener('click', () => {
    if (!ready) return
    playing = !playing
    post({ type: playing ? 'PLAY' : 'PAUSE' })
    hud.textContent = hud.textContent.replace(/click to (pause|play)/, 'click to ' + (playing ? 'pause' : 'play'))
  })
</script></body></html>`
  return { hostHtml, playerHtml }
}
