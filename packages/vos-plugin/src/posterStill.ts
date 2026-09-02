/**
 * Poster stills (the deliver --poster leg): render a PROGRAM
 * config — the maker's split-cover poster family — to PNG at exact
 * destination pixels, one fresh deterministic init per size (posters
 * recompose across aspects; that is the point of the family). Reuses the
 * plugin's own render page (renderPageHtml now carries the elements
 * runtime), so this is the existing harness pointed at a config, not a
 * second HTML generator. PNG by construction — the engine's thumbnail
 * template is webp-only (an engine ask), this page captures the canvas
 * itself.
 */
import { compileVosConfig } from '@vosjs/core'
import { renderPageHtml } from './renderAnimation'
import { startTakeServer, waitForPageDone } from './server'
import type { Browser } from 'playwright'

export interface PosterShot {
  /** Output filename (saved into serveDir). */
  name: string
  width: number
  height: number
}

/** Runs inside the render page: init at exact size, seek, settle, PNG. */
async function posterStillInPage(opts: {
  animationCode: string
  W: number
  H: number
  time: number
  outName: string
}) {
  const w = window as unknown as Record<string, any>
  try {
    const mod = await import(
      /* @vite-ignore */ URL.createObjectURL(
        new Blob([opts.animationCode], { type: 'text/javascript' }),
      )
    )
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
    timeline.seek(opts.time, false)
    const canvas = document.querySelector('canvas') as HTMLCanvasElement
    canvas.width = opts.W
    canvas.height = opts.H
    canvas.style.width = opts.W + 'px'
    canvas.style.height = opts.H + 'px'
    // A few frames for element rasters (text canvases, the shot texture)
    // to land — assetsReady covers loads, the rAFs cover the first draw.
    const raf = () => new Promise((r) => requestAnimationFrame(r))
    await raf()
    await raf()
    await raf()
    const png = await new Promise<Blob | null>((res) =>
      canvas.toBlob((b) => res(b), 'image/png'),
    )
    if (!png) throw new Error('toBlob returned null')
    await fetch('/save?name=' + opts.outName, { method: 'POST', body: png })
    w.__done = { ok: true }
  } catch (e) {
    w.__error = String((e instanceof Error && e.stack) || e)
  }
}

/**
 * Render `shots` of a poster config into `serveDir` (which also serves the
 * config's local assets — deliver puts the release's shot there as
 * /shot.png before baking that path into the config).
 */
export async function renderPosterStills(
  browser: Browser,
  config: Record<string, unknown>,
  serveDir: string,
  shots: PosterShot[],
  time: number,
): Promise<void> {
  const animationCode = compileVosConfig(config as never, {
    tweenEngine: 'vos',
  })
  const server = await startTakeServer(serveDir, {
    '/render.html': renderPageHtml(),
  })
  try {
    for (const shot of shots) {
      const context = await browser.newContext({
        viewport: { width: shot.width, height: shot.height },
      })
      try {
        const page = await context.newPage()
        page.on('console', (m) => {
          if (m.type() === 'error')
            process.stderr.write(`   [poster page] ${m.text()}\n`)
        })
        await page.addInitScript(() => {
          ;(globalThis as unknown as Record<string, unknown>).__name = (
            f: unknown,
          ) => f
        })
        await page.goto(`${server.base}/render.html`)
        await page.waitForFunction('window.__pageReady__ === true')
        void page
          .evaluate(posterStillInPage, {
            animationCode,
            W: shot.width,
            H: shot.height,
            time,
            outName: shot.name,
          })
          .catch(() => {})
        await waitForPageDone(page, `poster ${shot.name}`, () => {}, 120_000)
      } finally {
        await context.close()
      }
    }
  } finally {
    server.close()
  }
}
