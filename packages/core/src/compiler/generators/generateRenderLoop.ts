import type { VosConfig } from '../../types'

/**
 * Generate render loop code
 *
 * Renders the main 3D scene first, then overlays the 2D elements scene
 * on top without clearing the framebuffer.
 */
export function generateRenderLoop(config: VosConfig): string {
  const hasComposer = config.postprocessing?.length
  const hasPerLayer = !!config.perLayerEffects?.length
  const hasOnFrame = !!config.onFrame
  // A stack entry's onFrame runs after the main program's, on the same delta.
  const hasStackFrame = !!config.stack?.some((e) => !!e.onFrame)
  const hasDynamic = !!config.dynamicLayers
  const hasRetime = !!config.retime

  // Main 3D render - use composer if post-processing is enabled
  const mainRenderCall = hasComposer
    ? 'composer.render();'
    : 'renderer.render(scene, camera);'

  const onFrameCall =
    hasOnFrame || hasStackFrame
      ? `
    timer.update();
    const deltaTime = timer.getDelta();${hasOnFrame ? '\n    onFrame(context, content, deltaTime);' : ''}${hasStackFrame ? '\n    __stackFrame(deltaTime);' : ''}`
      : ''

  const clockDecl =
    hasOnFrame || hasStackFrame ? 'const timer = new THREE.Timer();' : ''
  const dynamicRebuild = hasDynamic ? '\n    __rebuildRenderGroups();' : ''

  // 3D group rendering — select the right path based on features
  let render3dGroup: string
  if (hasPerLayer && hasComposer) {
    // Full path: per-layer blit + global composite awareness
    render3dGroup = `if (group.composer) {
          group.composer.render();
          renderer.clearDepth();
          blitMaterial.map = group.composer.readBuffer.texture;
          blitMaterial.needsUpdate = true;
          renderer.render(blitScene, blitCamera);
        } else if (!__useGlobalPath && group.zIndex === 0) {
          ${mainRenderCall}
        } else if (group.scene.children.length > 0) {
          renderer.render(group.scene, camera);
        }`
  } else if (hasPerLayer) {
    // Per-layer only, no global postprocessing
    render3dGroup = `if (group.composer) {
          group.composer.render();
          renderer.clearDepth();
          blitMaterial.map = group.composer.readBuffer.texture;
          blitMaterial.needsUpdate = true;
          renderer.render(blitScene, blitCamera);
        } else if (group.zIndex === 0) {
          renderer.render(scene, camera);
        } else if (group.scene.children.length > 0) {
          renderer.render(group.scene, camera);
        }`
  } else if (hasComposer) {
    // Global postprocessing, no per-layer
    render3dGroup = `if (!__useGlobalPath && group.zIndex === 0) {
          ${mainRenderCall}
        } else if (group.scene.children.length > 0) {
          renderer.render(group.scene, camera);
        }`
  } else {
    // No postprocessing at all
    render3dGroup = `if (group.zIndex === 0) {
          renderer.render(scene, camera);
        } else if (group.scene.children.length > 0) {
          renderer.render(group.scene, camera);
        }`
  }

  // Global composite redirect (Phase 3c)
  const globalPre = hasComposer
    ? `
    if (__useGlobalPath) {
      renderer.setRenderTarget(compositeTarget);
    }`
    : ''

  const globalPost = hasComposer
    ? `
    if (__useGlobalPath) {
      renderer.setRenderTarget(null);
      globalComposer.render();
    }`
    : ''

  return `
  ${clockDecl}
  let frameId;
  // One synchronous engine tick: sync objects, publish the clock, run
  // per-frame code, draw every render group. Exposed on the result as
  // renderFrame so capture harnesses can drive frames directly instead of
  // waiting for the compositor's vsync-locked rAF — evaluation stays a pure
  // function of the timeline position either way.
  const renderFrame = () => {
    __syncObjects();

    // Publish the master clock: ctx.time / ctx.progress track the GSAP timeline
    // (time within the current cycle). Assigned before onFrame so per-frame code
    // reads the position being rendered — output stays a pure fn of (data, time).${
      hasRetime
        ? `
    // retime: the OUTPUT clock advances; the program's own timeline is seeked
    // at retime(outputTime, data) each frame, so frames stay a pure fn of
    // (data, output time) and every capture path is exact by construction.
    currentOutputTime = __clock.time();
    currentTime = __retimeAt(currentOutputTime);
    tl.seek(currentTime, false);
    currentProgress = __clock.progress();`
        : `
    currentOutputTime = currentTime = tl.time();
    currentProgress = tl.progress();`
    }${onFrameCall}${dynamicRebuild}

    renderer.autoClear = false;${globalPre}
    renderer.clear();

    for (let gi = 0; gi < renderGroups.length; gi++) {
      const group = renderGroups[gi];
      if (gi > 0) renderer.clearDepth();

      if (group.type === '3d') {
        ${render3dGroup}
      } else if (group.scene.children.length > 0) {
        renderer.render(group.scene, overlayCamera);
      }
    }
${globalPost}
    renderer.autoClear = true;
  };
  const animate = () => {
    frameId = requestAnimationFrame(animate);
    renderFrame();
  };
  animate();`
}
