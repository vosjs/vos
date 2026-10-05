/**
 * The text layer's pixels, as a corpus: every way a text layer is set
 * (presets, alignment, wrap, pill, stroke, emphasis, each per-unit entrance,
 * mid-animation and settled), painted by the studio entry's own ON_FRAME on a
 * real 2D canvas in a real browser, with the hosted faces loaded.
 *
 * It exists to hold a change to the painter against what the painter drew
 * before. Pictures depend on the machine's font rasterizer, so nothing is
 * committed: write the corpus at the commit you trust, then compare at the
 * commit you changed.
 *
 *   pnpm build                                             # dist is what runs
 *   node packages/studio-core/scripts/verify-text-corpus.mjs --out <dir>
 *   node packages/studio-core/scripts/verify-text-corpus.mjs --against <dir> [--only <id,id>] [--diff <dir>]
 *
 * `--against` exits 1 when any case differs: a pixel counts past a small
 * channel tolerance, and the report names each case with how many pixels
 * moved and by how much. `--diff <dir>` writes the new picture of every
 * case that differs, to look at beside the old one.
 */
/* global process, console, Buffer */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { timelineRuntimeCode } from '@vosjs/timeline/bundle'
import {
  BASE_FRAME_STYLE,
  DEFAULT_BROWSER_BAR,
  DEFAULT_CAM_STYLE,
  DEFAULT_CURSOR_STYLE,
  STUDIO_ENTRY_ID,
  lowerToComposition,
} from '../dist/index.js'

const HERE = dirname(fileURLToPath(import.meta.url))
// Playwright is the CLI's dependency; this harness borrows it.
const { chromium } = createRequire(join(HERE, '../../cli/package.json'))(
  'playwright',
)

const arg = (name) => {
  const i = process.argv.indexOf(name)
  return i < 0 ? null : process.argv[i + 1]
}
const OUT = arg('--out')
const AGAINST = arg('--against')
const DIFF = arg('--diff')
const ONLY = arg('--only')?.split(',') ?? null
if (!OUT && !AGAINST) {
  console.error('usage: verify-text-corpus.mjs --out <dir> | --against <dir>')
  process.exit(2)
}

const W = 1280
const H = 720
/** A channel may move this much before a pixel counts as changed. */
const TOLERANCE = 2

const clip = (over = {}) => ({
  id: 'o1',
  kind: 'text',
  start: 0.5,
  duration: 3,
  text: 'Ship it faster',
  preset: 'title',
  transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0 },
  ...over,
})
const LONG = 'Set up different purposes for every page of the product you ship'
const EM =
  'Set up *different purposes* for every page of the *product* you ship'
const HOLD = 2
const MID = 0.72

