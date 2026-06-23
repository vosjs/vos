import { z } from 'zod'

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export const vec3Schema = z.tuple([z.number(), z.number(), z.number()])
export const colorSchema = z.union([z.number(), z.string()])

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

export const fogSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('exp2'),
    color: colorSchema,
    density: z.number(),
  }),
  z.object({
    type: z.literal('linear'),
    color: colorSchema,
    near: z.number(),
    far: z.number(),
  }),
])

export const sceneSchema = z
  .object({
    background: colorSchema.optional(),
    fog: fogSchema.optional(),
  })
  .optional()

// ---------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------

export const cameraSchema = z.discriminatedUnion('preset', [
  z.object({
    preset: z.literal('perspective'),
    fov: z.number().optional(),
    near: z.number().optional(),
    far: z.number().optional(),
    position: vec3Schema.optional(),
    lookAt: vec3Schema.optional(),
  }),
  z.object({
    preset: z.literal('orthographic'),
    zoom: z.number().optional(),
    near: z.number().optional(),
    far: z.number().optional(),
    position: vec3Schema.optional(),
    lookAt: vec3Schema.optional(),
  }),
  z.object({
    preset: z.literal('fullscreen'),
    near: z.number().optional(),
    far: z.number().optional(),
  }),
])

// ---------------------------------------------------------------------------
// Postprocessing
// ---------------------------------------------------------------------------

export const postprocessingSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('bloom'),
    strength: z.number().optional(),
    radius: z.number().optional(),
    threshold: z.number().optional(),
  }),
  z.object({
    type: z.literal('glitch'),
    goWild: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('filmGrain'),
    intensity: z.number().optional(),
  }),
  z.object({
    type: z.literal('dotScreen'),
    scale: z.number().optional(),
  }),
  z.object({
    type: z.literal('output'),
  }),
])
