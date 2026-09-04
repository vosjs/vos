/**
 * The card on a gradient: the release's shot centred on a soft mesh
 * gradient (three blurred blobs of the brand's colours over its ground,
 * with grain), rounded, with a faint shadow, and no words. The layout
 * every screenshot beautifier and example gallery defaults to, and the
 * store's tile rule (no text, fill the region, subject centred). A wide
 * frame that cannot hold the whole card gives it headroom and runs it off
 * the bottom.
 */
const GROUND = `(ctx) => {
  const THREE = ctx.THREE
  const d = ctx.data
  const canvas = document.createElement('canvas')
  canvas.width = 1280
  canvas.height = 720
  const c = canvas.getContext('2d')
  c.fillStyle = d.bgA
  c.fillRect(0, 0, 1280, 720)
  const blob = (x, y, r, color) => {
    const g = c.createRadialGradient(x, y, 0, x, y, r)
    g.addColorStop(0, color)
    g.addColorStop(1, 'rgba(0,0,0,0)')
    c.fillStyle = g
    c.fillRect(0, 0, 1280, 720)
  }
  blob(180, 120, 760, d.blobA)
  blob(1120, 620, 820, d.blobB)
  blob(760, 60, 620, d.blobC)
  let seed = 7
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
  const shot = elements.get('shot')
  if (shot) tl.fromTo(shot.props, { opacity: 0, translateY: 30, scale: 0.97 }, { opacity: 1, translateY: 0, scale: 1, duration: 1.0, ease: 'power3.out' }, 0.2)
  return tl
}`

export function cardOnGradient(): Record<string, unknown> {
  return {
    version: 2,
    duration: 4,
    camera: { preset: 'fullscreen' },
    template: {
      family: 'card-on-gradient',
      slots: [{ id: 'shot', kind: 'image', required: true }],
      params: { required: [], brand: ['bgA', 'blobA', 'blobB', 'blobC', 'grain'] },
      text: [],
      layouts: {
        landscape: { slots: { shot: { x: 0.09, y: 0.12, w: 0.82 } } },
        square: { slots: { shot: { x: 0.08, y: 0.27, w: 0.84 } } },
        portrait: { slots: { shot: { x: 0.06, y: 0.3, w: 0.88 } } },
      },
    },
    params: [
      { key: 'bgA', type: 'color', label: 'Ground', default: '#f3efe8' },
      { key: 'blobA', type: 'color', label: 'Blob A', default: 'rgba(255,183,146,0.55)' },
      { key: 'blobB', type: 'color', label: 'Blob B', default: 'rgba(170,196,255,0.5)' },
      { key: 'blobC', type: 'color', label: 'Blob C', default: 'rgba(255,236,170,0.45)' },
      { key: 'grain', type: 'number', label: 'Grain', default: 14, min: 0, max: 40, step: 1 },
    ],
    data: {
      bgA: '#f3efe8',
      blobA: 'rgba(255,183,146,0.55)',
      blobB: 'rgba(170,196,255,0.5)',
      blobC: 'rgba(255,236,170,0.45)',
      grain: 14,
    },
    elements: [
      {
        type: 'image',
        id: 'shot',
        src: '',
        position: { x: '9%', y: '12%' },
        anchor: 'top-left',
        size: { width: 1574, height: 'auto', fit: 'contain' },
        zIndex: 60,
        opacity: 0,
      },
    ],
    createContent: GROUND,
    createTimeline: TIMELINE,
  }
}
