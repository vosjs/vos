import { AssetCache } from '../assetCache'
import type * as THREE_NS from 'three'

/**
 * Load and render an SVG element
 */
export async function renderSVGElement(
  element: any,
  _resolution: any,
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
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(img, 0, 0, width, height)

  URL.revokeObjectURL(url)

  const texture = new THREE.CanvasTexture(canvas)
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.needsUpdate = true

  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
  })

  const geometry = new THREE.PlaneGeometry(width, height)
  const mesh = new THREE.Mesh(geometry, material)

  return { mesh, width, height }
}