/** [id, overlays, time]. A new case goes at the end: ids are the file names. */
const CASES = [
  ['title', [clip()], HOLD],
  ['caption', [clip({ preset: 'caption' })], HOLD],
  [
    'label-mono',
    [clip({ preset: 'label', text: 'npm i -D @vosjs/cli' })],
    HOLD,
  ],
  ['lines-center', [clip({ text: 'Ship it\nfaster than\nyou think' })], HOLD],
  [
    'lines-left',
    [clip({ text: 'Ship it\nfaster than\nyou think', align: 'left' })],
    HOLD,
  ],
  [
    'lines-right',
    [clip({ text: 'Ship it\nfaster than\nyou think', align: 'right' })],
    HOLD,
  ],
  ['wrap', [clip({ preset: 'caption', text: LONG, maxWidth: 0.3 })], HOLD],
  [
    'wrap-left',
    [clip({ preset: 'caption', text: LONG, maxWidth: 0.3, align: 'left' })],
    HOLD,
  ],
  [
    'wrap-leading-space',
    [clip({ preset: 'caption', text: '  ' + LONG, maxWidth: 0.3 })],
    HOLD,
  ],
  [
    'pill',
    [clip({ preset: 'caption', box: { color: '#111827', opacity: 0.9 } })],
    HOLD,
  ],
  [
    'pill-wrap-left',
    [
      clip({
        preset: 'caption',
        text: LONG,
        maxWidth: 0.3,
        align: 'left',
        box: { color: '#ce5d42' },
      }),
    ],
    HOLD,
  ],
  ['stroke', [clip({ stroke: { color: '#000000', width: 6 } })], HOLD],
  ['no-shadow', [clip({ shadow: 0 })], HOLD],
  ['italic', [clip({ italic: true })], HOLD],
  [
    'spacing',
    [clip({ letterSpacing: 6, lineHeight: 1.6, text: 'Ship it\nfaster' })],
    HOLD,
  ],
  [
    'family',
    [clip({ family: 'Playfair Display', weight: 700, color: '#fde68a' })],
    HOLD,
  ],
  ['size-color', [clip({ size: 120, color: '#93c5fd' })], HOLD],
  [
    'posed',
    [clip({ transform: { x: 0.4, y: 0.6, scale: 1.6, rotation: -8 } })],
    HOLD,
  ],
  ['enter-mid', [clip()], 0.62],
  ['exit-mid', [clip()], 3.38],
  ['em', [clip({ preset: 'caption', text: EM, emphasis: {} })], HOLD],
  [
    'em-color',
    [
      clip({
        preset: 'caption',
        text: EM,
        emphasis: { color: '#ce5d42', weight: 800 },
      }),
    ],
    HOLD,
  ],
  [
    'em-wrap',
    [clip({ preset: 'caption', text: EM, emphasis: {}, maxWidth: 0.3 })],
    HOLD,
  ],
  [
    'em-wrap-left-pill',
    [
      clip({
        preset: 'caption',
        text: EM,
        emphasis: {},
        maxWidth: 0.3,
        align: 'left',
        box: { color: '#111827' },
      }),
    ],
    HOLD,
  ],
  [
    'em-stroke',
    [
      clip({
        text: 'Ship it *faster*',
        emphasis: {},
        stroke: { color: '#000000', width: 6 },
      }),
    ],
    HOLD,
  ],
  [
    'em-lines',
    [
      clip({
        text: 'Ship *it*\n*faster* than\nyou think',
        emphasis: {},
        align: 'right',
      }),
    ],
    HOLD,
  ],
  ['em-title-weight', [clip({ text: 'Ship it *faster*', emphasis: {} })], HOLD],
  [
    'fx-word-mid',
    [
      clip({
        preset: 'caption',
        text: LONG,
        anim: { enter: { kind: 'rise', unit: 'word' } },
      }),
    ],
    MID,
  ],
  [
    'fx-word-settled',
    [
      clip({
        preset: 'caption',
        text: LONG,
        anim: { enter: { kind: 'rise', unit: 'word' } },
      }),
    ],
    HOLD,
  ],
  [
    'fx-char-pop-mid',
    [clip({ anim: { enter: { kind: 'pop', unit: 'char' } } })],
    MID,
  ],
  [
    'fx-char-settled',
    [clip({ anim: { enter: { kind: 'pop', unit: 'char' } } })],
    HOLD,
  ],
  [
    'fx-line-wrap-mid',
    [
      clip({
        preset: 'caption',
        text: LONG,
        maxWidth: 0.3,
        anim: { enter: { kind: 'fade', unit: 'line' } },
      }),
    ],
    MID,
  ],
  [
    'fx-typewriter-mid',
    [clip({ anim: { enter: { kind: 'typewriter', unit: 'char' } } })],
    MID,
  ],
  [
    'fx-blur-word-mid',
    [clip({ anim: { enter: { kind: 'blur', unit: 'word' } } })],
    0.6,
  ],
  [
    'fx-word-wrap-left-mid',
    [
      clip({
        preset: 'caption',
        text: LONG,
        maxWidth: 0.3,
        align: 'left',
        anim: { enter: { kind: 'rise', unit: 'word', direction: 'center' } },
      }),
    ],
    MID,
  ],
  [
    'fx-block-pop-mid',
    [clip({ anim: { enter: { kind: 'pop', unit: 'block' } } })],
    0.6,
  ],
  [
    'em-fx-word-mid',
    [
      clip({
        preset: 'caption',
        text: EM,
        emphasis: {},
        anim: { enter: { kind: 'rise', unit: 'word' } },
      }),
    ],
    MID,
  ],
  [
    'em-fx-word-settled',
    [
      clip({
        preset: 'caption',
        text: EM,
        emphasis: {},
        anim: { enter: { kind: 'rise', unit: 'word' } },
      }),
    ],
    HOLD,
  ],
  [
    'em-fx-word-wrap-settled',
    [
      clip({
        preset: 'caption',
        text: EM,
        emphasis: {},
        maxWidth: 0.3,
        anim: { enter: { kind: 'fade', unit: 'word' } },
      }),
    ],
    HOLD,
  ],
  [
    'em-fx-char-settled',
    [
      clip({
        text: 'Ship it *faster*',
        emphasis: {},
        anim: { enter: { kind: 'fade', unit: 'char' } },
      }),
    ],
    HOLD,
  ],
  [
    'em-fx-line-wrap-settled',
    [
      clip({
        preset: 'caption',
        text: EM,
        emphasis: {},
        maxWidth: 0.3,
        anim: { enter: { kind: 'fade', unit: 'line' } },
      }),
    ],
    HOLD,
  ],
  [
    'two-clips',
    [
      clip({ id: 'a', transform: { x: 0.5, y: 0.3, scale: 1, rotation: 0 } }),
      clip({
        id: 'b',
        preset: 'caption',
        text: EM,
        emphasis: {},
        transform: { x: 0.5, y: 0.7, scale: 1, rotation: 0 },
      }),
    ],
    HOLD,
  ],
]

