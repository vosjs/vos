/**
 * 3D text — lowering-side resolution, mirroring how text presets
 * resolve in overlayText.ts: the doc carries intent (typeface slug, material
 * preset name), the baked data carries plain values (URL + constructor
 * params), and ON_FRAME stays a generic interpreter with no registry.
 *
 * Material presets are FLEET-AUDITED: everything single-sided (THREE's
 * default FrontSide — DoubleSide on a transmission material hard-hangs
 * SwiftShader), no `dispersion` (blows preview-job deadlines), transmission
 * only single-sided. Keep new presets inside those constraints.
 */
import { DEFAULT_TYPEFACE_SLUG, findTypeface, typefaceUrl } from '@vosso/shared'
import type { ObjectAsset, Text3dMaterial } from './types'

export const TEXT3D_DEPTH_DEFAULT = 0.25
export const TEXT3D_DEPTH_MIN = 0.02
export const TEXT3D_DEPTH_MAX = 1

export interface BakedText3dMaterial {
  /** THREE constructor family: MeshStandardMaterial | MeshPhysicalMaterial. */
  type: 'standard' | 'physical'
  params: Record<string, unknown>
}

export interface BakedText3dAsset {
  kind: 'text3d'
  text: string
  /** Resolved typeface JSON URL (assets.vos.so — the fleet's one origin). */
  url: string
  /** Extrusion depth as a fraction of the glyph height. */
  depth: number
  bevel: boolean
  mat: BakedText3dMaterial
}

const DEFAULT_INK = '#e4e4e7' // the primitive-prop default

function materialFor(
  preset: Text3dMaterial,
  color: string,
): BakedText3dMaterial {
  switch (preset) {
    case 'metal':
      return {
        type: 'standard',
        params: { color, metalness: 1, roughness: 0.22 },
      }
    case 'glass':
      // Deliberately NO transmission: its internal render pass composites
      // nothing in the layered compositor (measured black on SwiftShader —
      // the verify caught a fully invisible mesh), and the fleet has no env
      // map to refract anyway. Glass here is translucency + clearcoat
      // highlights; the span fade multiplies onto the base opacity.
      return {
        type: 'physical',
        params: {
          color,
          opacity: 0.55,
          metalness: 0,
          roughness: 0.06,
          clearcoat: 1,
          clearcoatRoughness: 0.15,
        },
      }
    case 'neon':
      // No bloom pass exists — the glow is emissive intensity, not post.
      return {
        type: 'standard',
        params: {
          color,
          emissive: color,
          emissiveIntensity: 1.6,
          metalness: 0,
          roughness: 0.4,
        },
      }
    default:
      return {
        type: 'standard',
        params: { color, metalness: 0.2, roughness: 0.45 },
      }
  }
}

/** Normalize a doc text3d asset into the baked payload (pure, deterministic). */
export function resolveText3dAsset(
  asset: Extract<ObjectAsset, { kind: 'text3d' }>,
): BakedText3dAsset {
  const entry = asset.typeface ? findTypeface(asset.typeface) : null
  const slug = entry?.slug ?? DEFAULT_TYPEFACE_SLUG
  const depth = Math.min(
    TEXT3D_DEPTH_MAX,
    Math.max(TEXT3D_DEPTH_MIN, asset.depth ?? TEXT3D_DEPTH_DEFAULT),
  )
  return {
    kind: 'text3d',
    text: asset.text,
    url: typefaceUrl(slug),
    depth: Math.round(depth * 1000) / 1000,
    bevel: asset.bevel !== false,
    mat: materialFor(asset.material ?? 'standard', asset.color ?? DEFAULT_INK),
  }
}
