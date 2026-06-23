import type { VosConfig } from '../../types'

/**
 * Generate dynamic layer rebuild function.
 *
 * When `dynamicLayers: true`, emits a `__rebuildRenderGroups()` function
 * that is called every frame in the render loop. It detects zIndex changes
 * on 3D objects and redistributes them across render groups.
 */
export function generateDynamicLayerRebuild(config: VosConfig): string {
  if (!config.dynamicLayers) return ''

  return `
  // Dynamic layer rebuild — redistributes objects when zIndex changes
  function __rebuildRenderGroups() {
    const zIndexMap = {};
    const allScenes = renderGroups.filter(g => g.type === '3d').map(g => g.scene);
    for (const s of allScenes) {
      s.traverse((obj) => {
        if (!obj.isMesh && !obj.isGroup) return;
        const z = obj.userData.zIndex ?? 0;
        if (!zIndexMap[z]) zIndexMap[z] = [];
        zIndexMap[z].push(obj);
      });
    }

    const newZIndices = Object.keys(zIndexMap).map(Number).sort((a, b) => a - b);
    const currentZIndices = renderGroups.filter(g => g.type === '3d').map(g => g.zIndex).sort((a, b) => a - b);
    if (JSON.stringify(newZIndices) === JSON.stringify(currentZIndices)) return;

    const newScenes = {};
    for (const z of newZIndices) {
      if (z === 0) {
        newScenes[z] = scene;
      } else {
        newScenes[z] = new THREE.Scene();
        if (scene.fog) newScenes[z].fog = scene.fog;
        if (scene.environment) newScenes[z].environment = scene.environment;
        const lights = scene.children.filter(c => c.isLight);
        lights.forEach(l => newScenes[z].add(l.clone()));
      }
    }

    for (const [z, objects] of Object.entries(zIndexMap)) {
      const targetScene = newScenes[Number(z)];
      objects.forEach(obj => {
        if (obj.parent !== targetScene) targetScene.add(obj);
      });
    }

    const overlayGroups = renderGroups.filter(g => g.type === '2d');
    renderGroups.length = 0;
    for (const z of newZIndices) {
      renderGroups.push({ type: '3d', zIndex: z, scene: newScenes[z] });
    }
    overlayGroups.forEach(g => renderGroups.push(g));
    renderGroups.sort((a, b) => a.zIndex - b.zIndex);
  }`
}
