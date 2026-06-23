export { vosConfigSchema } from './configSchema'
export type { ValidatedVosConfig } from './configSchema'
export { vosConfigJsonSchema } from './configJsonSchema'
export type { ValidatedVosConfigJson } from './configJsonSchema'
export { isValidVosConfigJson } from './validators'
export { CURRENT_CONFIG_VERSION, migrateConfig } from './migrations'
export {
  cameraSchema,
  colorSchema,
  fogSchema,
  postprocessingSchema,
  sceneSchema,
  vec3Schema,
} from './shared'
