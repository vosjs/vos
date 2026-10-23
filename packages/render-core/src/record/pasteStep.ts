/**
 * The `paste` step run against a page: the clipboard first (a trusted
 * paste through the platform's chord), the page's own paste event when the
 * browser's clipboard refuses the item. paste.ts holds the page scripts and
 * says why there are two rungs.
 */
import type { RecorderContext, RecorderPage } from './driver'
import type { LoadedFiles } from './scriptFiles'
import type { PasteItem } from './paste'
import { stageClipboardScript, syntheticPasteScript } from './paste'

/** Bytes to base64 without Node's Buffer, so the fleet's isolate runs it too. */
function toBase64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000)
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

/** What a paste step puts on the clipboard: its words, or its file as read before the take. */
export function pasteItemOf(
  step: { text?: string; file?: string },
  stepIdx: number,
  files: LoadedFiles,
): PasteItem | null {
  if (step.text !== undefined) return { text: step.text }
  const f = files.pastes.get(stepIdx)
  if (!f) return null
  return { b64: toBase64(f.bytes), type: f.type, name: f.name }
}

export type PasteOutcome =
  | { via: 'clipboard' }
  | { via: 'file' }
  | { via: 'page'; why: string }
  | { failed: string }

/**
 * Paste `item` where the focus is. `press` presses the paste chord and is
 * the recorder's, so the keystroke is timed and pinged like any other.
 */
export async function runPaste(
  page: RecorderPage,
  context: RecorderContext,
  item: PasteItem,
  press: (chord: string) => Promise<void>,
): Promise<PasteOutcome> {
  // An image FILE is dispatched in the page with its own bytes: the
  // browser's clipboard re-encodes a picture and drops what the file
  // carries (a screenshot's density, so a 2x capture lands at twice its
  // size). Words keep the trusted path.
  if (item.b64 !== undefined && item.type?.startsWith('image/')) {
    const done = await page
      .evaluate<string>(syntheticPasteScript(item, { original: true }))
      .catch((e: unknown) => `failed: ${e instanceof Error ? e.message : e}`)
    return done === 'ok'
      ? { via: 'file' }
      : { failed: `the page's paste failed (${done.replace(/^failed: /, '')})` }
  }
  let origin: string | undefined
  try {
    origin = new URL(page.url()).origin
  } catch {
    origin = undefined
  }
  if (context.grantPermissions && origin && origin !== 'null')
    await context
      .grantPermissions(['clipboard-read', 'clipboard-write'], { origin })
      .catch(() => undefined)
  const staged = await page
    .evaluate<string>(stageClipboardScript(item))
    .catch((e: unknown) => `refused: ${e instanceof Error ? e.message : e}`)
  if (staged === 'ok') {
    await press('ControlOrMeta+v')
    return { via: 'clipboard' }
  }
  const why = staged.replace(/^refused: /, '')
  const done = await page
    .evaluate<string>(syntheticPasteScript(item))
    .catch((e: unknown) => `failed: ${e instanceof Error ? e.message : e}`)
  if (done === 'ok') return { via: 'page', why }
  return {
    failed: `this browser has no clipboard to paste from (${why}), and the page's own paste failed too (${done.replace(/^failed: /, '')})`,
  }
}
