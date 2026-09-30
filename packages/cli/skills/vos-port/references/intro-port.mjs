// The Remotion showreel's INTRO scene (62 frames at 30 fps), ported to a
// data-first vos program. Authored as real functions, stringified here.
import { writeFileSync } from 'node:fs'

const FPS = 30
const f = (frames) => +(frames / FPS).toFixed(4) // Remotion frames → seconds

// Remotion Easing.bezier curves, spelled as the dialect's css-bezier.
const EXPO_OUT = 'css-bezier(0.16, 1, 0.3, 1)'
const EXPO_IN = 'css-bezier(0.7, 0, 0.84, 0)'
const IN_OUT = 'css-bezier(0.83, 0, 0.17, 1)'

function createContent(ctx) {
  // The ground is a knob: read in onFrame, never baked.
  ctx.scene.background = new ctx.THREE.Color(ctx.data.ink)
  return { objects: [], refs: {}, dispose: () => {} }
}

function createTimeline(ctx, content, duration) {
  const { gsap, elements, data } = ctx
  const T = data.t
  // Element props x/y are RENDER pixels; the source's offsets are design
  // pixels on a 1080-high frame. Scale every offset by k.
  const k = ctx.resolution.height / 1080
  const tl = gsap.timeline({ paused: true })
  tl.addLabel('intro', 0)

  // The pill: a 40px dot that pops, stretches to a line, drops, and leaves
  // toward its right end (Remotion's transformOrigin: right center).
  const line = elements.get('line').props
  const y0 = line.y
  const x0 = line.x
  tl.fromTo(line, { scale: 0 }, { scale: 1, duration: T.pop, ease: 'back.out(2.2)' }, 0)
  tl.fromTo(line, { scaleX: 40 / 1180 }, { scaleX: 1, duration: T.stretch, ease: T.expoOut }, T.stretchAt)
  tl.fromTo(line, { scaleY: 1 }, { scaleY: 0.2, duration: T.thin, ease: T.expoOut }, T.stretchAt)
  tl.fromTo(line, { y: y0 }, { y: y0 + 190 * k, duration: T.drop, ease: T.expoOut }, T.dropAt)
  tl.to(line, { scaleX: 0, x: x0 + 590 * k, duration: T.leave, ease: T.expoIn }, T.leaveAt)

  // The title rises letter by letter, then leaves upward.
  tl.addLabel('title', T.titleAt)
  const segs = (elements.get('title') || {}).segments || []
  segs.forEach((seg, i) => {
    const at = T.titleAt + i * T.stagger
    tl.fromTo(
      seg,
      { y: seg.y + 380 * k, rotation: -12, opacity: 0 },
      { y: seg.y, rotation: 0, opacity: 1, duration: T.rise, ease: T.expoOut },
      at,
    )
    tl.to(seg, { y: seg.y - 380 * k, opacity: 0, duration: T.exit, ease: T.expoIn }, T.leaveAt + i * T.exitStagger)
  })

  // The subtitle's words are onFrame's; its place is its config transform,
  // because every content write re-lays it out from the config.
  const sub = elements.get('subtitle').props
  tl.to(sub, { opacity: 0, duration: T.leave, ease: T.expoIn }, T.leaveAt)

  // The red wipe grows from the centre and covers the frame.
  tl.addLabel('wipe', T.wipeAt)
  const wipe = elements.get('wipe').props
  tl.fromTo(wipe, { scale: 0 }, { scale: 1, duration: T.wipe, ease: T.inOut }, T.wipeAt)

  tl.to({}, { duration: 0.01 }, duration)
  return tl
}

function onFrame(ctx) {
  const d = ctx.data
  ctx.scene.background.set(d.ink)
  // Scramble: a typewriter whose leading edge is glyph noise, a pure
  // function of time and the words in data.
  const el = ctx.elements.get('subtitle')
  if (!el) return
  const frame = ctx.time * 30
  const n = Math.max(0, (frame - d.t.scrambleAt * 30) * 1.4)
  const text = String(d.subtitle)
  const glyphs = '!<>-_\\/[]{}=+*^?#01ABCDEFXYZ'
  let out = ''
  for (let i = 0; i < text.length; i++) {
    if (i < Math.floor(n) - 3) out += text[i]
    else if (i < n) out += text[i] === ' ' ? ' ' : glyphs[(i * 7 + Math.floor(frame)) % glyphs.length]
    else out += ' '
  }
  if (el.props.content !== out) el.props.content = out
}

const config = {
  version: 2,
  duration: f(62),
  camera: { preset: 'fullscreen' },
  fonts: [
    { family: 'Anton', weight: 400, url: 'https://assets.vos.so/fonts/anton/400.woff2' },
    { family: 'JetBrains Mono', weight: 500, url: 'https://assets.vos.so/fonts/jetbrains-mono/500.woff2' },
  ],
  elements: [
    {
      id: 'line',
      type: 'svg',
      src: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1180 40"><rect width="1180" height="40" rx="20" fill="#F2EFE8"/></svg>',
      position: 'center',
    },
    {
      id: 'title',
      type: 'text',
      content: { $data: 'title' },
      font: { family: 'Anton', size: 330, weight: 400, color: { $data: 'paper' }, letterSpacing: -4 },
      split: { type: 'chars' },
      position: 'center',
    },
    {
      id: 'subtitle',
      type: 'text',
      // Bound to the full words: onFrame writes each frame's string over
      // them, and a knob on `subtitle` changes what the scramble resolves to.
      content: { $data: 'subtitle' },
      font: { family: 'JetBrains Mono', size: 26, weight: 500, color: { $data: 'paper' }, letterSpacing: 6 },
      position: 'center',
      transform: { translateY: 238 },
    },
    {
      id: 'wipe',
      type: 'svg',
      src: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2500 2500"><circle cx="1250" cy="1250" r="1250" fill="#FF4D2E"/></svg>',
      position: 'center',
    },
  ],
  data: {
    ink: '#0B0B0F',
    paper: '#F2EFE8',
    title: 'MOTION',
    subtitle: 'A SHOWREEL WRITTEN ENTIRELY IN CODE',
    // Every timing the scene has, in seconds, from Remotion's frames.
    t: {
      pop: f(8),
      stretchAt: f(8),
      stretch: f(16),
      thin: f(8),
      dropAt: f(14),
      drop: f(14),
      titleAt: f(14),
      stagger: f(2.2),
      rise: f(16),
      scrambleAt: f(24),
      leaveAt: f(42),
      leave: f(12),
      exit: f(10),
      exitStagger: f(1.2),
      wipeAt: f(46),
      wipe: f(16),
      expoOut: EXPO_OUT,
      expoIn: EXPO_IN,
      inOut: IN_OUT,
    },
  },
  params: [
    { key: 'title', kind: 'text', default: 'MOTION', hint: 'The word that rises' },
    { key: 'subtitle', kind: 'text', default: 'A SHOWREEL WRITTEN ENTIRELY IN CODE', hint: 'The line typed under it' },
    { key: 'paper', kind: 'color', default: '#F2EFE8', hint: 'Type colour' },
    { key: 'ink', kind: 'color', default: '#0B0B0F', hint: 'Ground' },
  ],
  createContent: createContent.toString(),
  createTimeline: createTimeline.toString(),
  onFrame: onFrame.toString(),
}

for (const k of ['createContent', 'createTimeline', 'onFrame']) {
  if (config[k].includes('${')) throw new Error(`${k} holds a template literal`)
}
writeFileSync(new URL('./config.json', import.meta.url), JSON.stringify(config, null, 2))
console.log('wrote config.json')
