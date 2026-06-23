import type { VosConfig } from '../../types'

/**
 * Generate resize handler code
 *
 * Updates both the main 3D camera and the 2D overlay camera.
 */
export function generateResizeHandler(config: VosConfig): string {
  const hasComposer = config.postprocessing?.length
  const composerResize = hasComposer
    ? '\n    composer.setSize(bufferW, bufferH);'
    : ''

  const perLayerResize = config.perLayerEffects?.length
    ? '\n    for (const g of renderGroups) { if (g.composer) g.composer.setSize(bufferW, bufferH); }'
    : ''

  const globalResize = hasComposer
    ? '\n    if (compositeTarget) compositeTarget.setSize(bufferW, bufferH);\n    if (globalComposer) globalComposer.setSize(bufferW, bufferH);'
    : ''

  // Overlay camera update (same for all main camera types)
  const overlayResize = `
    overlayCamera.left = -w / 2;
    overlayCamera.right = w / 2;
    overlayCamera.top = h / 2;
    overlayCamera.bottom = -h / 2;
    overlayCamera.updateProjectionMatrix();`

  const isPerspective = config.camera.preset === 'perspective'
  const isFullscreen = config.camera.preset === 'fullscreen'

  // Fullscreen cameras need resize handling to update shader uniforms
  if (isFullscreen) {
    return `
  const handleResize = () => {
    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;
    const bufferW = Math.floor(w * pixelRatio);
    const bufferH = Math.floor(h * pixelRatio);
    renderer.setSize(bufferW, bufferH, false);${composerResize}${perLayerResize}${globalResize}${overlayResize}

    if (content?.refs?.uniforms?.iResolution) {
      content.refs.uniforms.iResolution.value.set(bufferW, bufferH, 1);
    }
  };
  window.addEventListener('resize', handleResize);`
  }

  if (isPerspective) {
    return `
  const handleResize = () => {
    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;
    const bufferW = Math.floor(w * pixelRatio);
    const bufferH = Math.floor(h * pixelRatio);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(bufferW, bufferH, false);${composerResize}${perLayerResize}${globalResize}${overlayResize}
  };
  window.addEventListener('resize', handleResize);`
  }

  // Orthographic camera
  const zoom = (config.camera as { zoom?: number }).zoom ?? 10
  return `
  const handleResize = () => {
    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;
    const bufferW = Math.floor(w * pixelRatio);
    const bufferH = Math.floor(h * pixelRatio);
    camera.left = w / -${zoom};
    camera.right = w / ${zoom};
    camera.top = h / ${zoom};
    camera.bottom = h / -${zoom};
    camera.updateProjectionMatrix();
    renderer.setSize(bufferW, bufferH, false);${composerResize}${perLayerResize}${globalResize}${overlayResize}
  };
  window.addEventListener('resize', handleResize);`
}
