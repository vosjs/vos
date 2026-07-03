/**
 * Timeline view-model math — pure, headless helpers behind any timeline UI:
 * px↔time mapping, nice-number ruler ticks, and magnetic snapping. No DOM,
 * no React — the app renders these numbers however it likes and feeds pointer
 * positions back through `toTime`.
 */

/** The visible time range of the timeline (seconds). */
export interface TimelineViewport {
  t0: number
  t1: number
}

export interface Tick {
  t: number
  /** Major ticks get labels; minor ticks are subdivisions. */
  major: boolean
  label?: string
}

export function toPx(t: number, viewport: TimelineViewport, widthPx: number): number {
  const span = viewport.t1 - viewport.t0
  return span > 0 ? ((t - viewport.t0) / span) * widthPx : 0
}

export function toTime(px: number, viewport: TimelineViewport, widthPx: number): number {
  const span = viewport.t1 - viewport.t0
  return widthPx > 0 ? viewport.t0 + (px / widthPx) * span : viewport.t0
}

/** Nice tick steps (seconds) — chosen so major ticks stay ≥ minMajorPx apart. */
const TICK_STEPS = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600]

/**
 * Ruler ticks for the viewport: major ticks on a "nice" step with labels,
 * minor ticks at quarter-steps. Integer index stepping — no float accumulation.
 */
export function rulerTicks(
  viewport: TimelineViewport,
  widthPx: number,
  minMajorPx = 72,
): Tick[] {
  const span = viewport.t1 - viewport.t0
  if (span <= 0 || widthPx <= 0) return []
  const step =
    TICK_STEPS.find((s) => (s / span) * widthPx >= minMajorPx) ??
    TICK_STEPS[TICK_STEPS.length - 1]
  const minor = step / 4

  const ticks: Tick[] = []
  const first = Math.ceil(viewport.t0 / minor - 1e-9)
  const last = Math.floor(viewport.t1 / minor + 1e-9)
  for (let i = first; i <= last; i++) {
    const t = roundMs(i * minor)
    const major = i % 4 === 0
    ticks.push({ t, major, label: major ? formatTime(t) : undefined })
  }
  return ticks
}

/** mm:ss (or m:ss.t for sub-second steps) label for the ruler. */
export function formatTime(t: number): string {
  const clamped = Math.max(0, t)
  const m = Math.floor(clamped / 60)
  const s = clamped - m * 60
  const whole = Math.abs(s - Math.round(s)) < 1e-9
  const sec = whole
    ? String(Math.round(s)).padStart(2, '0')
    : s.toFixed(1).padStart(4, '0')
  return `${m}:${sec}`
}

export interface SnapOptions {
  viewport: TimelineViewport
  widthPx: number
  /** Magnetic targets in seconds (playhead, clip edges, keyframes…). */
  magnets?: number[]
  /** Snap radius in px (default 8). */
  thresholdPx?: number
}

/** Snap a time to the nearest magnet within the px threshold (else pass through). */
export function snapTime(t: number, options: SnapOptions): number {
  const { viewport, widthPx, magnets = [], thresholdPx = 8 } = options
  const span = viewport.t1 - viewport.t0
  if (span <= 0 || widthPx <= 0 || !magnets.length) return t
  const thresholdT = (thresholdPx / widthPx) * span
  let best = t
  let bestDist = thresholdT
  for (const m of magnets) {
    const dist = Math.abs(m - t)
    if (dist < bestDist) {
      best = m
      bestDist = dist
    }
  }
  return best
}

function roundMs(v: number): number {
  return Math.round(v * 1000) / 1000
}
