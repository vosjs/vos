import { z } from 'zod'
import { cameraSchema, postprocessingSchema, sceneSchema } from './shared'

// ---------------------------------------------------------------------------
// VosConfigJson - functions stored as strings
// ---------------------------------------------------------------------------

export const vosConfigJsonSchema = z.object({
  version: z.number().int().positive(),
  duration: z.number().positive(),
  scene: sceneSchema,
  camera: cameraSchema,
  postprocessing: z.array(postprocessingSchema).optional(),
  perLayerEffects: z.array(postprocessingSchema).optional(),
  dynamicLayers: z.boolean().optional(),
  // Element validation is complex with many subtypes; start permissive
  elements: z.array(z.record(z.string(), z.any())).optional(),
  // Arbitrary, app-defined input data exposed as ctx.data (no shape imposed)
  data: z.record(z.string(), z.unknown()).optional(),
  // Functions as strings
  setup: z.string().optional(),
  createContent: z.string(),
  createTimeline: z.string(),
  onFrame: z.string().optional(),
})

export type ValidatedVosConfigJson = z.infer<typeof vosConfigJsonSchema>
