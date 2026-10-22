/**
 * The recorded surface is the viewport, exactly.
 *
 * The screencast reads the window's content surface, not the page's
 * emulated viewport. Playwright sizes a headless window TO the viewport,
 * assuming a headless window has no frame, and headless Chrome (the
 * `channel: 'chrome'` builds) gives it one: the page lays out at 1280x720
 * while the surface under it is 1280x633, and every frame of the take loses
 * the bottom 87 px (measured, Chrome 155 on macOS; a viewport of any size
 * loses the same strip, and a window made LARGER than the viewport hands
 * back more than the page). Two cases are exact already, and a fit there
 * measures and does nothing: Playwright's bundled headless shell, and a
 * page a persistent context opens with `newPage()` (a `--session` take),
 * while the first page of that same context and every page of a
 * `newContext()` (the default take, `--storage-state`) are short.
 *
 * So before the camera rolls: one screenshot says what the surface really
 * is, the window's bounds take the difference, and a second screenshot
 * says whether it landed. A driver that cannot (no Browser domain, a
 * window it may not move) is left as it was, and the meta's
 * `captureWidth`/`captureHeight` still say what was recorded.
 */
import { base64Bytes, jpegDims } from './recorder'
import type { RecorderCdp } from './driver'

export interface SurfaceSize {
  width: number
  height: number
}

export interface SurfaceFit {
  before: SurfaceSize
  after: SurfaceSize
}

/** The surface the compositor hands back, in CSS px. */
async function surfaceSize(
  cdp: RecorderCdp,
  dpr: number,
): Promise<SurfaceSize | null> {
  const shot = (await cdp.send('Page.captureScreenshot', {
    format: 'jpeg',
    quality: 1,
  })) as { data?: string }
  const dims = shot.data ? jpegDims(base64Bytes(shot.data)) : null
  if (!dims) return null
  return { width: Math.round(dims.w / dpr), height: Math.round(dims.h / dpr) }
}

/**
 * Make the surface the viewport. Returns what it measured, or null when
 * nothing could be measured; never throws, because a take made as before
 * is better than no take.
 */
export async function fitSurfaceToViewport(
  cdp: RecorderCdp,
  width: number,
  height: number,
): Promise<SurfaceFit | null> {
  try {
    const ratio = (await cdp.send('Runtime.evaluate', {
      expression: 'devicePixelRatio',
      returnByValue: true,
    })) as { result?: { value?: unknown } }
    const value = ratio.result?.value
    const dpr = typeof value === 'number' && value > 0 ? value : 1
    const before = await surfaceSize(cdp, dpr)
    if (!before) return null
    let after = before
    // Twice at most: a window manager may round the first move.
    for (let tries = 0; tries < 2; tries++) {
      if (after.width === width && after.height === height) break
      const win = (await cdp.send('Browser.getWindowForTarget')) as {
        windowId: number
        bounds: { width?: number; height?: number }
      }
      const { width: ww, height: wh } = win.bounds
      if (ww === undefined || wh === undefined) break
      await cdp.send('Browser.setWindowBounds', {
        windowId: win.windowId,
        bounds: {
          width: ww + (width - after.width),
          height: wh + (height - after.height),
        },
      })
      after = (await surfaceSize(cdp, dpr)) ?? after
    }
    return { before, after }
  } catch {
    return null
  }
}
