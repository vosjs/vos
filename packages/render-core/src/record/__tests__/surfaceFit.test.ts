import { describe, expect, it } from 'vitest'
import { fitSurfaceToViewport } from '../surfaceFit'
import type { RecorderCdp } from '../driver'

/** The smallest JPEG head `jpegDims` reads: SOI, then a SOF0 with the size. */
function jpegOf(width: number, height: number): string {
  const head = [0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08]
  const size = [height >> 8, height & 0xff, width >> 8, width & 0xff]
  const bytes = [...head, ...size, 0x03, ...new Array<number>(9).fill(0)]
  return btoa(String.fromCharCode(...bytes))
}

/**
 * A headless window with a frame: the surface is the window less `inset`
 * px of height, as Chrome's is. `dpr` scales what a screenshot hands back.
 */
function framedWindow(opts: {
  width: number
  height: number
  inset: number
  dpr?: number
  noBrowserDomain?: boolean
}) {
  const bounds = { width: opts.width, height: opts.height }
  const dpr = opts.dpr ?? 1
  const calls: string[] = []
  const cdp: RecorderCdp = {
    on: () => undefined,
    send: async (method, params) => {
      calls.push(method)
      if (method === 'Runtime.evaluate') return { result: { value: dpr } }
      if (method === 'Page.captureScreenshot')
        return {
          data: jpegOf(
            bounds.width * dpr,
            Math.max(0, bounds.height - opts.inset) * dpr,
          ),
        }
      if (opts.noBrowserDomain) throw new Error(`'${method}' wasn't found`)
      if (method === 'Browser.getWindowForTarget')
        return { windowId: 7, bounds: { ...bounds } }
      if (method === 'Browser.setWindowBounds') {
        const b = (params as { bounds: { width: number; height: number } })
          .bounds
        bounds.width = b.width
        bounds.height = b.height
        return {}
      }
      throw new Error(`unexpected ${method}`)
    },
  }
  return { cdp, bounds, calls }
}

describe('fitSurfaceToViewport', () => {
  it('grows a framed window by its frame, so the surface is the viewport', async () => {
    const w = framedWindow({ width: 1280, height: 720, inset: 87 })
    const fit = await fitSurfaceToViewport(w.cdp, 1280, 720)
    expect(fit).toEqual({
      before: { width: 1280, height: 633 },
      after: { width: 1280, height: 720 },
    })
    expect(w.bounds).toEqual({ width: 1280, height: 807 })
  })

  it('reads the surface in CSS px on a dense screen', async () => {
    const w = framedWindow({ width: 1280, height: 720, inset: 87, dpr: 2 })
    const fit = await fitSurfaceToViewport(w.cdp, 1280, 720)
    expect(fit?.after).toEqual({ width: 1280, height: 720 })
    expect(w.bounds).toEqual({ width: 1280, height: 807 })
  })

  it('moves nothing when the surface is already the viewport', async () => {
    const w = framedWindow({ width: 1280, height: 720, inset: 0 })
    const fit = await fitSurfaceToViewport(w.cdp, 1280, 720)
    expect(fit?.before).toEqual({ width: 1280, height: 720 })
    expect(w.calls).not.toContain('Browser.setWindowBounds')
  })

  it('leaves a driver with no Browser domain as it was, and never throws', async () => {
    const w = framedWindow({
      width: 1280,
      height: 720,
      inset: 87,
      noBrowserDomain: true,
    })
    await expect(fitSurfaceToViewport(w.cdp, 1280, 720)).resolves.toBeNull()
  })
})
