/**
 * The camera on a stage: a take of several windows on one display
 * (`captureSurface: 'desktop'`, `meta.windows`).
 *
 * The frame planner sees one frame. On a stage that frame is a whole display,
 * and two things go wrong: presses in two windows that happen to sit near
 * each other are framed as one beat aimed between them, and every return
 * from a zoom lands on the whole desk, the least legible framing there is.
 *
 * The rule here is one sentence: INSIDE A WINDOW, THE CAMERA IS THE CAMERA A
 * TAKE OF THAT WINDOW WOULD HAVE. The take is cut into VISITS (the stretch
 * the pointer works in one window), each visit is planned by the frame
 * planner with that window as its frame, and its spans are mapped back onto
 * the stage, with two limits a stage needs and a window take does not: a
 * beat never shows less of the stage than a reader needs (STAGE_VIEW_REF),
 * and its view stays inside the window it is in. Between a visit's spans
 * the camera RESTS on the window. A press
 * on the ground between windows is planned against the stage itself, as on
 * any take. Before the first visit nothing is proposed: the take opens on
 * the whole stage.
 *
 * Pure and deterministic like the planner it wraps, and every span is
 * `source: 'auto'`. Ids by origin: the frame planner's, plus `w{n}` for a
 * rest on a window.
 */
import { clampZoomLevel } from '../types'
import { resolveZoomStyle } from '../zoomStyle'
import type {
  CursorEvent,
  CursorTrack,
  StageWindow,
  StepSpan,
  WindowSample,
  ZoomSpan,
} from '../types'
import type { ZoomStyleName, ZoomStyleParams } from '../zoomStyle'

/**
 * A window at rest fills this fraction of the frame on its tighter axis: the
 * whole window with a little of the ground around it, so it reads as a
 * window and not as the frame.
 */
export const STAGE_WINDOW_FILL = 0.85
/**
 * No beat on a stage shows less than this many units of it across, divided
 * by the style's ceiling (cursor-space units: a desktop's points). A take of
 * a window stops at the style's ceiling of ITS frame, and a window is about
 * this wide; a small window on a wide stage would otherwise be entered until
 * one control filled the picture and the window it is in was lost. At the
 * default ceiling this is 600 points across.
 */
export const STAGE_VIEW_REF = 1080
/** A window that already fills the stage this nearly earns no rest: the stage is its framing. */
export const STAGE_REST_MIN_LEVEL = 1.08
/** A gap between a visit's spans shorter than this is left to the spans' own chain. */
export const STAGE_REST_MIN_S = 1
/**
 * A window whose frame changed twice within this long is being moved or
 * sized: the camera does not chase it, and the stretch is planned against
 * the stage.
 */
export const STAGE_MOVE_SETTLE_S = 0.3

/** The stage's windows at `t` seconds, front to back. */
export function windowsAt(
  samples: readonly WindowSample[],
  t: number,
): readonly StageWindow[] {
  let cur: readonly StageWindow[] = samples[0]?.windows ?? []
  const ms = t * 1000
  for (const s of samples) {
    if (s.t > ms) break
    cur = s.windows
  }
  return cur
}

/**
 * The window a point is in at `t` seconds: the frontmost that holds it. Null
 * on the ground. A point in a PANEL (an app's alert, popover or tip) is in
 * that app's frontmost window proper: the panel is where the hand is, the
 * window is where the work is. An app with nothing but a panel has the panel.
 */
export function windowAtPoint(
  samples: readonly WindowSample[],
  t: number,
  x: number,
  y: number,
): StageWindow | null {
  const list = windowsAt(samples, t)
  for (const w of list) {
    if (!(x >= w.x && x <= w.x + w.w && y >= w.y && y <= w.y + w.h)) continue
    if (!w.panel) return w
    return list.find((o) => !o.panel && o.app === w.app) ?? w
  }
  return null
}

/** Where an event is: its element's centre when it has one, else its point. */
export function eventPoint(e: {
  x: number
  y: number
  rect?: { x: number; y: number; w: number; h: number }
}): [number, number] {
  return e.rect
    ? [e.rect.x + e.rect.w / 2, e.rect.y + e.rect.h / 2]
    : [e.x, e.y]
}

/** A stretch of the take spent in one window (or, with `win` null, on the ground). */
export interface StageVisit {
  win: StageWindow | null
  /** seconds */
  in: number
  out: number
}

const sameFrame = (a: StageWindow | null, b: StageWindow | null): boolean =>
  a === b ||
  (!!a &&
    !!b &&
    Math.abs(a.x - b.x) <= 1 &&
    Math.abs(a.y - b.y) <= 1 &&
    Math.abs(a.w - b.w) <= 1 &&
    Math.abs(a.h - b.h) <= 1)

