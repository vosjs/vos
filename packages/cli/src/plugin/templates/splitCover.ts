/**
 * The split cover: a headline column on a grained two-stop gradient, the
 * release's shot at the right in a slight perspective, bled off the right
 * and the bottom; the wordmark low-left. The layout premium launch covers
 * share (a serif headline over three lines at about 40% of the height,
 * the visual leading, the type supporting). Every word, colour and face is
 * a data binding, so the brand kit and the release fill it without a
 * recompile; the filler places the shot per aspect.
 */
const GROUND = `(ctx) => {
  const THREE = ctx.THREE
  const d = ctx.data
  const canvas = document.createElement('canvas')
  canvas.width = 1280
  canvas.height = 720
  const c = canvas.getContext('2d')
  const g = c.createLinearGradient(0, 0, 1280, 720)
  g.addColorStop(0, d.bgA)
  g.addColorStop(0.55, d.bgB)
  g.addColorStop(1, d.bgC)
  c.fillStyle = g
  c.fillRect(0, 0, 1280, 720)
  const rg = c.createRadialGradient(980, 120, 40, 980, 120, 820)
  rg.addColorStop(0, d.streak)
  rg.addColorStop(1, 'rgba(0,0,0,0)')
  c.fillStyle = rg
  c.fillRect(0, 0, 1280, 720)
  let seed = 41
  const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }
  const img = c.getImageData(0, 0, 1280, 720)
  const px = img.data
  const grain = d.grain
  for (let i = 0; i < px.length; i += 4) {
    const n = (rand() - 0.5) * grain
    px[i] += n; px[i + 1] += n; px[i + 2] += n
  }
  c.putImageData(img, 0, 0)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.MeshBasicMaterial({ map: tex, depthTest: false }),
  )
  plane.renderOrder = -10
  ctx.scene.add(plane)
  return { refs: { plane }, dispose: () => { tex.dispose(); plane.geometry.dispose(); plane.material.dispose() } }
}`

const TIMELINE = `(ctx, content, duration) => {
  const { gsap, elements } = ctx
  const tl = gsap.timeline({ paused: true })
  const kicker = elements.get('kicker')
  const title = elements.get('title')
  const brand = elements.get('brand')
  const shot = elements.get('shot')
  if (kicker) tl.fromTo(kicker.props, { opacity: 0, translateY: 14 }, { opacity: 1, translateY: 0, duration: 0.7, ease: 'power2.out' }, 0.25)
  if (title) tl.fromTo(title.props, { opacity: 0, translateY: 26 }, { opacity: 1, translateY: 0, duration: 0.9, ease: 'power3.out' }, 0.45)
  if (brand) tl.fromTo(brand.props, { opacity: 0 }, { opacity: 1, duration: 0.8, ease: 'power2.out' }, 0.9)
  if (shot) tl.fromTo(shot.props, { opacity: 0, translateX: 70 }, { opacity: 1, translateX: 0, duration: 1.1, ease: 'power3.out' }, 0.55)
  return tl
}`

