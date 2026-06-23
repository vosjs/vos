import { generateEffectFactoryCode } from '../../addons/registry'
import type { VosConfig } from '../../types'

/**
 * Generate per-layer composer setup code.
 *
 * Creates blit quad infrastructure and per-layer EffectComposers for
 * non-primary 3D render groups that have userData.postprocessing.
 * Runs after layer assignment (after createContent).
 */
export function generatePerLayerComposerSetup(config: VosConfig): string {
  if (!config.perLayerEffects?.length) return ''

  const factoryCode = generateEffectFactoryCode(config.perLayerEffects)

  return `
  // Per-layer composer setup
  const __effectFactory = ${factoryCode};

  // Blit infrastructure for compositing per-layer composer output
  const blitScene = new THREE.Scene();
  const blitCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const blitMaterial = new THREE.MeshBasicMaterial({
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
  });
  blitScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), blitMaterial));

  // Create per-layer composers for non-primary 3D groups with userData.postprocessing
  for (const group of renderGroups) {
    if (group.type !== '3d' || group.zIndex === 0) continue;

    const effects = [];
    group.scene.traverse((obj) => {
      if (obj.userData?.postprocessing) {
        for (const eff of obj.userData.postprocessing) effects.push(eff);
      }
    });
    if (effects.length === 0) continue;

    // Deduplicate by type, last-write-wins
    const effectMap = {};
    for (const eff of effects) effectMap[eff.type] = eff;

    const layerComposer = new EffectComposer(renderer);
    layerComposer.renderToScreen = false;
    layerComposer.addPass(new RenderPass(group.scene, camera));

    for (const eff of Object.values(effectMap)) {
      const factory = __effectFactory[eff.type];
      if (factory) layerComposer.addPass(factory(eff));
    }

    group.composer = layerComposer;
  }`
}
