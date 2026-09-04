/**
 * The music catalog the platform publishes at `GET /api/music`: the
 * curated CC0 tracks (slug, mood, duration, an absolute URL on the assets
 * host) and the built-in sound effects. Read once per run when a
 * destination plays sound; a failed read is said and the cut stays silent.
 */
import type { MusicCatalog } from './motionPlan'

export async function fetchMusicCatalog(origin: string): Promise<MusicCatalog> {
  const base = origin.replace(/\/+$/, '')
  const res = await fetch(`${base}/api/music`)
  if (!res.ok) throw new Error(`GET ${base}/api/music answered ${res.status}`)
  const body = (await res.json()) as Partial<MusicCatalog>
  return {
    tracks: Array.isArray(body.tracks) ? body.tracks : [],
    sfx: Array.isArray(body.sfx) ? body.sfx : [],
  }
}
