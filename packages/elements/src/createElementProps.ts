import type * as THREE_NS from 'three'

/**
 * Create GSAP-animatable props proxy for an element.
 * For video/audio elements, pass the media element to enable currentTime
 * animation and isPaused-aware native playback (audio adds `gain` → volume).
 */
interface FrameAccurateSource {
  seekTo: (tSec: number) => Promise<void>
}

export function createElementProps(
  _THREE: typeof THREE_NS,
  mesh: THREE_NS.Mesh,
  initialX: number,
  initialY: number,
  initialOpacity = 1,
  videoElement: HTMLMediaElement | null = null,
  videoSource: FrameAccurateSource | null = null,
  videoTexture: THREE_NS.Texture | null = null,
) {
  // Capture base scale (set by renderer for resolution scaling)
  const baseScaleX = mesh.scale.x
  const baseScaleY = mesh.scale.y

  const state: Record<string, any> = {
    x: initialX,
    y: initialY,
    z: 0,
    opacity: initialOpacity,
    scale: 1,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    rotationX: 0,
    rotationY: 0,
    zIndex: mesh.userData.zIndex ?? 0,
    // Media properties (only meaningful if a media element is provided)
    currentTime: videoElement ? videoElement.currentTime : 0,
    playing: false,
    startOffset: 0,
    gain: videoElement ? videoElement.volume : 1,
  }

  const updateMeshPosition = () => {
    mesh.position.x = state.x
    mesh.position.y = -state.y
    mesh.position.z = state.z
  }

  const updateMeshTransform = () => {
    mesh.scale.set(
      baseScaleX * state.scale * state.scaleX,
      baseScaleY * state.scale * state.scaleY,
      1,
    )
    mesh.rotation.set(
      (state.rotationX * Math.PI) / 180,
      (state.rotationY * Math.PI) / 180,
      (state.rotation * Math.PI) / 180,
    )
  }

  const updateMeshOpacity = () => {
    const mat = mesh.material as THREE_NS.MeshBasicMaterial
    mat.opacity = state.opacity
    mat.needsUpdate = true
  }

  const updateVideoPlayback = () => {
    if (!videoElement) return

    // Video plays only if:
    // 1. It is marked as 'playing' (active in timeline)
    // 2. The global timeline is NOT paused
    const vos = (window as any).__vos__
    const shouldPlay = state.playing && !vos?.isPaused

    if (shouldPlay) {
      if (videoElement.paused) {
        const timeDiff = Math.abs(videoElement.currentTime - state.currentTime)
        if (timeDiff > 0.5) {
          videoElement.currentTime = state.currentTime
        }
        videoElement.play().catch(() => {})
      }
    } else {
      videoElement.pause()
      if (Math.abs(videoElement.currentTime - state.currentTime) > 0.05) {
        videoElement.currentTime = state.currentTime
      }
    }
  }

  // Register callback for global pause/resume
  if (videoElement) {
    const vos = (window as any).__vos__
    if (vos?.videoCallbacks) {
      vos.videoCallbacks.add(updateVideoPlayback)
    }
  }

  const updateVideoCurrentTime = () => {
    // Frame-accurate path: decode the exact frame and register the decode so
    // waitForVideosReady() awaits it (deterministic export/scrub).
    if (videoSource) {
      const vos = (window as any).__vos__
      const p = videoSource
        .seekTo(state.currentTime)
        .then(() => {
          if (videoTexture) videoTexture.needsUpdate = true
        })
        .catch((e: unknown) => console.error('[vos] frame decode failed', e))
      vos?.registerDecode?.(p)
      return
    }
    // Legacy HTMLVideoElement path.
    if (!videoElement) return
    const vos = (window as any).__vos__
    if (!state.playing || vos?.isPaused) {
      videoElement.currentTime = state.currentTime
    }
  }

  return new Proxy(state, {
    set(target, prop, value) {
      target[prop as string] = value
      switch (prop) {
        case 'x':
        case 'y':
        case 'z':
          updateMeshPosition()
          break
        case 'scale':
        case 'scaleX':
        case 'scaleY':
        case 'rotation':
        case 'rotationX':
        case 'rotationY':
          updateMeshTransform()
          break
        case 'opacity':
          updateMeshOpacity()
          break
        case 'zIndex':
          mesh.renderOrder = value
          mesh.userData.zIndex = value
          break
        case 'currentTime':
          updateVideoCurrentTime()
          break
        case 'playing':
        case 'startOffset':
          updateVideoPlayback()
          break
        case 'gain':
          if (videoElement) {
            videoElement.volume = Math.max(0, Math.min(1, Number(value) || 0))
          }
          break
      }
      return true
    },
    get(target, prop) {
      if (prop === 'duration' && videoElement) {
        return videoElement.duration
      }
      return target[prop as string]
    },
  })
}
