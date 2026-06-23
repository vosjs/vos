import { AssetCache } from '../assetCache'
import type * as THREE_NS from 'three'

/**
 * Load and render an image element
 */
export async function renderImageElement(
  element: any,
  _resolution: any,
  THREE: typeof THREE_NS,
) {
  const { src, size = {} } = element

  let img: HTMLImageElement
  const cached = AssetCache.getImage(src)
  if (cached) {
    img = cached.element
  } else {
    img = new Image()
    img.crossOrigin = 'anonymous'
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = reject
      img.src = src
    })
  }

  let width = size.width ?? img.naturalWidth
  let height = size.height ?? img.naturalHeight

  if (size.width === 'auto' && size.height !== 'auto' && size.height) {
    const targetHeight =
      typeof size.height === 'number' ? size.height : img.naturalHeight
    width = (img.naturalWidth / img.naturalHeight) * targetHeight
    height = targetHeight
  } else if (size.height === 'auto' && size.width !== 'auto' && size.width) {
    const targetWidth =
      typeof size.width === 'number' ? size.width : img.naturalWidth
    height = (img.naturalHeight / img.naturalWidth) * targetWidth
    width = targetWidth
  }

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!

  const fit = size.fit ?? 'fill'
  if (fit === 'contain' || fit === 'cover') {
    const scale =
      fit === 'contain'
        ? Math.min(width / img.naturalWidth, height / img.naturalHeight)
        : Math.max(width / img.naturalWidth, height / img.naturalHeight)
    const drawWidth = img.naturalWidth * scale
    const drawHeight = img.naturalHeight * scale
    const offsetX = (width - drawWidth) / 2
    const offsetY = (height - drawHeight) / 2
    ctx.drawImage(img, offsetX, offsetY, drawWidth, drawHeight)
  } else {
    ctx.drawImage(img, 0, 0, width, height)
  }

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
