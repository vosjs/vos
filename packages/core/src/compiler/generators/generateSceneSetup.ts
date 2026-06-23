import type { SceneConfig } from '../../types'

/**
 * Generate scene setup code
 */
export function generateSceneSetup(scene?: SceneConfig): string {
  const lines = ['const scene = new THREE.Scene();']

  if (scene?.background !== undefined) {
    const bg =
      typeof scene.background === 'string'
        ? `"${scene.background}"`
        : `0x${scene.background.toString(16).padStart(6, '0')}`
    lines.push(`scene.background = new THREE.Color(${bg});`)
  }

  if (scene?.fog) {
    const fogColor =
      typeof scene.fog.color === 'string'
        ? `"${scene.fog.color}"`
        : `0x${scene.fog.color.toString(16).padStart(6, '0')}`

    if (scene.fog.type === 'exp2') {
      lines.push(
        `scene.fog = new THREE.FogExp2(${fogColor}, ${scene.fog.density});`,
      )
    } else {
      lines.push(
        `scene.fog = new THREE.Fog(${fogColor}, ${scene.fog.near}, ${scene.fog.far});`,
      )
    }
  }

  return lines.join('\n  ')
}