export function splitCover(): Record<string, unknown> {
  return {
    version: 2,
    duration: 6,
    camera: { preset: 'fullscreen' },
    fonts: [
      { family: 'Fraunces', url: 'https://assets.vos.so/fonts/fraunces/600.woff2', weight: 600 },
      { family: 'Lexend', url: 'https://assets.vos.so/fonts/lexend/700.woff2', weight: 700 },
      { family: 'JetBrains Mono', url: 'https://assets.vos.so/fonts/jetbrains-mono/400.woff2', weight: 400 },
    ],
    template: {
      family: 'split-cover',
      slots: [{ id: 'shot', kind: 'image', required: true }],
      params: {
        required: ['headline', 'brand'],
        brand: ['bgA', 'bgB', 'bgC', 'ink', 'inkSoft', 'accent', 'streak', 'fontDisplay', 'fontBody', 'grain'],
      },
      text: [
        { element: 'title', param: 'headline', role: 'headline', maxWords: 8, lines: 3 },
        { element: 'kicker', param: 'kicker', role: 'body' },
        { element: 'brand', param: 'brand', role: 'body' },
      ],
      layouts: {
        landscape: {
          slots: { shot: { x: 0.46, y: 0.28, w: 1.02 } },
          text: { kicker: { x: '7%', y: '24%' }, title: { x: '7%', y: '44%' }, brand: { x: '7%', y: '86%' } },
          size: { title: 84, kicker: 19, brand: 25 },
        },
        square: {
          slots: { shot: { x: 0.1, y: 0.5, w: 1.0 } },
          text: { kicker: { x: '8%', y: '12%' }, title: { x: '8%', y: '27%' }, brand: { x: '8%', y: '93%' } },
          size: { title: 72, kicker: 18, brand: 23 },
        },
        portrait: {
          slots: { shot: { x: 0.08, y: 0.44, w: 1.06 } },
          text: { kicker: { x: '8%', y: '12%' }, title: { x: '8%', y: '26%' }, brand: { x: '8%', y: '94%' } },
          size: { title: 64, kicker: 17, brand: 22 },
        },
      },
    },
    params: [
      { key: 'kicker', type: 'text', label: 'Kicker', default: 'RELEASE' },
      { key: 'headline', type: 'text', label: 'Headline', default: 'What shipped,\nin three lines' },
      { key: 'brand', type: 'text', label: 'Wordmark', default: 'brand' },
      { key: 'bgA', type: 'color', label: 'Ground A', default: '#8a3d2a' },
      { key: 'bgB', type: 'color', label: 'Ground B', default: '#c0632f' },
      { key: 'bgC', type: 'color', label: 'Ground C', default: '#5c5a2e' },
      { key: 'ink', type: 'color', label: 'Ink', default: '#fff6ec' },
      { key: 'inkSoft', type: 'color', label: 'Ink, softened', default: '#e9d9c8' },
      { key: 'streak', type: 'color', label: 'Light streak', default: 'rgba(255,220,170,0.18)' },
      { key: 'fontDisplay', type: 'text', label: 'Headline face', default: 'Fraunces, serif' },
      { key: 'fontBody', type: 'text', label: 'Body face', default: 'Lexend, sans-serif' },
      { key: 'grain', type: 'number', label: 'Grain', default: 22, min: 0, max: 40, step: 1 },
    ],
    data: {
      kicker: 'RELEASE',
      headline: 'What shipped,\nin three lines',
      brand: 'brand',
      bgA: '#8a3d2a',
      bgB: '#c0632f',
      bgC: '#5c5a2e',
      ink: '#fff6ec',
      inkSoft: '#e9d9c8',
      streak: 'rgba(255,220,170,0.18)',
      fontDisplay: 'Fraunces, serif',
      fontBody: 'Lexend, sans-serif',
      grain: 22,
    },
    elements: [
      {
        type: 'text',
        id: 'kicker',
        content: { $data: 'kicker' },
        position: { x: '7%', y: '24%' },
        anchor: 'center-left',
        font: { family: 'JetBrains Mono, monospace', size: 19, weight: 400, color: { $data: 'inkSoft' }, letterSpacing: 6, align: 'left' },
        opacity: 0,
      },
      {
        type: 'text',
        id: 'title',
        content: { $data: 'headline' },
        position: { x: '7%', y: '44%' },
        anchor: 'center-left',
        font: { family: { $data: 'fontDisplay' }, size: 84, weight: 600, color: { $data: 'ink' }, lineHeight: 1.08, align: 'left', letterSpacing: 0 },
        opacity: 0,
      },
      {
        type: 'text',
        id: 'brand',
        content: { $data: 'brand' },
        position: { x: '7%', y: '86%' },
        anchor: 'center-left',
        font: { family: { $data: 'fontBody' }, size: 25, weight: 700, color: { $data: 'ink' }, letterSpacing: 1, align: 'left' },
        opacity: 0,
      },
      {
        type: 'image',
        id: 'shot',
        src: '',
        position: { x: '46%', y: '28%' },
        anchor: 'top-left',
        size: { width: 1400, height: 'auto', fit: 'contain' },
        zIndex: 60,
        opacity: 0,
      },
    ],
    createContent: GROUND,
    createTimeline: TIMELINE,
  }
}
