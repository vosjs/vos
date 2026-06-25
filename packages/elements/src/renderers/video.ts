import { AssetCache } from '../assetCache'
import {
  FrameAccurateVideoSource,
  isFrameAccurateSupported,
} from '../video/FrameAccurateVideoSource'
import type * as THREE_NS from 'three'

/** Resolve element dimensions from an intrinsic w/h + optional size config (with 'auto'). */
function resolveSize(size: any, intrinsicW: number, intrinsicH: number) {
  let width = size.width ?? intrinsicW
  let height = size.height ?? intrinsicH
  if (size.width === 'auto' && size.height !== 'auto' && size.height) {
    const targetHeight = typeof size.height === 'number' ? size.height : intrinsicH
    width = (intrinsicW / intrinsicH) * targetHeight
    height = targetHeight
  } else if (size.height === 'auto' && size.width !== 'auto' && size.width) {
    const targetWidth = typeof size.width === 'number' ? size.width : intrinsicW
    height = (intrinsicH / intrinsicW) * targetWidth
    width = targetWidth
  }
  return { width, height }
}

function applyTextureSettings(texture: THREE_NS.Texture, THREE: typeof THREE_NS) {
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.format = THREE.RGBAFormat
  texture.generateMipmaps = false
  texture.colorSpace = THREE.SRGBColorSpace
}

/**
 * Load and render a video element.
 *
 * `frameSource`:
 *  - 'html5' (default): HTMLVideoElement + VideoTexture (legacy; currentTime sync, NOT frame-accurate)
 *  - 'webcodecs': frame-accurate WebCodecs decode (deterministic export/scrub)
 *  - 'auto': webcodecs when supported, else html5
 */
export async function renderVideoElement(
  element: any,
  _resolution: any,
  THREE: typeof THREE_NS,
) {
  const frameSource: string = element.frameSource ?? 'html5'
  const useWebCodecs =
    frameSource === 'webcodecs' ||
    (frameSource === 'auto' && isFrameAccurateSupported())

  // ---- Frame-accurate WebCodecs path ----------------------------------------
  // On any failure (non-MP4 container, unsupported codec, decode error) we fall
  // through to the robust HTMLVideoElement path instead of failing the element —
  // black video is never an acceptable outcome.
  if (useWebCodecs) {
    try {
      return await renderWebCodecsVideo(element, THREE)
    } catch (err) {
      console.warn(
        '[vos] frame-accurate video unavailable; falling back to html5 —',
        err instanceof Error ? err.message : err,
      )
    }
  }

  return renderHtml5Video(element, THREE)
}

async function renderWebCodecsVideo(element: any, THREE: typeof THREE_NS) {
  const { src, size = {} } = element
  const source = await FrameAccurateVideoSource.create(src)
  const { width, height } = resolveSize(size, source.codedWidth, source.codedHeight)

  const texture = new THREE.CanvasTexture(source.canvas)
  applyTextureSettings(texture, THREE)

  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
  })
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material)
  mesh.userData.videoSource = source
  mesh.userData.texture = texture
  texture.needsUpdate = true // initial frame drawn at t=0 by create()

  return { mesh, width, height, video: null, videoSource: source, texture }
}

// ---- Legacy HTMLVideoElement path -------------------------------------------
async function renderHtml5Video(element: any, THREE: typeof THREE_NS) {
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

  const { width, height } = resolveSize(size, video.videoWidth, video.videoHeight)

  const texture = new THREE.VideoTexture(video)
  applyTextureSettings(texture, THREE)

  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
  })
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material)
  mesh.userData.video = video
  mesh.userData.texture = texture

  return { mesh, width, height, video, videoSource: null, texture }
}
