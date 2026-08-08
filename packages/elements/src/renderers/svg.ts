import { AssetCache } from '../assetCache'
import { clampRasterScale, rasterScaleFor } from '../textLayout'
import type * as THREE_NS from 'three'

/**
 * Load and render an SVG element.
 *
 * SVG is vector input: rasterize it at the drawing-buffer texel density
 * (design-px geometry, buffer-density canvas) so it stays resolution
 * independent instead of being magnified from its viewBox size.
 */
export async function renderSVGElement(
  element: any,
  resolution: any,
  THREE: typeof THREE_NS,
) {
  const { src, size = {}, colors = {} } = element

  let svgContent = AssetCache.getSVG(src)
  if (!svgContent) {
    if (src.startsWith('http') || src.startsWith('/')) {
      const response = await fetch(src)
      svgContent = await response.text()
    } else {
      svgContent = src
    }
  }

  Object.entries(colors).forEach(([selector, color]) => {
    const regex = new RegExp(`(${selector}[^>]*)(fill|stroke)="[^"]*"`, 'g')
    svgContent = svgContent!.replace(regex, `$1$2="${color}"`)
  })

  const parser = new DOMParser()
  const svgDoc = parser.parseFromString(svgContent!, 'image/svg+xml')
  const svgElement = svgDoc.documentElement

  const viewBox = svgElement.getAttribute('viewBox')
  let svgWidth = parseFloat(svgElement.getAttribute('width') || '') || 100
  let svgHeight = parseFloat(svgElement.getAttribute('height') || '') || 100

  if (viewBox) {
    const [, , vbW, vbH] = viewBox.split(' ').map(Number)
    svgWidth = vbW || svgWidth
    svgHeight = vbH || svgHeight
  }

  let width = size.width ?? svgWidth
  let height = size.height ?? svgHeight

  if (size.width === 'auto' && size.height !== 'auto' && size.height) {
    width = (svgWidth / svgHeight) * size.height
  } else if (size.height === 'auto' && size.width !== 'auto' && size.width) {
    height = (svgHeight / svgWidth) * size.width
  }

  // Raster the SVG oversized so the browser scales the VECTOR, not pixels.
  const scaleFor = (res: any) =>
    clampRasterScale(rasterScaleFor(res), width, height, res?.maxTextureSize)
  let rasterScale = scaleFor(resolution)

  svgElement.setAttribute('width', String(width))
  svgElement.setAttribute('height', String(height))
  const updatedSvg = new XMLSerializer().serializeToString(svgElement)

  const blob = new Blob([updatedSvg], { type: 'image/svg+xml' })
  const url = URL.createObjectURL(blob)

  const img = new Image()
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = reject
    img.src = url
  })

  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')!
  const draw = (rs: number) => {
    canvas.width = Math.max(1, Math.round(width * rs))
    canvas.height = Math.max(1, Math.round(height * rs))
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  }
  draw(rasterScale)

  const makeTexture = (res: any) => {
    const texture = new THREE.CanvasTexture(canvas)
    texture.generateMipmaps = true
    texture.minFilter = THREE.LinearMipmapLinearFilter
    texture.magFilter = THREE.LinearFilter
    texture.anisotropy = Math.min(8, res?.maxAnisotropy ?? 1)
    texture.needsUpdate = true
    return texture
  }

  const material = new THREE.MeshBasicMaterial({
    map: makeTexture(resolution),
    transparent: true,
    depthWrite: false,
  })

  // Geometry stays in DESIGN units; only texture density tracks resolution.
  const geometry = new THREE.PlaneGeometry(width, height)
  const mesh = new THREE.Mesh(geometry, material)

  const rerasterize = (res: any) => {
    const next = scaleFor(res)
    if (Math.abs(next - rasterScale) / rasterScale < 0.05) return false
    rasterScale = next
    draw(next)
    const old = material.map
    material.map = makeTexture(res)
    old?.dispose()
    return true
  }

  return { mesh, width, height, rerasterize }
}
