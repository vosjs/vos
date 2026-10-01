import type * as THREE_NS from 'three'

/**
 * Create GSAP-animatable props proxy for an element.
 * For video/audio elements, pass the media element to enable currentTime
 * animation and isPaused-aware native playback (audio adds `gain` → volume).
 */
interface FrameAccurateSource {
  seekTo: (tSec: number) => Promise<void>
}

/**
 * Props that require re-rasterizing a canvas-backed element (text). Writes
 * route through the instance's raster handler instead of touching the mesh.
 */
/** `[t, gain]` points over output seconds, linear between, flat outside. */
export type GainEnvelope = Array<[number, number]>

/** Evaluate an envelope (sorted points) at `t`; empty is unity. */
export function envelopeGain(env: GainEnvelope, t: number): number {
  const n = env.length
  if (!n) return 1
  if (t <= env[0][0]) return env[0][1]
  if (t >= env[n - 1][0]) return env[n - 1][1]
  let i = 1
  while (i < n - 1 && env[i][0] <= t) i++
  const [t0, g0] = env[i - 1]
  const [t1, g1] = env[i]
  return t1 <= t0 ? g1 : g0 + ((g1 - g0) * (t - t0)) / (t1 - t0)
}

const RASTER_PROPS = new Set([
  'content',
  'fontSize',
  'fontFamily',
  'fontWeight',
  'fontStyle',
  'letterSpacing',
  'color',
  'strokeColor',
  'strokeWidth',
])

/**
 * The word a split text element's units make up, as ONE thing: the
 * element's `props` write here, and every unit composes its own animated
 * state over it, so `props.x` moves the word, `props.opacity` fades it and
 * `props.scale`/`rotation` turn it about its centre while the units keep
 * animating under it through `segments`.
 */
export interface SplitGroup {
  /** The word's centre where the layout put it, in props space (y down). */
  x0: number
  y0: number
  state: {
    x: number
    y: number
    z: number
    opacity: number
    scale: number
    scaleX: number
    scaleY: number
    rotation: number
    rotationX: number
    rotationY: number
    zIndex: number
  }
  /** Each unit's recompose, called when the group changes. */
  members: Set<() => void>
}

export function createSplitGroup(
  x0: number,
  y0: number,
  zIndex = 100,
): SplitGroup {
  return {
    x0,
    y0,
    state: {
      x: x0,
      y: y0,
      z: 0,
      opacity: 1,
      scale: 1,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      rotationX: 0,
      rotationY: 0,
      zIndex,
    },
    members: new Set(),
  }
}

/**
 * Move a group to a new layout centre (a data edit rebuilt the units), keeping
 * whatever offset a tween or a drag added on top.
 */
export function relayoutSplitGroup(group: SplitGroup, x0: number, y0: number) {
  group.state.x = x0 + (group.state.x - group.x0)
  group.state.y = y0 + (group.state.y - group.y0)
  group.x0 = x0
  group.y0 = y0
  group.members.clear()
}

const GROUP_TRANSFORM = new Set([
  'x',
  'y',
  'z',
  'opacity',
  'scale',
  'scaleX',
  'scaleY',
  'rotation',
  'rotationX',
  'rotationY',
])

/** The `props` of a split text element: the group, animatable like any props. */
export function createSplitGroupProps(
  group: SplitGroup,
  units: () => THREE_NS.Mesh[],
) {
  return new Proxy(group.state as Record<string, any>, {
    set(target, prop, value) {
      target[prop as string] = value
      if (GROUP_TRANSFORM.has(prop as string)) {
        for (const recompose of group.members) recompose()
      } else if (prop === 'zIndex') {
        units().forEach((m, si) => {
          m.renderOrder = value + si * 0.001
          m.userData.zIndex = value
        })
      }
      return true
    },
  })
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
  onRasterProp: ((prop: string, value: unknown) => void) | null = null,
  gainEnvelope: GainEnvelope | null = null,
  group: SplitGroup | null = null,
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

  // A unit of a split word composes its own state over the word's (`group`):
  // its offset from the word's centre is scaled and rotated with the word,
  // then placed where the word is. Without a group the state is the mesh's.
  const updateMeshPosition = () => {
    if (!group) {
      mesh.position.x = state.x
      mesh.position.y = -state.y
      mesh.position.z = state.z
      return
    }
    const g = group.state
    const ox = (state.x - group.x0) * g.scale * g.scaleX
    const oy = -(state.y - group.y0) * g.scale * g.scaleY
    const r = (g.rotation * Math.PI) / 180
    const c = Math.cos(r)
    const s = Math.sin(r)
    mesh.position.x = g.x + ox * c - oy * s
    mesh.position.y = -g.y + ox * s + oy * c
    mesh.position.z = state.z + g.z
  }

  const updateMeshTransform = () => {
    const g = group?.state
    mesh.scale.set(
      baseScaleX * state.scale * state.scaleX * (g ? g.scale * g.scaleX : 1),
      baseScaleY * state.scale * state.scaleY * (g ? g.scale * g.scaleY : 1),
      1,
    )
    mesh.rotation.set(
      ((state.rotationX + (g?.rotationX ?? 0)) * Math.PI) / 180,
      ((state.rotationY + (g?.rotationY ?? 0)) * Math.PI) / 180,
      ((state.rotation + (g?.rotation ?? 0)) * Math.PI) / 180,
    )
  }

  const updateMeshOpacity = () => {
    const mat = mesh.material as THREE_NS.MeshBasicMaterial
    mat.opacity = state.opacity * (group ? group.state.opacity : 1)
    mat.needsUpdate = true
  }

  if (group) {
    group.members.add(() => {
      updateMeshPosition()
      updateMeshTransform()
      updateMeshOpacity()
    })
  }

  // The element's own mute (a video config's `muted`, false for audio). The
  // instance's global mute (`window.__vos__.isMuted`, set by the SET_MUTED
  // bridge command) composes on top: muted when either says so.
  const ownMuted = videoElement ? videoElement.muted : false
  const applyMuted = () => {
    if (!videoElement) return
    const vos = (window as any).__vos__
    videoElement.muted = ownMuted || !!vos?.isMuted
  }
  applyMuted()

  // Volume = props.gain × the element's gain envelope at the output time the
  // render loop publishes. Sorted once; an envelope-less element writes gain
  // straight through and never registers a frame callback.
  const envelope: GainEnvelope | null = gainEnvelope?.length
    ? gainEnvelope
        .filter(
          (p) =>
            Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]),
        )
        .map(([t, g]) => [t, Math.max(0, Math.min(1, g))] as [number, number])
        .sort((a, b) => a[0] - b[0])
    : null
  const applyGain = () => {
    if (!videoElement) return
    const g = Math.max(0, Math.min(1, Number(state.gain) || 0))
    const t = envelope ? Number((window as any).__vos__?.outputTime) || 0 : 0
    videoElement.volume = envelope ? g * envelopeGain(envelope, t) : g
  }
  if (envelope && videoElement) {
    applyGain()
    const vos = (window as any).__vos__
    vos?.frameCallbacks?.add(applyGain)
  }

  const updateVideoPlayback = () => {
    if (!videoElement) return
    applyMuted()

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
          applyGain()
          break
        default:
          // Raster props (text content/style) re-draw the element's canvas —
          // routed to the instance, which coalesces and re-rasters.
          if (onRasterProp && RASTER_PROPS.has(prop as string)) {
            onRasterProp(prop as string, value)
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
