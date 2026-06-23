import type { CameraConfig } from '../../types'

/**
 * Generate camera setup code
 */
export function generateCameraSetup(camera: CameraConfig): string {
  const lines: string[] = []

  if (camera.preset === 'perspective') {
    const fov = camera.fov ?? 75
    const near = camera.near ?? 0.1
    const far = camera.far ?? 1000
    lines.push(
      `const camera = new THREE.PerspectiveCamera(${fov}, width / height, ${near}, ${far});`,
    )
  } else if (camera.preset === 'fullscreen') {
    // Fullscreen camera for shader materials - uses clip space
    const near = camera.near ?? 0
    const far = camera.far ?? 1
    lines.push(
      `const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, ${near}, ${far});`,
    )
    // Fullscreen camera doesn't need position/lookAt
    return lines.join('\n  ')
  } else {
    // Regular orthographic
    const zoom = camera.zoom ?? 10
    const near = camera.near ?? 0.1
    const far = camera.far ?? 1000
    lines.push(
      `const camera = new THREE.OrthographicCamera(width / -${zoom}, width / ${zoom}, height / ${zoom}, height / -${zoom}, ${near}, ${far});`,
    )
  }

  // Only for perspective and orthographic (not fullscreen)
  if (camera.position) {
    const [x, y, z] = camera.position
    lines.push(`camera.position.set(${x}, ${y}, ${z});`)
  }

  if (camera.lookAt) {
    const [x, y, z] = camera.lookAt
    lines.push(`camera.lookAt(${x}, ${y}, ${z});`)
  }

  return lines.join('\n  ')
}