/**
 * The take as visits. A visit is told by what the pointer DID: each press
 * and each typing ping belongs to the window under it, and a run of them in
 * one window is one visit. It opens a lead before its first act (never
 * before the last act of the visit before it) and lasts until the next one
 * opens, or the take ends: the camera stays with a window until the work
 * moves. A window that is moved or sized mid-visit splits it, and the
 * moving itself is the ground's.
 */
export function stageVisits(
  track: CursorTrack,
  samples: readonly WindowSample[],
  opts: { lead: number; duration: number },
): StageVisit[] {
  interface Run {
    id: number | null
    win: StageWindow | null
    first: number
    last: number
  }
  const runs: Run[] = []
  for (const e of track) {
    if (e.type !== 'down' && e.type !== 'key') continue
    const t = e.t / 1000
    const [px, py] = eventPoint(e)
    const win = windowAtPoint(samples, t, px, py)
    const id = win?.id ?? null
    const cur = runs.at(-1)
    if (cur && cur.id === id) cur.last = t
    else runs.push({ id, win, first: t, last: t })
  }
  const visits: StageVisit[] = runs.map((r, i) => ({
    win: r.win,
    in:
      i === 0
        ? Math.max(0, r.first - opts.lead)
        : Math.max(runs[i - 1].last, r.first - opts.lead),
    out: 0,
  }))
  for (let i = 0; i < visits.length; i++) {
    visits[i].out = i + 1 < visits.length ? visits[i + 1].in : opts.duration
  }
  return visits
    .flatMap((v) => splitOnMoves(v, samples))
    .filter((v) => v.out > v.in)
}

/** A visit cut wherever its window's frame changed; a stretch of changing is the ground's. */
function splitOnMoves(
  v: StageVisit,
  samples: readonly WindowSample[],
): StageVisit[] {
  if (!v.win) return [v]
  const id = v.win.id
  const parts: StageVisit[] = []
  let cur: StageVisit = {
    win: windowsAt(samples, v.in).find((w) => w.id === id) ?? v.win,
    in: v.in,
    out: v.out,
  }
  for (const s of samples) {
    const t = s.t / 1000
    if (t <= v.in) continue
    if (t >= v.out) break
    const now = s.windows.find((w) => w.id === id) ?? null
    if (sameFrame(now, cur.win)) continue
    parts.push({ ...cur, out: t })
    cur = { win: now, in: t, out: v.out }
  }
  parts.push(cur)
  // A part that another change cut short was the window on its way somewhere.
  const settled = parts.map((p, i) =>
    i + 1 < parts.length && p.out - p.in < STAGE_MOVE_SETTLE_S
      ? { ...p, win: null }
      : p,
  )
  const merged: StageVisit[] = []
  for (const p of settled) {
    const last = merged.at(-1)
    if (last && last.win === null && p.win === null) last.out = p.out
    else merged.push({ ...p })
  }
  return merged
}

/** What the stage planner needs of the frame planner's options. */
export interface StagePlanOptions {
  width: number
  height: number
  style?: ZoomStyleName
  params?: Partial<ZoomStyleParams>
  lead?: number
  duration?: number
  steps?: readonly StepSpan[] | null
  windows?: readonly WindowSample[] | null
}

const round = (v: number): number => Math.round(v * 1000) / 1000
const clamp = (v: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, v))

/**
 * Plans a stage take. `plan` is the frame planner (handed in, so this file
 * and it do not import each other); `clear` keeps spans out of the
 * stretches nothing may be proposed over.
 */
