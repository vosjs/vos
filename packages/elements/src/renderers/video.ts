import { AssetCache } from '../assetCache'
import type * as THREE_NS from 'three'

/**
 * Load and render a video element
 */
export async function renderVideoElement(
  element: any,
  _resolution: any,
  THREE: typeof THREE_NS,
) {
  const {
    src,
    size = {},
    loop = true,
    muted = true,
    playbackRate = 1,
    startTime = 0,
  } = element

  let video: HTMLVideoElement
  const cached = AssetCache.getVideo(src)
  if (cached) {
    video = cached.element
    video.loop = loop
    video.muted = muted
    video.playbackRate = playbackRate
  } else {
    video = document.createElement('video')
    video.crossOrigin = 'anonymous'
    video.src = src
    video.loop = loop
    video.muted = muted
    video.playbackRate = playbackRate
    video.playsInline = true
    video.preload = 'auto'

    await new Promise<void>((resolve, reject) => {
      video.oncanplaythrough = () => resolve()
      video.onerror = reject
      video.load()
    })
  }

  video.currentTime = startTime
  video.pause()

  let width = size.width ?? video.videoWidth
  let height = size.height ?? video.videoHeight

  if (size.width === 'auto' && size.height !== 'auto' && size.height) {
    const targetHeight =
      typeof size.height === 'number' ? size.height : video.videoHeight
    width = (video.videoWidth / video.videoHeight) * targetHeight
    height = targetHeight
  } else if (size.height === 'auto' && size.width !== 'auto' && size.width) {
    const targetWidth =
      typeof size.width === 'number' ? size.width : video.videoWidth
    height = (video.videoHeight / video.videoWidth) * targetWidth
    width = targetWidth
  }

  const texture = new THREE.VideoTexture(video)
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.format = THREE.RGBAFormat
  texture.generateMipmaps = false
  texture.colorSpace = THREE.SRGBColorSpace

  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
  })

  const geometry = new THREE.PlaneGeometry(width, height)
  const mesh = new THREE.Mesh(geometry, material)

  mesh.userData.video = video
  mesh.userData.texture = texture

  return { mesh, width, height, video }
}
