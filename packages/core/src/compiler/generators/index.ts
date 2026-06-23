// Template generators for defineVos
export {
  ADDON_REGISTRY,
  POSTPROCESSING_REGISTRY,
  getRequiredAddons,
  generateAddonImports,
  getAllAddonNames,
} from '../../addons/registry'
export { generateImports } from './generateImports'
export { generateSceneSetup } from './generateSceneSetup'
export { generateCameraSetup } from './generateCameraSetup'
export { generateRendererSetup } from './generateRendererSetup'
export { generatePostprocessingSetup } from './generatePostprocessingSetup'
export { generateElementsSetup } from './generateElementsSetup'
export { generateRenderLoop } from './generateRenderLoop'
export { generateResizeHandler } from './generateResizeHandler'
export { generateCleanup } from './generateCleanup'
export { generateLayerAssignment } from './generateLayerAssignment'
export { generatePerLayerComposerSetup } from './generatePerLayerComposerSetup'
export { generateGlobalComposerSetup } from './generateGlobalComposerSetup'
export { generateDynamicLayerRebuild } from './generateDynamicLayerRebuild'
export { serializeFunction } from './serializeFunction'
