/**
 * The text element's pixels, as a corpus: every way a text element is set
 * (lines, alignment, spacing, stroke, shadow, weights, split by chars,
 * words and lines, a hi-res buffer, and styled runs), rendered by the real
 * `renderElements` in a real browser with hosted faces loaded, and
 * composited the way the planes sit in the frame.
 *
 * It exists to hold a change to the renderer against what the renderer drew
 * before: every published program picks up a new engine, so plain text must
 * not move. Pictures depend on the machine's font rasterizer, so nothing is
 * committed: write the corpus at the commit you trust, then compare at the
 * commit you changed.
 *
 *   pnpm build                                              # dist is what runs
 *   node packages/elements/scripts/verify-text-raster.mjs --out <dir>
 *   node packages/elements/scripts/verify-text-raster.mjs --against <dir> [--only <id,id>] [--diff <dir>]
 *
 * `--out` skips the cases marked `styled` when run with `--plain` (a
 * renderer from before styled runs cannot draw them). `--against` exits 1
 * when any case differs; a case with no picture to compare against is
 * reported as new and written to `--diff` to be looked at.
 */
/* global process, console, Buffer */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { elementsBundleCode } from '../dist/bundle.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const require = createRequire(join(HERE, '../package.json'))
// Playwright is the CLI's dependency; this harness borrows it.
const { chromium } = createRequire(join(HERE, '../../cli/package.json'))(
  'playwright',
)
const THREE_CORE = readFileSync(
  join(dirname(require.resolve('three')), 'three.core.min.js'),
  'utf8',
)

const arg = (name) => {
  const i = process.argv.indexOf(name)
  return i < 0 ? null : process.argv[i + 1]
}
const OUT = arg('--out')
const AGAINST = arg('--against')
const DIFF = arg('--diff')
const ONLY = arg('--only')?.split(',') ?? null
const PLAIN = process.argv.includes('--plain')
if (!OUT && !AGAINST) {
  console.error('usage: verify-text-raster.mjs --out <dir> | --against <dir>')
  process.exit(2)
}

const W = 1920
const H = 1080
/** A channel may move this much before a pixel counts as changed. */
const TOLERANCE = 2

const FACES = [
  ['Lexend', 400, 'lexend/400'],
  ['Lexend', 700, 'lexend/700'],
  ['JetBrains Mono', 400, 'jetbrains-mono/400'],
]

const text = (over = {}) => ({
  id: 'e1',
  type: 'text',
  content: 'Ship it faster',
  position: 'center',
  ...over,
  font: {
    family: 'Lexend',
    size: 72,
    weight: 400,
    color: '#f2efe9',
    ...(over.font ?? {}),
  },
})
const LINES = 'Ship it\nfaster than\nyou think'

