/**
 * The plan limits table.
 *
 * ONE table, keyed by `user.plan`, read by every quota verdict on the API
 * and by every client that states a limit before the user hits it (the
 * recorder's countdown, the CLI's `record`, the settings usage strip).
 * 'free' is the only row today and nothing writes `user.plan`; a paid plan
 * is a second row here plus a server-side writer, never a rewrite of the
 * guards. An unknown or absent plan resolves to free — never to a grant.
 *
 * Numbers are proposals that can be retuned as data: every
 * refusal prints its number from here, so the copy can never disagree.
 */

export type Plan = 'free'

export const PLANS: readonly Plan[] = ['free']

export interface PlanLimits {
  /** Session vos creates per rolling 24h. */
  dailySaves: number
  /** Private voses held at once (counted at create). */
  privateVoses: number
  /** Key-authed .glb/.gltf uploads per 24h, per owning user. */
  keyModelUploads: number
  /** Key-authed recording uploads per 24h, per owning user. */
  keyRecordingUploads: number
  /** Key-authed image uploads per 24h (posters/stills an agent files into a project). */
  keyImageUploads: number
  /** Session recording uploads per 24h (uploads count as uploads). */
  recordingUploads: number
  /** Session image / HDR / audio uploads per 24h. */
  otherUploads: number
  /** Longest hosted recording, seconds (stated before you record). */
  recordingMaxSeconds: number
  /** Largest single recording upload, bytes (the ingest ceiling). */
  recordingMaxBytes: number
  /** Total asset bytes an account may hold (said in hours in the UI). */
  storageBytes: number
  /** Session versions per vos per 24h. */
  versionsPerVosDay: number
  /** Key-authed version pushes per 24h across every vos. */
  keyVersionsPerDay: number
  /** Voses + assets + recipes one folder may hold. */
  folderItems: number
  /** Subfolders one folder may hold. */
  subfolders: number
  /** Plumbing media enqueues (preview + thumbnail) per vos per hour. */
  mediaPerVosHour: number
  /** Plumbing media enqueues per account per 24h. Past it, media DEFERS. */
  mediaPerAccountDay: number
  /** Artifact render output-minutes per account per 24h (armed with cloud export). */
  artifactRenderMinutesPerDay: number
  /** Own-vos backdrop bakes per account per 24h (cache hits never count). */
  backdropBakesPerDay: number
  /** Folders per user, across every nesting level. */
  folders: number
  /** Recipe files (.md assets) per user. */
  recipes: number
  /** Key-authed recipe creates per 24h. */
  keyRecipeCreates: number
  /** Recipe body byte cap (upload + in-place replace). */
  recipeBodyBytes: number
}

const FREE: PlanLimits = {
  dailySaves: 10,
  privateVoses: 20,
  keyModelUploads: 10,
  keyRecordingUploads: 20,
  keyImageUploads: 40,
  recordingUploads: 20,
  otherUploads: 50,
  recordingMaxSeconds: 30 * 60,
  recordingMaxBytes: 512 * 1024 * 1024,
  storageBytes: 5 * 1024 * 1024 * 1024,
  versionsPerVosDay: 100,
  keyVersionsPerDay: 200,
  folderItems: 500,
  subfolders: 50,
  mediaPerVosHour: 20,
  mediaPerAccountDay: 300,
  artifactRenderMinutesPerDay: 60,
  backdropBakesPerDay: 20,
  // Folders & recipes: sanity caps, not a paywall — organization
  // stays free at every size that isn't abuse.
  folders: 50,
  recipes: 200,
  keyRecipeCreates: 20,
  recipeBodyBytes: 64 * 1024,
}

// Keyed by string on purpose: the column is free text at the wire, so a
// value the table does not know must fall through to free, never throw.
const LIMITS: Partial<Record<string, PlanLimits>> = { free: FREE }

/** Unknown or absent ⇒ free. A plan the table does not know is never a grant. */
export function planLimits(plan?: string | null): PlanLimits {
  return LIMITS[plan ?? 'free'] ?? FREE
}

/**
 * The storage ceiling in the unit a human can picture. Footage at ~5 Mbps
 * is ~0.375 GB per 10 minutes, so 5 GB reads as "about 2 hours"; the guard
 * counts bytes, the sentence says hours. Rounded to a half hour.
 */
export const FOOTAGE_BYTES_PER_SECOND = (5_000_000 / 8) * 1
export function bytesAsFootageHours(bytes: number): number {
  return Math.round((bytes / FOOTAGE_BYTES_PER_SECOND / 3600) * 2) / 2
}

/** `1.2 GB`, `640 MB`, `12 KB` — for the usage strip and refusals. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}

/** `30 min`, `1 h 30 min`, `45 s` — the duration cap in words. */
export function formatDurationCap(seconds: number): string {
  if (seconds < 60) return `${seconds} s`
  const m = Math.round(seconds / 60)
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  const rest = m % 60
  return rest ? `${h} h ${rest} min` : `${h} h`
}
