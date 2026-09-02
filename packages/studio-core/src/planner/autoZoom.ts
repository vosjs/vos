/**
 * Element-aware auto-zoom planner — the differentiator.
 *
 * Because we capture inside the browser, a click is not a guessed pixel point
 * but a known element (`rect`). We frame that element's bounding box, merge
 * clustered clicks into one sustained zoom span, and pick an adaptive level
 * that fits the element (unlike fixed-level recorders). Clicks are the PRIMARY
 * signal (Recordly's stance); TYPING SESSIONS are their peer (nobody
 * ships this): `key` activity pings group into sessions that frame the field
 * being typed into, absorb the click that focused it (the camera commits as
 * the field is clicked), and hold until typing stops; DWELLS augment last
 * (OpenScreen's stance) only where no other span exists — the cursor parking
 * on the thing being narrated is worth framing even without a click. Pure &
 * deterministic: same track → same spans. The editor edits this *output*, not
 * the planner — every span is tagged `source: 'auto'`, so a regenerate can
 * replace planner suggestions while leaving user-touched ('manual') spans
 * alone. Ids by origin: `z{n}` clicks, `k{n}` typing, `d{n}` dwells.
 */
import { clampZoomLevel } from '../types'
import { resolveZoomStyle } from '../zoomStyle'
import type { CursorTrack, Rect, ZoomSpan } from '../types'
import type { ZoomStyleName, ZoomStyleParams } from '../zoomStyle'

/** Normalized step distance that ends a dwell run (OpenScreen's 0.02). */
const DWELL_MOVE_FRAC = 0.02
/** A run qualifies as a dwell when it lasts this long (seconds). */
const DWELL_MIN = 0.45
const DWELL_MAX = 2.6
/** Min gap between accepted dwell centers (longest dwell wins). */
const DWELL_SPACING = 1.8
/**
 * A click cluster whose element FITS the frame at less than this level is
 * not a target: it is a drag (aiming, scrubbing, moving a thing across the
 * canvas) or a frame-sized surface, and a zoom on it says nothing. Five real
 * takes (2026-08-25) each carried 1-4 such clusters, planned at the floor
 * level for 10-25s; every one was dropped by hand. Now they plan nothing.
 */
export const DRAG_FIT_LEVEL = 1.15

// ── typing sessions ────────────────────────────────────────────────────
/** A session needs at least this many `key` pings (a lone Enter never zooms). */
const TYPING_MIN_PINGS = 2
/** …spanning at least this long (seconds) — sub-half-second typing is a blip. */
const TYPING_MIN_DUR = 0.5
/**
 * A `down` this close before the first ping, on the same field, is absorbed:
 * the span enters at the click so the camera commits as the field is clicked,
 * not after the fact (the anticipatory beat).
 */
const TYPING_CLICK_ABSORB = 1.5
/**
 * Normalized field-center distance that means "a different field" — splits a
 * session (form-filling becomes a field-to-field pan chain via the lowering's
 * chainGap) and gates click absorption / same-field span merging.
 */
const TYPING_REFOCUS_FRAC = 0.08

export interface PlanOptions {
  /** captured frame size (for normalizing rects → [0..1] focus points). */
  width: number
  height: number
  /**
   * Camera style whose planner params seed every default below (zoomStyle.ts).
   * Explicit options still win. Absent = DEFAULT_ZOOM_STYLE.
   */
  style?: ZoomStyleName
  /** per-doc overrides on top of the style (doc.zoomParams — the Custom seam). */
  params?: Partial<ZoomStyleParams>
  /** target: zoom so the element fills ~this fraction of the frame. */
  targetFill?: number
  /** clamp zoom level. */
  minLevel?: number
  maxLevel?: number
  /** clicks within this many seconds merge into one zoom (session merge). */
  clusterGap?: number
  /** span lead-in before the first click + hold after the last. */
  lead?: number
  hold?: number
  /** minimum clicks for a cluster to earn a zoom (Cursorful's ≥2 rule). */
  minClusterClicks?: number
  /** emit spans with focusMode 'auto' (cursor-follow camera). */
  followByDefault?: boolean
  /** typing sessions plan spans. */
  typingZoom?: boolean
  /** max silence between `key` pings before the typing session ends. */
  typingGap?: number
  /** hold after the last keystroke (the read-what-you-typed beat). */
  typingHold?: number
  /** level floor for typing spans (a wide field still reads punchier). */
  typingMinLevel?: number
}

