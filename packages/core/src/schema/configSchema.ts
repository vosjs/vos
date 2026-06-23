import { z } from 'zod'
import { cameraSchema, postprocessingSchema, sceneSchema } from './shared'

// ---------------------------------------------------------------------------
// VosConfig
// ---------------------------------------------------------------------------

// Zod v4 z.function() requires args/returns — use z.custom for opaque function checks
const fnSchema = z.custom<(...args: any[]) => any>(
  (val) => typeof val === 'function',
  'Expected a function',
)

export const vosConfigSchema = z.object({
  version: z.number().int().positive(),
  duration: z.number().positive(),
  scene: sceneSchema,
  camera: cameraSchema,
  postprocessing: z.array(postprocessingSchema).optional(),
  perLayerEffects: z.array(postprocessingSchema).optional(),
  dynamicLayers: z.boolean().optional(),
  // Element validation is complex with many subtypes; start permissive
  elements: z.array(z.record(z.string(), z.any())).optional(),
  setup: fnSchema.optional(),
  createContent: fnSchema,
  createTimeline: fnSchema,
  onFrame: fnSchema.optional(),
})

export type ValidatedVosConfig = z.infer<typeof vosConfigSchema>