export function planStageZoom<O extends StagePlanOptions>(
  track: CursorTrack,
  options: O,
  frame: {
    plan: (track: CursorTrack, options: O) => ZoomSpan[]
    clear: (spans: ZoomSpan[]) => ZoomSpan[]
  },
): ZoomSpan[] {
  const samples = options.windows ?? []
  const { width, height } = options
  const style = resolveZoomStyle(options.style, options.params)
  const lead = options.lead ?? style.lead
  const duration =
    options.duration ?? (track.length ? track[track.length - 1].t / 1000 : 0)
  const visits = stageVisits(track, samples, { lead, duration })

  const spans: ZoomSpan[] = []
  for (const v of visits) {
    if (v.out - v.in < 0.3) continue
    const inVisit = track.filter(
      (e) => e.t / 1000 >= v.in && e.t / 1000 < v.out,
    )
    const from = round(v.in)
    const kept = (list: ZoomSpan[]): ZoomSpan[] =>
      list
        .filter((z) => z.out > from)
        .map((z) => ({ ...z, in: Math.max(z.in, from) }))
        .filter((z) => z.out - z.in >= 0.3)
    const win = v.win
    if (!win || !(win.w > 0) || !(win.h > 0)) {
      // On the ground the stage is the frame, as on any take.
      spans.push(
        ...kept(
          frame.plan(inVisit, { ...options, windows: null, duration: v.out }),
        ),
      )
      continue
    }
    const local = inVisit.map((e) => toWindow(e, win))
    // How much closer the stage's camera stands to show what a take of the
    // window alone would show at level 1: the window edge to edge.
    const fit = Math.max(1, Math.min(width / win.w, height / win.h))
    const restLevel = clampZoomLevel(
      Math.min(width / win.w, height / win.h) * STAGE_WINDOW_FILL,
    )
    // …and no closer than a reader needs: the whole window when it is a
    // small one, else the least of the stage a beat may show.
    const closest = Math.max(
      restLevel,
      (width * style.maxLevel) / STAGE_VIEW_REF,
    )
    const mapped = kept(
      frame.plan(local, {
        ...options,
        width: win.w,
        height: win.h,
        windows: null,
        duration: v.out,
      }),
    ).map((z) => {
      const level = clampZoomLevel(Math.min(z.level * fit, closest))
      return {
        ...z,
        level,
        cx: round(
          within(win.x, win.w, width, level, (win.x + z.cx * win.w) / width),
        ),
        cy: round(
          within(win.y, win.h, height, level, (win.y + z.cy * win.h) / height),
        ),
      }
    })
    // Two beats the limits brought to one framing, end to end, are one span:
    // the camera does not move between them, so there is nothing to chain.
    for (let i = mapped.length - 1; i > 0; i--) {
      const a = mapped[i - 1]
      const b = mapped[i]
      if (
        b.in - a.out <= 0.05 &&
        a.level === b.level &&
        a.focusMode === b.focusMode &&
        a.id.replace(/\d+$/, '') === b.id.replace(/\d+$/, '') &&
        Math.abs(a.cx - b.cx) <= 0.005 &&
        Math.abs(a.cy - b.cy) <= 0.005
      ) {
        a.out = b.out
        mapped.splice(i, 1)
      }
    }
    spans.push(...mapped)

    if (restLevel < STAGE_REST_MIN_LEVEL) continue
    // The whole window, held inside the frame: one at the stage's edge gives
    // up its centring before the framing shows what is past the stage.
    const half = 0.5 / restLevel
    const cx = round(clamp((win.x + win.w / 2) / width, half, 1 - half))
    const cy = round(clamp((win.y + win.h / 2) / height, half, 1 - half))
    const taken = [...mapped].sort((a, b) => a.in - b.in)
    let at = from
    const rest = (a: number, b: number): void => {
      if (b - a < STAGE_REST_MIN_S) return
      spans.push({
        id: 'w',
        in: round(a),
        out: round(b),
        level: restLevel,
        cx,
        cy,
        source: 'auto',
      })
    }
    for (const z of taken) {
      rest(at, z.in)
      at = Math.max(at, z.out)
    }
    rest(at, Math.min(v.out, duration))
  }

  // Ids are the frame planner's, numbered again across the whole take in
  // time order, so the same track gives the same ids whatever its visits.
  const count = new Map<string, number>()
  return frame
    .clear(spans)
    .sort((a, b) => a.in - b.in)
    .map((z) => {
      const origin = z.id.replace(/\d+$/, '')
      const n = count.get(origin) ?? 0
      count.set(origin, n + 1)
      return { ...z, id: `${origin}${n}` }
    })
}

/**
 * A beat's focus on one axis, kept inside the window it is in: the view
 * (1/level of the frame) does not run past the window's edge onto the
 * ground, and a window smaller than the view is centred in it.
 */
function within(
  start: number,
  length: number,
  frame: number,
  level: number,
  focus: number,
): number {
  const view = 1 / level
  const lo = start / frame
  const hi = (start + length) / frame
  if (hi - lo <= view) return (lo + hi) / 2
  return clamp(focus, lo + view / 2, hi - view / 2)
}

/** An event in a window's own space, as a take of that window alone would hold it. */
function toWindow(e: CursorEvent, win: StageWindow): CursorEvent {
  return {
    ...e,
    x: e.x - win.x,
    y: e.y - win.y,
    ...(e.rect
      ? { rect: { ...e.rect, x: e.rect.x - win.x, y: e.rect.y - win.y } }
      : {}),
  }
}