/** [id, elements, options]. A new case goes at the end: ids are file names. */
const CASES = [
  ['plain', [text()]],
  ['plain-bold', [text({ font: { weight: 700 } })]],
  ['plain-weight-word', [text({ font: { weight: 'bold' } })]],
  ['plain-italic', [text({ font: { style: 'italic' } })]],
  [
    'plain-mono',
    [
      text({
        content: 'npm i -D @vosjs/cli',
        font: { family: 'JetBrains Mono', size: 40 },
      }),
    ],
  ],
  ['lines-left', [text({ content: LINES })]],
  ['lines-center', [text({ content: LINES, font: { align: 'center' } })]],
  ['lines-right', [text({ content: LINES, font: { align: 'right' } })]],
  [
    'lines-tight',
    [text({ content: LINES, font: { align: 'center', lineHeight: 0.95 } })],
  ],
  [
    'empty-line',
    [text({ content: 'Ship it\n\nfaster', font: { align: 'center' } })],
  ],
  [
    'spacing',
    [
      text({
        content: 'GRAVITY TAKES HOLD',
        font: { size: 32, letterSpacing: 12 },
      }),
    ],
  ],
  [
    'spacing-lines-right',
    [
      text({
        content: 'GRAVITY\nTAKES HOLD',
        font: { size: 32, letterSpacing: 12, align: 'right' },
      }),
    ],
  ],
  ['stroke', [text({ stroke: { color: '#e37358', width: 6 } })]],
  [
    'shadow',
    [text({ shadow: { color: 'rgba(0,0,0,0.8)', blur: 24, offsetY: 8 } })],
  ],
  [
    'stroke-shadow-lines',
    [
      text({
        content: LINES,
        font: { align: 'center' },
        stroke: { color: '#101014', width: 4 },
        shadow: { color: '#000', blur: 12 },
      }),
    ],
  ],
  ['emoji', [text({ content: 'Ship 🚀 café' })]],
  [
    'posed',
    [
      text({
        position: { x: '30%', y: '60%' },
        anchor: 'top-left',
        opacity: 0.8,
        transform: { scale: 1.4, rotation: -8, translateX: 40 },
      }),
    ],
  ],
  [
    'hires',
    [text({ content: LINES, font: { align: 'center' } })],
    { scale: 2 },
  ],
  ['split-chars', [text({ split: { type: 'chars' } })]],
  ['split-words', [text({ split: { type: 'words' } })]],
  [
    'split-lines',
    [
      text({
        content: LINES,
        split: { type: 'lines' },
        font: { align: 'center' },
      }),
    ],
  ],
  [
    'split-words-lines-right',
    [
      text({
        content: LINES,
        split: { type: 'words' },
        font: { align: 'right' },
      }),
    ],
  ],
  [
    'split-chars-spacing',
    [
      text({
        content: 'GRAVITY TAKES',
        split: { type: 'chars' },
        font: { size: 40, letterSpacing: 12 },
      }),
    ],
  ],
  [
    'split-chars-stroke-emoji',
    [
      text({
        content: 'Go 🚀 now',
        split: { type: 'chars' },
        stroke: { color: '#e37358', width: 4 },
      }),
    ],
  ],
  [
    'split-words-posed',
    [
      text({
        split: { type: 'words' },
        position: { x: '50%', y: '30%' },
        transform: { scale: 1.2, translateY: 30 },
      }),
    ],
  ],
  ['split-hires', [text({ split: { type: 'words' } })], { scale: 2 }],
  [
    'bound',
    [
      text({
        content: { $data: 'headline' },
        font: { color: { $data: 'ink' } },
      }),
    ],
    { data: { headline: 'Bound words', ink: '#e37358' } },
  ],
  [
    'two-elements',
    [
      text({ id: 'a', position: { x: '50%', y: '35%' } }),
      text({
        id: 'b',
        content: 'second line of thought',
        position: { x: '50%', y: '60%' },
        font: { size: 40, weight: 700 },
      }),
    ],
  ],
  // Styled runs. A renderer from before them cannot draw these (`--plain`).
  [
    'runs-styles',
    [
      text({
        content: [
          { text: 'Ship it ' },
          { text: 'faster', weight: 700, color: '#e37358', underline: true },
          { text: ' ' },
          { text: 'today', italic: true, strike: true },
        ],
      }),
    ],
    { styled: true },
  ],
  [
    'runs-highlight-stroke',
    [
      text({
        content: [
          { text: 'Read ' },
          { text: 'every', highlight: '#2a2a33', weight: 700 },
          { text: ' candle' },
        ],
        stroke: { color: '#101014', width: 4 },
      }),
    ],
    { styled: true },
  ],
  [
    'runs-lines-center',
    [
      text({
        content: [
          { text: 'Ship ' },
          { text: 'it\nfaster', weight: 700 },
          { text: ' than\nyou think' },
        ],
        font: { align: 'center' },
      }),
    ],
    { styled: true },
  ],
  [
    'runs-midword',
    [
      text({
        content: [{ text: 're', weight: 700 }, { text: 'quest builder' }],
      }),
    ],
    { styled: true },
  ],
  [
    'runs-spacing',
    [
      text({
        content: [
          { text: 'GRAVITY ' },
          { text: 'TAKES', color: '#e37358', underline: true },
          { text: ' HOLD' },
        ],
        font: { size: 32, letterSpacing: 12 },
      }),
    ],
    { styled: true },
  ],
  [
    'runs-shadow-highlight',
    [
      text({
        content: [{ text: 'Ship ' }, { text: 'faster', highlight: '#e37358' }],
        shadow: { color: 'rgba(0,0,0,0.8)', blur: 24, offsetY: 8 },
      }),
    ],
    { styled: true },
  ],
  [
    'runs-italic-element',
    [
      text({
        content: [
          { text: 'All italic but ' },
          { text: 'this', italic: false, weight: 700 },
        ],
        font: { style: 'italic' },
      }),
    ],
    { styled: true },
  ],
  [
    'runs-bound',
    [
      text({
        content: [
          { text: { $data: 'lead' } },
          { text: { $data: 'word' }, weight: 700, color: '#e37358' },
        ],
      }),
    ],
    { styled: true, data: { lead: 'Meet ', word: 'Genesis' } },
  ],
  [
    'runs-split-words',
    [
      text({
        content: [
          { text: 'Ship it ' },
          { text: 'faster', weight: 700, color: '#e37358', underline: true },
          { text: ' today' },
        ],
        split: { type: 'words' },
      }),
    ],
    { styled: true },
  ],
  [
    'runs-split-chars',
    [
      text({
        content: [
          { text: 're', weight: 700, color: '#e37358' },
          { text: 'quest' },
        ],
        split: { type: 'chars' },
      }),
    ],
    { styled: true },
  ],
  [
    'runs-split-lines',
    [
      text({
        content: [
          { text: 'Ship ' },
          { text: 'it\nfaster', weight: 700, highlight: '#2a2a33' },
          { text: ' now' },
        ],
        split: { type: 'lines' },
        font: { align: 'center' },
      }),
    ],
    { styled: true },
  ],
  [
    'runs-hires',
    [
      text({
        content: [
          { text: 'Ship it ' },
          { text: 'faster', weight: 700, color: '#e37358', underline: true },
        ],
      }),
    ],
    { styled: true, scale: 2 },
  ],
  // One unstyled run is the string it holds: the same pixels.
  [
    'runs-one-plain',
    [text({ content: [{ text: 'Ship it faster' }] })],
    { styled: true },
  ],
]