const makeDoc = (overlays) => ({
  source: {
    videoKey: 'blob:video',
    cursor: [{ t: 0, x: 100, y: 100, type: 'move' }],
    meta: {
      dpr: 2,
      zoom: 1,
      t0: 0,
      durationMs: 4000,
      width: 1600,
      height: 900,
      fps: 30,
    },
  },
  segments: [{ in: 0, out: 4 }],
  zoom: [],
  audio: [],
  cursor: DEFAULT_CURSOR_STYLE,
  cam: DEFAULT_CAM_STYLE,
  frame: { ...BASE_FRAME_STYLE, browserBar: DEFAULT_BROWSER_BAR },
  overlays,
  export: { resolution: '1080p', fps: 30, format: 'mp4' },
})

/** In the page: paint one case and hand back its PNG. */
const PAINT = `async ({ onFrame, data, time, W, H }) => {
  const frame = new Function('return (' + onFrame + ')')()
  window.__vos__ = { isPaused: true, videoCache: new Map(), pendingDecodes: new Set() }
  const paint = () => {
    const canvas = document.createElement('canvas')
    canvas.width = W; canvas.height = H
    const c2d = canvas.getContext('2d')
    const ov = { c2d, canvas, texture: { needsUpdate: false, dispose() {} }, mesh: null }
    frame(
      { time, data, renderer: undefined, resolution: { width: W, height: H, drawingBufferWidth: W, drawingBufferHeight: H } },
      { refs: { ov, objects: null } },
      1 / 30,
    )
    return canvas
  }
  // The first paint asks for the faces; the picture is the paint after they
  // have all landed (twice, since a face can ask for another).
  paint()
  await document.fonts.ready
  await Promise.all([...document.fonts].map((f) => f.loaded.catch(() => {})))
  paint()
  await document.fonts.ready
  await new Promise((r) => setTimeout(r, 50))
  return paint().toDataURL('image/png')
}`

/** In the page: how two PNGs differ. */
const COMPARE = `async ({ a, b, tol }) => {
  const load = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src })
  const [ia, ib] = await Promise.all([load(a), load(b)])
  if (ia.width !== ib.width || ia.height !== ib.height) return { size: true }
  const px = (img) => { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d'); x.drawImage(img, 0, 0); return x.getImageData(0, 0, c.width, c.height).data }
  const da = px(ia), db = px(ib)
  let n = 0, max = 0, ink = 0
  for (let i = 0; i < da.length; i += 4) {
    if (da[i + 3] || db[i + 3]) ink++
    const d = Math.max(Math.abs(da[i] - db[i]), Math.abs(da[i + 1] - db[i + 1]), Math.abs(da[i + 2] - db[i + 2]), Math.abs(da[i + 3] - db[i + 3]))
    if (d > tol) n++
    if (d > max) max = d
  }
  return { n, max, ink }
}`

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: W, height: H } })
page.on('pageerror', (e) => console.log('  [pageerror]', e.message))
// A real origin, so the faces on assets.vos.so load as they do in a player.
await page.goto('https://vos.so/robots.txt')
await page.evaluate(`(() => { ${timelineRuntimeCode} })()`)

if (OUT) mkdirSync(OUT, { recursive: true })
if (DIFF) mkdirSync(DIFF, { recursive: true })
const failed = []
let blank = 0
for (const [id, overlays, time] of CASES) {
  if (ONLY && !ONLY.includes(id)) continue
  const lowered = lowerToComposition(makeDoc(overlays))
  const entry = lowered.config.stack[0]
  const data = lowered.stack[STUDIO_ENTRY_ID]
  const url = await page.evaluate(
    `(${PAINT})(${JSON.stringify({ onFrame: entry.onFrame, data, time, W, H })})`,
  )
  const png = Buffer.from(url.split(',')[1], 'base64')
  if (OUT) {
    writeFileSync(join(OUT, id + '.png'), png)
    continue
  }
  const file = join(AGAINST, id + '.png')
  if (!existsSync(file)) {
    console.log(`new   ${id} (no picture to compare against)`)
    continue
  }
  const old = 'data:image/png;base64,' + readFileSync(file).toString('base64')
  const r = await page.evaluate(
    `(${COMPARE})(${JSON.stringify({ a: old, b: url, tol: TOLERANCE })})`,
  )
  if (r.ink === 0) blank++
  if (r.size || r.n > 0) {
    failed.push(id)
    console.log(
      r.size
        ? `DIFF  ${id}: the picture changed size`
        : `DIFF  ${id}: ${r.n} px moved (max channel ${r.max}, of ${r.ink} inked)`,
    )
    if (DIFF) writeFileSync(join(DIFF, id + '.png'), png)
  } else console.log(`same  ${id}`)
}
await browser.close()

if (OUT) {
  console.log(`\n${CASES.length} pictures written to ${OUT}`)
} else if (blank > 0) {
  // A corpus of empty canvases agrees with anything.
  console.error(
    `\nINCONCLUSIVE: ${blank} case(s) painted nothing on either side.`,
  )
  process.exit(1)
} else if (failed.length) {
  console.error(
    `\nFAILED: ${failed.length} case(s) differ: ${failed.join(', ')}`,
  )
  process.exit(1)
} else console.log('\nPASS: every case paints as it did.')
