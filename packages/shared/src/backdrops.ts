/**
 * The backdrop wire contract: what `GET /api/backdrops`
 * hands to the studio panel, the picker, the CLI and agents. Absolute URLs
 * on purpose — a ProjectDoc travels across environments (save-to-vos, CLI
 * takes, server renders), so a backdrop key must resolve everywhere without
 * host-side rewriting.
 */

export const BACKDROP_ASSET_BASE = 'https://assets.vos.so/'

export interface Backdrop {
  id: string
  slug: string
  title: string
  /** The loop's length in seconds — a fact of the asset, never a knob. */
  duration: number
  /** The 1080p bake's pixel size (the export note reads it). */
  width: number
  height: number
  /** The CSS underlay a pick writes into `frame.background`. */
  ground: string
  /** Provenance: the vos it was baked from, when it still exists. */
  vosId: string | null
  urls: {
    '1080p': string | null
    '2k': string | null
    poster: string | null
  }
}