/** One press (or ping) in seconds, with the target element when known. */
export interface Click {
  t: number // seconds
  rect?: Rect
  x: number
  y: number
}

/**
 * The planner's first two passes, exported so the take DIGEST lists
 * the same click clusters and typing sessions the planner zooms on — one
 * grouping, never a second implementation that drifts. Typing sessions come
 * FIRST: a session may ABSORB the click that focused its field, and that
 * click must then not seed a click cluster — the two passes never compete
 * for the same press.
 */
export function groupTrack(
  track: CursorTrack,
  opts: {
    width: number
    height: number
    clusterGap: number
    typingGap: number
    typingZoom: boolean
  },
): { sessions: TypingSession[]; clusters: Click[][] } {
  const { width, height, clusterGap, typingGap, typingZoom } = opts
  const clicks: Click[] = track
    .filter((e) => e.type === 'down')
    .map((e) => ({ t: e.t / 1000, rect: e.rect, x: e.x, y: e.y }))

  const sessions = typingZoom
    ? typingSessions(track, width, height, typingGap)
    : []
  const absorbed = new Set<Click>()
  for (const s of sessions) {
    let best: Click | null = null
    for (const c of clicks) {
      if (absorbed.has(c)) continue
      if (c.t >= s.first || s.first - c.t > TYPING_CLICK_ABSORB) continue
      const [nx, ny] = fieldCenter(c, width, height)
      if (Math.hypot(nx - s.cx, ny - s.cy) > TYPING_REFOCUS_FRAC) continue
      if (!best || c.t > best.t) best = c
    }
    if (best) {
      absorbed.add(best)
      // Anticipatory entry: the span opens on the click into the field, so the
      // camera is already moving when the first character appears.
      s.start = best.t
      s.events = [best, ...s.events]
    }
  }

  // Merge clusters of clicks that are close in time into one sustained zoom.
  const clusters: Click[][] = []
  for (const c of clicks) {
    if (absorbed.has(c)) continue
    const last = clusters.at(-1) // Click[] | undefined
    const prev = last?.at(-1)
    if (last && prev && c.t - prev.t <= clusterGap) last.push(c)
    else clusters.push([c])
  }
  return { sessions, clusters }
}

