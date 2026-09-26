/**
 * Frames → CFR WebM, as the CLI runs it: the page is render-core's
 * (`buildEncodePage`, shared with the fleet); this serves the take
 * directory to it and takes the bytes back through the take server's
 * `/save`, so the recording lands beside the frames it was made from. The
 * page is served FROM the take server, so its fetches are same-origin and
 * relative.
 */
import { buildEncodePage } from '@vosjs/render-core/record'
import { startTakeServer, waitForPageDone } from './server'
import { RECORDING_NAME } from './take'
import type { Browser } from 'playwright'

const ENCODE_HTML = buildEncodePage({
  framesIndexUrl: '/frames.json',
  metaUrl: '/meta.json',
  framesBaseUrl: '/frames/',
  save: { method: 'POST', url: `/save?name=${RECORDING_NAME}` },
})

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
