import { compileVosConfig } from '@vosjs/core'
import { generateRenderTemplate } from '@vosjs/core/runtime'
import { elementsBundleCode } from '@vosjs/elements/bundle'
import { tweenRuntimeCode } from '@vosjs/tween/bundle'
import type { Browser, Page } from 'playwright'

/** Fake secure origin the render page is served from (WebCodecs needs one). */
const RENDER_ORIGIN = 'https://vos-cli.render'

export interface RenderCommonOptions {
  config: Record<string, unknown>
  width: number
  height: number
  /** Phase callback for progress reporting. */
  onPhase?: (phase: string) => void
}

export interface RenderVideoOptions extends RenderCommonOptions {
  fps: number
  /** Output duration in seconds. */
  duration: number
  format: 'webm' | 'mp4'
}

export interface RenderStillOptions extends RenderCommonOptions {
  /** Seek time for the captured frame, seconds. */
  time: number
}

export interface RenderResult {
  bytes: Uint8Array
  mimeType: string
}

interface RenderComplete {
  success: boolean
  data?: string
  error?: string
}

function compile(config: Record<string, unknown>): string {
  return compileVosConfig(config as never, { tweenEngine: 'vos' })
}

async function runCapturePage(
  browser: Browser,
  html: string,
  opts: { width: number; height: number; timeoutMs: number },
): Promise<RenderComplete> {
  const context = await browser.newContext({
    viewport: { width: opts.width, height: opts.height },
  })
  const page: Page = await context.newPage()
  const errors: string[] = []
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  try {
    await page.route(`${RENDER_ORIGIN}/**`, (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: html }),
    )
    await page.goto(`${RENDER_ORIGIN}/render`, { waitUntil: 'domcontentloaded' })
    const start = Date.now()
    for (;;) {
      const done = (await page.evaluate('window.__renderComplete ?? null')) as RenderComplete | null
      if (done) return done
      if (Date.now() - start > opts.timeoutMs) {
        return {
          success: false,
          error: `render timed out after ${Math.round(opts.timeoutMs / 1000)}s${
            errors.length ? ` (page errors: ${errors.slice(0, 3).join(' | ')})` : ''
          }`,
        }
      }
      await new Promise((r) => setTimeout(r, 400))
    }
  } finally {
    await context.close()
  }
}

function decodeDataUrl(dataUrl: string): RenderResult {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl)
  if (!m) throw new Error('capture page returned an unexpected payload')
  return { bytes: Uint8Array.from(Buffer.from(m[2], 'base64')), mimeType: m[1] }
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
  })
  if (!done.success || !done.data) throw new Error(done.error ?? 'render failed')
  return decodeDataUrl(done.data)
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
  })
  if (!done.success || !done.data) throw new Error(done.error ?? 'still render failed')
  return decodeDataUrl(done.data)
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
export function previewPages(config: Record<string, unknown>): PreviewPages {
  const code = compile(config)
  const playerHtml = generateRenderTemplate(code, {
    mode: 'playback',
    elementsBundleCode,
    tweenEngine: 'vos',
    tweenBundleCode: tweenRuntimeCode,
  })
  const codeJson = JSON.stringify(code).replace(/<\//g, '<\\/')
  const hostHtml = `<!doctype html><html><head><meta charset="utf-8"><title>vos preview</title>
<style>
  html,body{margin:0;height:100%;background:#000;overflow:hidden}
  iframe{position:absolute;inset:0;width:100%;height:100%;border:0}
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