export function planAutoZoom(
  track: CursorTrack,
  options: PlanOptions,
): ZoomSpan[] {
  const style = resolveZoomStyle(options.style, options.params)
  // The 'none' style (or an autoZoom:false override): manual zooms only.
  if (!style.autoZoom) return []
  const {
    width,
    height,
    targetFill = style.targetFill,
    minLevel = style.minLevel,
    maxLevel = style.maxLevel,
    clusterGap = style.clusterGap,
    lead = style.lead,
    hold = style.hold,
    minClusterClicks = style.minClusterClicks,
    followByDefault = style.followByDefault,
    typingZoom = style.typingZoom,
    typingGap = style.typingGap,
    typingHold = style.typingHold,
    typingMinLevel = style.typingMinLevel,
  } = options

  const { sessions, clusters } = groupTrack(track, {
    width,
    height,
    clusterGap,
    typingGap,
    typingZoom,
  })

  interface Working {
    in: number
    out: number
    cx: number
    cy: number
    level: number
    dead?: boolean
  }

  // Lone clicks below the cluster minimum earn no zoom (the Cursorful rule:
  // one stray click isn't worth a camera move — dwells may still cover it).
  const eligible = clusters.filter((c) => c.length >= minClusterClicks)
  const clickSpans: Working[] = []
  // Drag clusters plan no zoom but still RESERVE their window: the cursor
  // was working there, and the pauses between drags are not dwells.
  const dragReserved: ZoomSpan[] = []
  for (const cluster of eligible) {
    const first = cluster[0]
    const last = cluster[cluster.length - 1]
    // focus point + level from the element rect when present, else the point
    const f = focusFor(cluster, width, height, targetFill, minLevel, maxLevel)
    // A drag or a frame-sized surface (DRAG_FIT_LEVEL): no zoom at all.
    if (f.fit !== null && f.fit < DRAG_FIT_LEVEL) {
      dragReserved.push({
        id: `drag${dragReserved.length}`,
        in: Math.max(0, first.t - lead),
        out: last.t + hold,
        level: 1,
        cx: f.cx,
        cy: f.cy,
      })
      continue
    }
    clickSpans.push({
      in: Math.max(0, first.t - lead),
      out: last.t + hold,
      cx: f.cx,
      cy: f.cy,
      level: f.level,
    })
  }

  // Typing spans clamp to their own floor: the field is the moment being
  // narrated, so a wide input still reads a notch punchier than a wide click.
  const typingFloor = Math.min(Math.max(minLevel, typingMinLevel), maxLevel)
  let typing: Working[] = sessions.map((s) => {
    const f = focusFor(
      s.events,
      width,
      height,
      targetFill,
      typingFloor,
      maxLevel,
    )
    return {
      in: Math.max(0, s.start - lead),
      out: s.last + typingHold,
      cx: f.cx,
      cy: f.cy,
      level: f.level,
    }
  })

  // Resolve typing↔click overlaps. Same field → MERGE (union extents, the
  // typing focus wins: the field is the payload). Different field → the click
  // beat keeps its span and the typing span CEDES the overlap — the camera
  // moves off the field for the click and the chainGap pan carries the travel.
  for (const t of typing) {
    for (const z of clickSpans) {
      if (z.dead || t.dead) continue
      if (t.in >= z.out || t.out <= z.in) continue
      if (Math.hypot(t.cx - z.cx, t.cy - z.cy) <= TYPING_REFOCUS_FRAC) {
        t.in = Math.min(t.in, z.in)
        t.out = Math.max(t.out, z.out)
        z.dead = true
      } else if (z.in <= t.in && z.out >= t.out) {
        t.dead = true
      } else if (z.in > t.in) {
        t.out = z.in
      } else {
        t.in = z.out
      }
    }
  }
  // A field switch splits sessions faster than lead+hold shrink — trim the
  // earlier span to the later one's entry (adjacent spans chain into a pan).
  typing = typing.filter((t) => !t.dead).sort((a, b) => a.in - b.in)
  for (let i = 0; i + 1 < typing.length; i++) {
    if (typing[i].out > typing[i + 1].in) typing[i].out = typing[i + 1].in
  }
  typing = typing.filter((t) => t.out - t.in >= 0.3)

  // Deterministic ids (pure planner: same track → same spans, same ids),
  // re-numbered in TIME order per origin so ids stay stable under replans.
  const zSpans: ZoomSpan[] = clickSpans
    .filter((s) => !s.dead)
    .sort((a, b) => a.in - b.in)
    .map((s, i) => ({
      id: `z${i}`,
      in: round(s.in),
      out: round(s.out),
      level: clampZoomLevel(s.level),
      cx: round(s.cx),
      cy: round(s.cy),
      // Follow styles ride the cursor through the span (entry + dead-zone
      // recenters baked at lowering); typing/dwell spans stay fixed-focus.
      ...(followByDefault ? { focusMode: 'auto' as const } : {}),
      source: 'auto',
    }))
  const kSpans: ZoomSpan[] = typing.map((s, i) => ({
    id: `k${i}`,
    in: round(s.in),
    out: round(s.out),
    level: clampZoomLevel(s.level),
    cx: round(s.cx),
    cy: round(s.cy),
    // Never focusMode:'auto': the dot is parked (and fading) while typing —
    // the FIELD is the anchor, and a follow would be a no-op at best.
    source: 'auto',
  }))
  const spans = [...zSpans, ...kSpans].sort((a, b) => a.in - b.in)

  // Dwell augmentation: sustained cursor rests no click/typing span covers.
  const dwells = dwellSpans(track, width, height, maxLevel, [
    ...spans,
    ...dragReserved,
  ])
  return [...spans, ...dwells].sort((a, b) => a.in - b.in)
}