/** In the page: render one case and hand back the composite as a PNG. */
const PAINT = `async ({ elements, data, W, H, scale }) => {
  const THREE = window.__THREE
  const api = window.__vosElementsFactory.createVosElements(THREE)
  const resolution = {
    width: W * scale, height: H * scale, pixelRatio: 1,
    drawingBufferWidth: W * scale, drawingBufferHeight: H * scale,
  }
  const render = async () => {
    const scenes = { 100: new THREE.Scene() }
    return api.renderElements(JSON.parse(JSON.stringify(elements)), scenes, resolution, THREE, data)
  }
  // The first render asks for the faces; the picture is the render after
  // they have all landed.
  await render()
  await document.fonts.ready
  await Promise.all([...document.fonts].map((f) => f.loaded.catch(() => {})))
  const map = await render()
  const canvas = document.createElement('canvas')
  canvas.width = W; canvas.height = H
  const c = canvas.getContext('2d')
  c.fillStyle = '#1b1b1f'
  c.fillRect(0, 0, W, H)
  // The frame's planes, drawn where they sit: design px, y up, about the
  // centre, in render order.
  const meshes = []
  map.forEach((inst) => { for (const m of inst.meshes()) meshes.push(m) })
  meshes.sort((a, b) => a.renderOrder - b.renderOrder)
  for (const m of meshes) {
    const img = m.material.map && m.material.map.image
    if (!img) continue
    const w = m.geometry.parameters.width * m.scale.x / scale
    const h = m.geometry.parameters.height * m.scale.y / scale
    c.save()
    c.globalAlpha = m.material.opacity == null ? 1 : m.material.opacity
    c.translate(W / 2 + m.position.x / scale, H / 2 - m.position.y / scale)
    c.rotate(-m.rotation.z)
    c.drawImage(img, -w / 2, -h / 2, w, h)
    c.restore()
  }
  return canvas.toDataURL('image/png')
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
    // The ground is one flat colour: anything else is ink.
    if (da[i] !== 27 || da[i + 1] !== 27 || da[i + 2] !== 31) ink++
    const d = Math.max(Math.abs(da[i] - db[i]), Math.abs(da[i + 1] - db[i + 1]), Math.abs(da[i + 2] - db[i + 2]))
    if (d > tol) n++
    if (d > max) max = d
  }
  return { n, max, ink }
}`

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
page.on('pageerror', (e) => console.log('  [pageerror]', e.message))
// A real origin, so the faces on assets.vos.so load as they do in a player.
await page.goto('https://vos.so/robots.txt')
await page.evaluate(
  `(async () => {
    const url = URL.createObjectURL(new Blob([${JSON.stringify(THREE_CORE)}], { type: 'text/javascript' }))
    window.__THREE = await import(url)
    for (const [family, weight, path] of ${JSON.stringify(FACES)}) {
      const face = new FontFace(family, 'url(https://assets.vos.so/fonts/' + path + '.woff2)', { weight: String(weight) })
      document.fonts.add(face)
      await face.load()
    }
  })()`,
)
await page.evaluate(
  `${elementsBundleCode}; window.__vosElementsFactory = __vosElementsFactory`,
)

if (OUT) mkdirSync(OUT, { recursive: true })
if (DIFF) mkdirSync(DIFF, { recursive: true })
const failed = []
let written = 0
let blank = 0
for (const [id, elements, opts = {}] of CASES) {
  if (ONLY && !ONLY.includes(id)) continue
  if (PLAIN && opts.styled) continue
  const url = await page.evaluate(
    `(${PAINT})(${JSON.stringify({ elements, data: opts.data ?? null, W, H, scale: opts.scale ?? 1 })})`,
  )
  const png = Buffer.from(url.split(',')[1], 'base64')
  if (OUT) {
    writeFileSync(join(OUT, id + '.png'), png)
    written++
    continue
  }
  const file = join(AGAINST, id + '.png')
  if (!existsSync(file)) {
    console.log(`new   ${id} (no picture to compare against)`)
    if (DIFF) writeFileSync(join(DIFF, id + '.png'), png)
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
  console.log(`\n${written} pictures written to ${OUT}`)
} else if (blank > 0) {
  // A corpus of empty frames agrees with anything.
  console.error(`\nINCONCLUSIVE: ${blank} case(s) drew nothing.`)
  process.exit(1)
} else if (failed.length) {
  console.error(
    `\nFAILED: ${failed.length} case(s) differ: ${failed.join(', ')}`,
  )
  process.exit(1)
} else console.log('\nPASS: every case draws as it did.')
