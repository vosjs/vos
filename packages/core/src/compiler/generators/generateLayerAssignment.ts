/**
 * Generate layer assignment code that runs after createContent.
 *
 * Scans the 3D scene for objects with `userData.zIndex`, moves them
 * into separate scenes, and rebuilds the renderGroups array so the
 * render loop composites everything in zIndex order.
 *
 * Emitted as a function so a live content rebuild (setData on a program
 * without onFrame) can run it again: `__resetLayers()` restores the groups
 * that existed before the first assignment (disposing any per-layer
 * composer the dropped groups owned), then `__assignLayers()` redistributes
 * the new content.
 */
export function generateLayerAssignment(): string {
  return `
  // Layer assignment — redistribute 3D objects by userData.zIndex.
  // Runs once at init and again on a live content rebuild.
  const __baseGroups = [...renderGroups];
  function __resetLayers() {
    for (const g of renderGroups) {
      if (g.composer && __baseGroups.indexOf(g) === -1) {
        g.composer.renderTarget1.dispose();
        g.composer.renderTarget2.dispose();
      }
    }
    renderGroups.length = 0;
    __baseGroups.forEach(g => renderGroups.push(g));
  }
  function __assignLayers() {
    const layerObjects = {};
    for (let ci = scene.children.length - 1; ci >= 0; ci--) {
      const child = scene.children[ci];
      if (child.userData.zIndex !== undefined && child.userData.zIndex !== 0) {
        const z = child.userData.zIndex;
        if (!layerObjects[z]) layerObjects[z] = [];
        layerObjects[z].push(child);
      }
    }

    const layerZIndices = Object.keys(layerObjects).map(Number).sort((a, b) => a - b);
    if (layerZIndices.length > 0) {
      const sceneLights = scene.children.filter(c => c.isLight);

      const newGroups = [];
      for (const z of layerZIndices) {
        const layerScene = new THREE.Scene();
        if (scene.fog) layerScene.fog = scene.fog;
        if (scene.environment) layerScene.environment = scene.environment;
        sceneLights.forEach(light => layerScene.add(light.clone()));
        layerObjects[z].forEach(obj => layerScene.add(obj));
        newGroups.push({ type: '3d', zIndex: z, scene: layerScene });
      }

      const existingGroups = [...renderGroups];
      renderGroups.length = 0;
      [...existingGroups, ...newGroups]
        .sort((a, b) => a.zIndex - b.zIndex)
        .forEach(g => renderGroups.push(g));
    }
  }
  __assignLayers();`
}
