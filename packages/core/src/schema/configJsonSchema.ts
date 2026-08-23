import { z } from 'zod'
import { cameraSchema, postprocessingSchema, sceneSchema } from './shared'

// ---------------------------------------------------------------------------
// Elements — text is the first element type with a real schema. Every object
// is passthrough (nothing is ever stripped), and the union falls back to the
// permissive record so historically-accepted configs keep validating: this
// schema documents and type-checks the well-formed shape without rejecting.
// ---------------------------------------------------------------------------

/**
 * `{$data: key}` — the value resolves from the host's data object at render
 * time and re-resolves on setData. Allowed on `content`, `font.family` and
 * `font.color`; because the binding lives in the program, remixing the bound
 * value is a pure data edit (no recompile).
 */
export const dataRefSchema = z
  .object({ $data: z.string().min(1) })
  .passthrough()

const textFontSchema = z
  .object({
    family: z.union([z.string(), dataRefSchema]).optional(),
    size: z.number().positive().optional(),
    weight: z.union([z.number(), z.string()]).optional(),
    style: z.enum(['normal', 'italic']).optional(),
    color: z.union([z.string(), dataRefSchema]).optional(),
    letterSpacing: z.number().optional(),
    lineHeight: z.number().positive().optional(),
    align: z.enum(['left', 'center', 'right']).optional(),
  })
  .passthrough()

export const textElementSchema = z
  .object({
    type: z.literal('text'),
    content: z.union([z.string(), dataRefSchema]),
    font: textFontSchema.optional(),
    stroke: z
      .object({ color: z.string(), width: z.number().nonnegative() })
      .passthrough()
      .optional(),
    shadow: z
      .object({
        color: z.string(),
        blur: z.number().nonnegative(),
        offsetX: z.number().optional(),
        offsetY: z.number().optional(),
      })
      .passthrough()
      .optional(),
    split: z
      .object({ type: z.enum(['chars', 'words', 'lines']) })
      .passthrough()
      .optional(),
  })
  .passthrough()

const elementSchema = z.union([
  textElementSchema,
  // Other subtypes stay permissive for now.
  z.record(z.string(), z.any()),
])

export const fontFaceDeclSchema = z
  .object({
    family: z.string().min(1),
    url: z.string().min(1),
    weight: z.union([z.number(), z.string()]).optional(),
    style: z.enum(['normal', 'italic']).optional(),
  })
  .passthrough()

// ---------------------------------------------------------------------------
// VosConfigJson - functions stored as strings
// ---------------------------------------------------------------------------

export const vosConfigJsonSchema = z.object({
  // Required: this schema describes the CANONICAL shape, and every caller
  // migrates before parsing (that is where an absent version is stamped).
  version: z.number().int().positive(),
  duration: z.number().positive(),
  scene: sceneSchema,
  camera: cameraSchema,
  postprocessing: z.array(postprocessingSchema).optional(),
  perLayerEffects: z.array(postprocessingSchema).optional(),
  dynamicLayers: z.boolean().optional(),
  // Text elements validate for real (with a permissive fallback); other
  // subtypes stay permissive until they earn schemas.
  elements: z.array(elementSchema).optional(),
  objects: z.array(z.record(z.string(), z.any())).optional(),
  // Webfont faces registered + awaited before first render (fail-open).
  fonts: z.array(fontFaceDeclSchema).optional(),
  // Arbitrary, app-defined input data exposed as ctx.data (no shape imposed)
  data: z.record(z.string(), z.unknown()).optional(),
  // Functions as strings
  setup: z.string().optional(),
  createContent: z.string(),
  createTimeline: z.string(),
  onFrame: z.string().optional(),
})

export type ValidatedVosConfigJson = z.infer<typeof vosConfigJsonSchema>
