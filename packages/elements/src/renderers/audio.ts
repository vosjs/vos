import { AssetCache } from '../assetCache'
import type * as THREE_NS from 'three'

/** Clamp a gain value into the HTMLMediaElement volume range. */
export function clampGain(gain: unknown): number {
  const g = typeof gain === 'number' && Number.isFinite(gain) ? gain : 1
  return Math.max(0, Math.min(1, g))
}

/**
 * Audio element — no pixels, just sound synced to the master clock.
 *
 * Returns an invisible mesh (the instance contract requires one, and
 * `visible = false` keeps the editor's hit-test and selection machinery away)
 * plus an HTMLAudioElement. The shared props proxy drives the media element
 * exactly like an html5 video: `playing`/`currentTime` honor the global
 * `window.__vos__.isPaused` transport state, and `gain` maps to volume.
 */
export function renderAudioElement(config: any, THREE: typeof THREE_NS) {
  const { src, gain = 1, loop = false, startTime = 0 } = config

  const cached = AssetCache.getAudio(src)
  const audio = cached?.element ?? new Audio()
  if (!cached) {
    audio.crossOrigin = 'anonymous'
    audio.preload = 'auto'
    audio.src = src
  }
  audio.loop = loop
  audio.volume = clampGain(gain)
  if (startTime > 0) audio.currentTime = startTime

  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0 }),
  )
  mesh.visible = false

  return { mesh, width: 0, height: 0, audio }
}
