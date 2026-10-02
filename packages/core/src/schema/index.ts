export { vosConfigSchema } from './configSchema'
export type { ValidatedVosConfig } from './configSchema'
export { vosConfigJsonSchema } from './configJsonSchema'
export type { ValidatedVosConfigJson } from './configJsonSchema'
export { isValidVosConfigJson } from './validators'
export { CURRENT_CONFIG_VERSION, migrateConfig } from './migrations'
export {
  PROGRAM_SIZE_MAX_EDGE,
  PROGRAM_SIZE_MIN_EDGE,
  aspectLabel,
  evenEdge,
  fitWithinEdges,
  programSize,
  programSizeSchema,
  resolveOutputSize,
} from './size'
export type { ProgramSize, ResolvedOutputSize } from './size'
export {
  cameraSchema,
  colorSchema,
  fogSchema,
  postprocessingSchema,
  sceneSchema,
  vec3Schema,
} from './shared'
