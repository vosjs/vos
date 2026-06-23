/**
 * Generate renderer setup code
 */
export function generateRendererSetup(): string {
  return `const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(drawingBufferWidth, drawingBufferHeight, false);
  renderer.setPixelRatio(1);
  container.appendChild(renderer.domElement);`
}
