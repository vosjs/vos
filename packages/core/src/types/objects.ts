import type * as THREE from 'three'

/**
 * Declarative world-space objects — the 3D sibling of `elements[]`.
 *
 * Objects are engine-managed meshes placed in the MAIN scene (not the 2D
 * overlay): primitives built from parameters, or GLB models loaded by key.
 * Transforms are RAW world units (the engine imposes no layout convention —
 * apps map their own coordinate spaces onto world units before authoring the
 * config). Like elements, objects are addressable by id for editor tooling:
 * the bridge exposes `SET_OBJECT_PROPS` (ephemeral prop overrides during a
 * drag) and `OBJECT_HIT_TEST` (a raycast against the main camera).
 *
 * Lighting is the config author's responsibility: standard materials need
 * lights (add them in `createContent`), or set `unlit: true` for a
 * light-independent basic material.
 */
export type ObjectPrimitiveShape = 'cube' | 'sphere' | 'torus' | 'knot'

export type ObjectAssetConfig =
  | {
      kind: 'primitive'
      shape: ObjectPrimitiveShape
      /** CSS color (default '#e4e4e7'). */
      color?: string
      /** Standard-material params (ignored when unlit). */
      metalness?: number
      roughness?: number
      /** Use an unlit basic material (no lights required). */
      unlit?: boolean
    }
  | {
      /** A GLB/GLTF model fetched from `key` (URL). Loaded via the GLTFLoader addon. */
      kind: 'gltf'
      key: string
    }
  | {
      /**
       * Extruded 3D text from a three.js typeface JSON (FontLoader format).
       * Geometry is centered and bbox-NORMALIZED like GLB (largest dimension
       * = 1 world unit), so `scale` means the same thing for every asset.
       */
      kind: 'text3d'
      text: string
      /** Typeface JSON URL. */
      typeface: string
      /** Extrusion depth in glyph-height units (default 0.25). */
      depth?: number
      /** Beveled edges (default true). */
      bevel?: boolean
      /** CSS color (default '#e4e4e7'). */
      color?: string
      /** Standard-material params (ignored when unlit). */
      metalness?: number
      roughness?: number
      /** Use an unlit basic material (no lights required). */
      unlit?: boolean
    }

export interface ObjectTransformConfig {
  /** World units. */
  x?: number
  y?: number
  z?: number
  /** Euler degrees. */
  rx?: number
  ry?: number
  rz?: number
  /**
   * Uniform scale in world units. GLB models are bbox-NORMALIZED at load
   * (largest dimension = 1 world unit), so `scale` means the same thing for
   * every asset.
   */
  scale?: number
}

export interface ObjectConfig {
  /** Stable identity — the bridge addresses objects by id. */
  id: string
  asset: ObjectAssetConfig
  transform?: ObjectTransformConfig
  /** Initial visibility (default true). */
  visible?: boolean
}

/**
 * GSAP/spec-animatable prop bag mirrored onto the mesh each frame — the same
 * ephemeral-override contract as element props: `SET_OBJECT_PROPS` writes
 * here for gesture-time preview and a LOAD clears it (durable state is the
 * config).
 */
export interface ObjectProps {
  x: number
  y: number
  z: number
  rx: number
  ry: number
  rz: number
  scale: number
  opacity: number
  visible: boolean
}

export interface ObjectInstance {
  config: ObjectConfig
  /** The root object added to the scene (a Mesh for primitives, a Group for GLB). */
  root: THREE.Object3D
  props: ObjectProps
  dispose: () => void
}