export interface TypingSession {
  /** pings (+ the absorbed focusing click) — fed to focusFor unchanged. */
  events: Click[]
  first: number
  last: number
  /** span anchor: the absorbed click's time, else the first ping's. */
  start: number
  /** normalized field center of the FIRST ping — the session's identity. */
  cx: number
  cy: number
}

/**
 * Group `key` pings into typing sessions: a ping joins the current session
 * while the silence stays ≤ typingGap AND it is still the same field (a ping
 * whose field center moved > TYPING_REFOCUS_FRAC starts a new session — that
 * split is what turns form-filling into a field-to-field pan chain). Sessions
 * below TYPING_MIN_PINGS/TYPING_MIN_DUR are noise (a lone Enter, a shortcut
 * chord) and plan nothing.
 */
export function typingSessions(
  track: CursorTrack,
  width: number,
  height: number,
  typingGap: number,
): TypingSession[] {
  const pings: Click[] = track
    .filter((e) => e.type === 'key')
    .map((e) => ({ t: e.t / 1000, rect: e.rect, x: e.x, y: e.y }))
  const all: TypingSession[] = []
  let cur: TypingSession | null = null
  for (const p of pings) {
    const [nx, ny] = fieldCenter(p, width, height)
    if (
      cur &&
      p.t - cur.last <= typingGap &&
      Math.hypot(nx - cur.cx, ny - cur.cy) <= TYPING_REFOCUS_FRAC
    ) {
      cur.events.push(p)
      cur.last = p.t
    } else {
      cur = { events: [p], first: p.t, last: p.t, start: p.t, cx: nx, cy: ny }
      all.push(cur)
    }
  }
  return all.filter(
    (s) =>
      s.events.length >= TYPING_MIN_PINGS && s.last - s.first >= TYPING_MIN_DUR,
  )
}

/** Normalized center of the event's element rect (or its point). */
export function fieldCenter(
  c: Click,
  width: number,
  height: number,
): [number, number] {
  const px = c.rect ? c.rect.x + c.rect.w / 2 : c.x
  const py = c.rect ? c.rect.y + c.rect.h / 2 : c.y
  return [clamp01(px / width), clamp01(py / height)]
}

/**
 * Dwell detection over move samples. One capture subtlety drives the shape:
 * the recorder is event-driven with a distance gate, so a PARKED cursor emits
 * NO samples — stillness is the time gap between a run's last sample and the
 * sample that finally breaks the distance threshold. A run therefore extends
 * to its breaking sample's time (or the track end). Candidates are ranked by
 * duration (longest wins), deduped by DWELL_SPACING between centers, and any
 * span that would overlap an existing (click) span is dropped.
 */
export function dwellSpans(
  track: CursorTrack,
  width: number,
  height: number,
  maxLevel: number,
  reserved: ZoomSpan[],
): ZoomSpan[] {
  const moves = track
    .filter((e) => e.type === 'move')
    .map((e) => ({ t: e.t / 1000, nx: e.x / width, ny: e.y / height }))
  if (moves.length < 2) return []
  const trackEnd = track[track.length - 1].t / 1000

  interface Candidate {
    center: number
    cx: number
    cy: number
    strength: number
  }
  const candidates: Candidate[] = []
  let start = 0
  for (let i = 1; i <= moves.length; i++) {
    const breaks =
      i === moves.length ||
      Math.hypot(moves[i].nx - moves[i - 1].nx, moves[i].ny - moves[i - 1].ny) >
        DWELL_MOVE_FRAC
    if (!breaks) continue
    const endT = i < moves.length ? moves[i].t : trackEnd
    const dur = endT - moves[start].t
    if (dur >= DWELL_MIN && dur <= DWELL_MAX) {
      const run = moves.slice(start, i)
      candidates.push({
        center: (moves[start].t + endT) / 2,
        cx: run.reduce((s, p) => s + p.nx, 0) / run.length,
        cy: run.reduce((s, p) => s + p.ny, 0) / run.length,
        strength: dur,
      })
    }
    start = i
  }

  // Longest dwell wins; enforce center spacing; drop-on-overlap vs everything
  // already accepted (click spans + earlier dwells — adjacency is fine).
  const sorted = [...candidates].sort((a, b) => b.strength - a.strength)
  const sourceDuration = trackEnd
  const len = Math.max(1, sourceDuration * 0.05)
  const taken: ZoomSpan[] = [...reserved]
  const accepted: ZoomSpan[] = []
  const centers: number[] = []
  for (const c of sorted) {
    if (centers.some((t) => Math.abs(t - c.center) < DWELL_SPACING)) continue
    const spanIn = Math.max(
      0,
      Math.min(c.center - len / 2, sourceDuration - len),
    )
    const spanOut = Math.min(sourceDuration, spanIn + len)
    if (spanOut - spanIn < 0.3) continue
    if (taken.some((z) => spanIn < z.out && spanOut > z.in)) continue
    const span: ZoomSpan = {
      id: `d${accepted.length}`,
      in: round(spanIn),
      out: round(spanOut),
      // No element rect on moves → point zoom at the planner ceiling.
      level: clampZoomLevel(maxLevel),
      cx: round(clamp01(c.cx)),
      cy: round(clamp01(c.cy)),
      source: 'auto',
    }
    accepted.push(span)
    taken.push(span)
    centers.push(c.center)
  }
  // Deterministic ids in TIME order (rank order depends on durations, which
  // would make ids unstable under small edits) — re-id after sorting.
  return accepted
    .sort((a, b) => a.in - b.in)
    .map((z, i) => ({ ...z, id: `d${i}` }))
}

function focusFor(
  cluster: Click[],
  width: number,
  height: number,
  targetFill: number,
  minLevel: number,
  maxLevel: number,
): { cx: number; cy: number; level: number; fit: number | null } {
  // Average the rect centers (or points) in the cluster.
  let sx = 0
  let sy = 0
  let maxW = 0
  let maxH = 0
  for (const c of cluster) {
    if (c.rect) {
      sx += c.rect.x + c.rect.w / 2
      sy += c.rect.y + c.rect.h / 2
      maxW = Math.max(maxW, c.rect.w)
      maxH = Math.max(maxH, c.rect.h)
    } else {
      sx += c.x
      sy += c.y
    }
  }
  const n = cluster.length
  const cx = clamp01(sx / n / width)
  const cy = clamp01(sy / n / height)

  // Level: zoom so the element fills ~targetFill of the frame (element-aware).
  // No rect → use the max level (point zoom).
  let level = maxLevel
  let fit: number | null = null
  if (maxW > 0 && maxH > 0) {
    const fitX = (width * targetFill) / maxW
    const fitY = (height * targetFill) / maxH
    level = Math.min(fitX, fitY)
    fit = level
  }
  return { cx, cy, level: clamp(level, minLevel, maxLevel), fit }
}

/**
 * Normalized focus + union rect of a click cluster or typing session (the
 * digest's per-moment `focus`/`rect`, in the doc's [0..1] units) — the same
 * averaging `focusFor` zooms on, minus the level.
 */
export function clusterFocus(
  events: readonly Click[],
  width: number,
  height: number,
): { cx: number; cy: number; rect: Rect | null } {
  let sx = 0
  let sy = 0
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  let rects = 0
  for (const c of events) {
    if (c.rect) {
      sx += c.rect.x + c.rect.w / 2
      sy += c.rect.y + c.rect.h / 2
      x0 = Math.min(x0, c.rect.x)
      y0 = Math.min(y0, c.rect.y)
      x1 = Math.max(x1, c.rect.x + c.rect.w)
      y1 = Math.max(y1, c.rect.y + c.rect.h)
      rects++
    } else {
      sx += c.x
      sy += c.y
    }
  }
  const n = Math.max(1, events.length)
  const rect =
    rects > 0
      ? {
          x: clamp01(x0 / width),
          y: clamp01(y0 / height),
          w: clamp01((x1 - x0) / width),
          h: clamp01((y1 - y0) / height),
        }
      : null
  return { cx: clamp01(sx / n / width), cy: clamp01(sy / n / height), rect }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}
function clamp01(v: number): number {
  return clamp(v, 0, 1)
}
function round(v: number): number {
  return Math.round(v * 1000) / 1000
}
