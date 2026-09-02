/**
 * The studio's lane adapters — the app's opinion of its timeline: a video lane
 * (segments as clips; trim/split/remove), a speed lane (rate spans; retime/
 * re-rate/remove), and a zoom lane (zoom regions as clips; move/resize/add/
 * remove). Zoom spans and speed spans are SOURCE-anchored in the doc, so lanes
 * map them through the RATED segment list both ways (display: sourceToTimeline/
 * spanOutputExtent; gestures: mapTime) — output positions contract/stretch
 * with speed changes.
 */
import {
  mapTime,
  removeSegment,
  segmentRate,
  sourceToTimeline,
  splitBySpeed,
  totalDuration,
  trimSegment,
} from '@vosjs/timeline'
import { ratedSegments, spanOutputExtent } from '../lower/lowerToComposition'
import { docOutputDuration, voiceKey } from '../audioBeds'
import { anchorSourceDuration, isRecordingDoc } from '../doc/studioDoc'
import {
  CAM_SPAN_MIN,
  DEFAULT_CAM_POSE,
  DEFAULT_TILT_POSE,
  DEFAULT_ZOOM_LEVEL,
  OVERLAY_MIN_DURATION,
  SPEED_SPAN_MIN,
  TILT_SPAN_MIN,
  ZOOM_SPAN_MIN,
  clipLength,
} from '../types'
import type { StudioDoc } from '../doc/studioDoc'
import type { Segment } from '@vosjs/timeline'
import type { ProjectDoc, SpeedSpan } from '../types'
import type { LaneAdapter, LaneItem } from '@vosjs/editor'

/** The doc's segments in canonical explicit form (empty = one full-source span). */
export function effectiveSegments(doc: StudioDoc): Segment[] {
  if (isRecordingDoc(doc) && doc.segments.length) return doc.segments
  return [{ in: 0, out: anchorSourceDuration(doc) }]
}

/** Output-time length of one DOC segment with the doc's speed spans applied. */
const outputLen = (seg: Segment, speeds: readonly SpeedSpan[]): number =>
  totalDuration(splitBySpeed([seg], speeds))

/** Output-time starts of the DOC segments (speed-aware). */
const segmentStarts = (
  segments: Segment[],
  speeds: readonly SpeedSpan[],
): number[] => {
  const starts: number[] = []
  let acc = 0
  for (const s of segments) {
    starts.push(acc)
    acc += outputLen(s, speeds)
  }
  return starts
}

export const videoLane: LaneAdapter<ProjectDoc> = {
  id: 'video',
  label: 'Video',

  items(doc): LaneItem[] {
    const segments = effectiveSegments(doc)
    const speeds = doc.speed ?? []
    const starts = segmentStarts(segments, speeds)
    return segments.map((s, i) => ({
      id: `seg-${i}`,
      kind: 'clip',
      t: starts[i],
      duration: outputLen(s, speeds),
    }))
  },

  gesture(doc, g) {
    const segments = effectiveSegments(doc)
    const speeds = doc.speed ?? []
    const sourceDuration = anchorSourceDuration(doc)

    switch (g.type) {
      case 'move': {
        // Dragging a segment REORDERS the cut sequence: pull it out, then
        // insert where the dragged start lands among the remaining segments
        // (midpoint rule). Single-segment docs have nothing to reorder.
        // NOTE ids are index-based (`seg-N`) — mid-drag the live doc reorders
        // under a frozen id, which is fine for the math (the anchoring
        // contract evaluates against the pointer-down doc) but means the drag
        // highlight can momentarily sit on a neighbor. Cosmetic only.
        if (segments.length < 2) return null
        const index = segIndex(g.id)
        if (index < 0 || index >= segments.length) return null
        const seg = segments[index]
        const others = segments.filter((_, i) => i !== index)
        let acc = 0
        let insert = others.length
        for (let i = 0; i < others.length; i++) {
          const dur = outputLen(others[i], speeds)
          if (g.t < acc + dur / 2) {
            insert = i
            break
          }
          acc += dur
        }
        if (insert === index) return null
        const next = [...others]
        next.splice(insert, 0, seg)
        return (d) => {
          d.segments = next
        }
      }
      case 'resize': {
        const index = segIndex(g.id)
        if (index < 0 || index >= segments.length) return null
        const seg = segments[index]
        // Translate the dragged output delta into a SOURCE edge position by
        // walking the full-source rate map (speed spans apply everywhere, so
        // an edge dragged across a 2× span consumes source 2× as fast — and
        // trimmed footage can still be dragged back out past the segment).
        const starts = segmentStarts(segments, speeds)
        const fullMap = splitBySpeed([{ in: 0, out: sourceDuration }], speeds)
        const edgeSrc = g.edge === 'start' ? seg.in : seg.out
        const edgeOutNow =
          g.edge === 'start'
            ? starts[index]
            : starts[index] + outputLen(seg, speeds)
        const anchorOut =
          sourceToTimeline(fullMap, Math.min(edgeSrc, sourceDuration)) ??
          edgeSrc
        const sourceT = mapTime(fullMap, anchorOut + (g.t - edgeOutNow))
        const next = trimSegment(
          segments,
          index,
          g.edge === 'start' ? 'in' : 'out',
          sourceT,
          sourceDuration,
        )
        return (d) => {
          d.segments = next
        }
      }
      case 'create': {
        // Split under the playhead: locate the DOC segment whose output span
        // contains g.t (speed-aware starts), map the local output offset to a
        // source moment through that segment's own rated pieces, split there.
        // Doc segments never carry rates — those stay in doc.speed. No-op at
        // boundaries (either half would be degenerate), like splitSegments.
        const starts = segmentStarts(segments, speeds)
        const index = segments.findIndex(
          (s, i) => g.t >= starts[i] && g.t < starts[i] + outputLen(s, speeds),
        )
        if (index < 0) return null
        const s = segments[index]
        const sourceT = mapTime(splitBySpeed([s], speeds), g.t - starts[index])
        if (sourceT - s.in < 0.05 || s.out - sourceT < 0.05) return null
        const next = [
          ...segments.slice(0, index),
          { ...s, out: sourceT },
          { ...s, in: sourceT },
          ...segments.slice(index + 1),
        ]
        return (d) => {
          d.segments = next
        }
      }
      case 'remove': {
        const next = removeSegment(segments, segIndex(g.id))
        if (next.length === segments.length) return null
        return (d) => {
          d.segments = next
        }
      }
      default:
        return null
    }
  },

  magnets(doc): number[] {
    const segments = effectiveSegments(doc)
    const speeds = doc.speed ?? []
    const starts = segmentStarts(segments, speeds)
    return [
      ...starts,
      ...(starts.length
        ? [
            starts[starts.length - 1] +
              outputLen(segments[segments.length - 1], speeds),
          ]
        : []),
    ]
  },
}

/**
 * Zoom lane — zoom regions as clips ("1.80×"). Spans are SOURCE-anchored
 * (footage-anchored like speed spans and the cam window); the lane displays
 * the output extent of each span's KEPT footage (spanOutputExtent — partial
 * cuts snap the clip's edges, full cuts hide it until the trim is undone).
 * Move/resize are pointer-true through the FULL rated map — zoom never alters
 * rates, so no exclusion trick is needed (unlike speedLane). Spans never
 * overlap: create no-ops inside an existing span, move pushes out of
 * collisions (or no-ops), resize clamps against neighbors. Level/focus are
 * edited in the toolbar/inspector, not by gesture. Any gesture promotes the
 * span to source:'manual' — it survives an auto-zoom regenerate.
 */
export const zoomLane: LaneAdapter<ProjectDoc> = {
  id: 'zoom',
  label: 'Zoom',

  items(doc): LaneItem[] {
    const segments = ratedSegments(doc)
    return doc.zoom.flatMap((z) => {
      const ext = spanOutputExtent(segments, z.in, z.out)
      return ext === null
        ? []
        : [
            {
              id: z.id,
              kind: 'clip' as const,
              t: round(ext.start),
              duration: round(ext.end - ext.start),
              label: `${z.level.toFixed(2)}×`,
            },
          ]
    })
  },

  gesture(doc, g) {
    const spans = doc.zoom
    const rated = ratedSegments(doc)
    const sourceDuration = anchorSourceDuration(doc)

    if (g.type === 'create') {
      const srcT = mapTime(rated, Math.max(0, g.t))
      if (spans.some((z) => srcT >= z.in && srcT < z.out)) return null
      const next = spans
        .filter((z) => z.in > srcT)
        .sort((a, b) => a.in - b.in)
        .at(0)
      const limit = Math.min(sourceDuration, next ? next.in : sourceDuration)
      const len = Math.min(spanDefaultLen(sourceDuration), limit - srcT)
      if (len < ZOOM_SPAN_MIN * rateAt(rated, srcT)) return null
      const id = nextZoomId(doc)
      // Seed the focus from the cursor at the playhead (element-aware capture
      // means the cursor usually sits on the thing worth framing); center for
      // uploads with no track.
      const { cx, cy } = cursorFocusAt(doc, srcT)
      return (d) => {
        d.zoom = [
          ...d.zoom,
          {
            id,
            in: round(srcT),
            out: round(srcT + len),
            level: DEFAULT_ZOOM_LEVEL,
            cx,
            cy,
            source: 'manual' as const,
          },
        ].sort((a, b) => a.in - b.in)
      }
    }

    const sp = spans.find((z) => z.id === g.id)
    if (!sp) return null
    const others = spans.filter((o) => o.id !== g.id)

    if (g.type === 'move') {
      // Keep the SOURCE span length; retarget its start to the dragged output
      // position. Push out of any collision toward the nearer side; if it
      // still collides (dense lane), no-op rather than overlap.
      const len = sp.out - sp.in
      let newIn = clampToKept(
        effectiveSegments(doc),
        mapTime(rated, Math.max(0, g.t)),
        len,
      )
      for (const o of others) {
        if (newIn < o.out && newIn + len > o.in) {
          const centerDelta = newIn + len / 2 - (o.in + o.out) / 2
          newIn = centerDelta < 0 ? o.in - len : o.out
        }
      }
      newIn = clampToKept(effectiveSegments(doc), newIn, len)
      if (newIn < 0 || newIn + len > sourceDuration) return null
      if (others.some((o) => newIn < o.out && newIn + len > o.in)) return null
      return (d) => {
        const z = d.zoom.find((x) => x.id === g.id)
        if (!z) return
        z.in = round(newIn)
        z.out = round(newIn + len)
        z.source = 'manual'
        d.zoom.sort((a, b) => a.in - b.in)
      }
    }

    if (g.type === 'resize') {
      const lo = Math.max(
        0,
        ...others.filter((o) => o.out <= sp.in).map((o) => o.out),
      )
      const hi = Math.min(
        sourceDuration,
        ...others.filter((o) => o.in >= sp.out).map((o) => o.in),
      )
      const sourceT = mapTime(rated, Math.max(0, g.t))
      // The floor is OUTPUT seconds: convert through the rate in force so a
      // span under a 5× speed-up cannot shrink to a sliver of screen time.
      // Never larger than the span's CURRENT length — a floor that exceeded
      // the room to a neighbour would shove the edge PAST the neighbour, and
      // a span already below floor must stay resizable, not grow by force.
      const minSrc = Math.min(
        ZOOM_SPAN_MIN * rateAt(rated, sp.in),
        sp.out - sp.in,
      )
      const next =
        g.edge === 'start'
          ? {
              in: Math.min(Math.max(lo, sourceT), sp.out - minSrc),
              out: sp.out,
            }
          : {
              in: sp.in,
              out: Math.max(Math.min(hi, sourceT), sp.in + minSrc),
            }
      return (d) => {
        const z = d.zoom.find((x) => x.id === g.id)
        if (!z) return
        z.in = round(next.in)
        z.out = round(next.out)
        z.source = 'manual'
      }
    }

    // Only 'remove' remains in the gesture union.
    return (d) => {
      d.zoom = d.zoom.filter((z) => z.id !== g.id)
    }
  },

  magnets(doc): number[] {
    return zoomLane.items(doc).flatMap((i) => [i.t, i.t + (i.duration ?? 0)])
  },
}

/**
 * Focus seed for a new zoom: the cursor position nearest the playhead's source
 * moment, normalized to the cursor coordinate space (meta.width/height —
 * CursorEvent.x/y after normalizeCaptureSpace). Center when there's no track.
 */
function cursorFocusAt(
  doc: ProjectDoc,
  srcT: number,
): { cx: number; cy: number } {
  const track = doc.source.cursor
  const { width, height } = doc.source.meta
  if (!track.length || !width || !height) return { cx: 0.5, cy: 0.5 }
  const ms = srcT * 1000
  let best = track[0]
  for (const e of track)
    if (Math.abs(e.t - ms) < Math.abs(best.t - ms)) best = e
  const clamp01 = (v: number) => Math.max(0, Math.min(1, v))
  return {
    cx: round(clamp01(best.x / width)),
    cy: round(clamp01(best.y / height)),
  }
}

/**
 * Tilt lane — card-pose regions as clips (label = "rx°/ry°"). SOURCE-anchored
 * like zoom spans (footage-anchored through trims and speed changes; the full
 * rated map applies — tilt doesn't alter rates); non-overlapping. The pose
 * itself is edited in the span editor (like zoom level), not by gesture. Any
 * gesture promotes the span to source:'manual' — it survives a Dynamic-tilt
 * regenerate (the auto-zoom wand contract).
 */
export const tiltLane: LaneAdapter<ProjectDoc> = {
  id: 'tilt',
  label: 'Tilt',

  items(doc): LaneItem[] {
    const segments = ratedSegments(doc)
    return (doc.tilt ?? []).flatMap((z) => {
      const ext = spanOutputExtent(segments, z.in, z.out)
      return ext === null
        ? []
        : [
            {
              id: z.id,
              kind: 'clip' as const,
              t: round(ext.start),
              duration: round(ext.end - ext.start),
              label: `${formatDeg(z.rx)}°/${formatDeg(z.ry)}°`,
            },
          ]
    })
  },

  gesture(doc, g) {
    const spans = doc.tilt ?? []
    const rated = ratedSegments(doc)
    const sourceDuration = anchorSourceDuration(doc)

    if (g.type === 'create') {
      const srcT = mapTime(rated, Math.max(0, g.t))
      if (spans.some((z) => srcT >= z.in && srcT < z.out)) return null
      const next = spans
        .filter((z) => z.in > srcT)
        .sort((a, b) => a.in - b.in)
        .at(0)
      const limit = Math.min(sourceDuration, next ? next.in : sourceDuration)
      const len = Math.min(spanDefaultLen(sourceDuration), limit - srcT)
      if (len < TILT_SPAN_MIN * rateAt(rated, srcT)) return null
      const id = nextTiltId(doc)
      return (d) => {
        d.tilt = [
          ...(d.tilt ?? []),
          {
            id,
            in: round(srcT),
            out: round(srcT + len),
            rx: DEFAULT_TILT_POSE.rx,
            ry: DEFAULT_TILT_POSE.ry,
            source: 'manual' as const,
          },
        ].sort((a, b) => a.in - b.in)
      }
    }

    const sp = spans.find((z) => z.id === g.id)
    if (!sp) return null
    const others = spans.filter((o) => o.id !== g.id)

    if (g.type === 'move') {
      // Keep the SOURCE span length; retarget its start to the dragged output
      // position. Push out of any collision toward the nearer side; if it
      // still collides (dense lane), no-op rather than overlap.
      const len = sp.out - sp.in
      let newIn = clampToKept(
        effectiveSegments(doc),
        mapTime(rated, Math.max(0, g.t)),
        len,
      )
      for (const o of others) {
        if (newIn < o.out && newIn + len > o.in) {
          const centerDelta = newIn + len / 2 - (o.in + o.out) / 2
          newIn = centerDelta < 0 ? o.in - len : o.out
        }
      }
      newIn = clampToKept(effectiveSegments(doc), newIn, len)
      if (newIn < 0 || newIn + len > sourceDuration) return null
      if (others.some((o) => newIn < o.out && newIn + len > o.in)) return null
      return (d) => {
        const z = (d.tilt ?? []).find((x) => x.id === g.id)
        if (!z || !d.tilt) return
        z.in = round(newIn)
        z.out = round(newIn + len)
        z.source = 'manual'
        d.tilt.sort((a, b) => a.in - b.in)
      }
    }

    if (g.type === 'resize') {
      const lo = Math.max(
        0,
        ...others.filter((o) => o.out <= sp.in).map((o) => o.out),
      )
      const hi = Math.min(
        sourceDuration,
        ...others.filter((o) => o.in >= sp.out).map((o) => o.in),
      )
      const sourceT = mapTime(rated, Math.max(0, g.t))
      const minSrc = Math.min(
        TILT_SPAN_MIN * rateAt(rated, sp.in),
        sp.out - sp.in,
      )
      const next =
        g.edge === 'start'
          ? {
              in: Math.min(Math.max(lo, sourceT), sp.out - minSrc),
              out: sp.out,
            }
          : {
              in: sp.in,
              out: Math.max(Math.min(hi, sourceT), sp.in + minSrc),
            }
      return (d) => {
        const z = (d.tilt ?? []).find((x) => x.id === g.id)
        if (!z) return
        z.in = round(next.in)
        z.out = round(next.out)
        z.source = 'manual'
      }
    }

    // Only 'remove' remains in the gesture union.
    return (d) => {
      d.tilt = (d.tilt ?? []).filter((z) => z.id !== g.id)
    }
  },

  magnets(doc): number[] {
    return tiltLane.items(doc).flatMap((i) => [i.t, i.t + (i.duration ?? 0)])
  },
}

/** Degrees for clip labels: whole numbers stay whole ("6", not "6.0"). */
function formatDeg(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(1)
}

/**
 * Cam-move lane — animated cam layout regions as clips (label = the
 * pose size as a percent when set). SOURCE-anchored like tilt spans (the
 * full rated map applies); non-overlapping. The pose itself is edited on the
 * canvas or in the span editor, never by lane gesture. Structurally the tilt
 * lane with a different payload; kept separate so neither lane's clamps can
 * drift the other's.
 */
export const camMoveLane: LaneAdapter<ProjectDoc> = {
  id: 'camMove',
  label: 'Cam move',

  items(doc): LaneItem[] {
    if (!doc.source.camKey) return []
    const segments = ratedSegments(doc)
    return (doc.camMotion ?? []).flatMap((z) => {
      const ext = spanOutputExtent(segments, z.in, z.out)
      return ext === null
        ? []
        : [
            {
              id: z.id,
              kind: 'clip' as const,
              t: round(ext.start),
              duration: round(ext.end - ext.start),
              label: z.size != null ? `${Math.round(z.size * 100)}%` : 'Move',
            },
          ]
    })
  },

  gesture(doc, g) {
    const spans = doc.camMotion ?? []
    const rated = ratedSegments(doc)
    const sourceDuration = anchorSourceDuration(doc)

    if (g.type === 'create') {
      if (!doc.source.camKey) return null
      const srcT = mapTime(rated, Math.max(0, g.t))
      if (spans.some((z) => srcT >= z.in && srcT < z.out)) return null
      const next = spans
        .filter((z) => z.in > srcT)
        .sort((a, b) => a.in - b.in)
        .at(0)
      const limit = Math.min(sourceDuration, next ? next.in : sourceDuration)
      const len = Math.min(spanDefaultLen(sourceDuration), limit - srcT)
      if (len < CAM_SPAN_MIN * rateAt(rated, srcT)) return null
      const id = nextCamMoveId(doc)
      return (d) => {
        d.camMotion = [
          ...(d.camMotion ?? []),
          {
            id,
            in: round(srcT),
            out: round(srcT + len),
            ...DEFAULT_CAM_POSE,
            source: 'manual' as const,
          },
        ].sort((a, b) => a.in - b.in)
      }
    }

    const sp = spans.find((z) => z.id === g.id)
    if (!sp) return null
    const others = spans.filter((o) => o.id !== g.id)

    if (g.type === 'move') {
      const len = sp.out - sp.in
      let newIn = clampToKept(
        effectiveSegments(doc),
        mapTime(rated, Math.max(0, g.t)),
        len,
      )
      for (const o of others) {
        if (newIn < o.out && newIn + len > o.in) {
          const centerDelta = newIn + len / 2 - (o.in + o.out) / 2
          newIn = centerDelta < 0 ? o.in - len : o.out
        }
      }
      newIn = clampToKept(effectiveSegments(doc), newIn, len)
      if (newIn < 0 || newIn + len > sourceDuration) return null
      if (others.some((o) => newIn < o.out && newIn + len > o.in)) return null
      return (d) => {
        const z = (d.camMotion ?? []).find((x) => x.id === g.id)
        if (!z || !d.camMotion) return
        z.in = round(newIn)
        z.out = round(newIn + len)
        z.source = 'manual'
        d.camMotion.sort((a, b) => a.in - b.in)
      }
    }

    if (g.type === 'resize') {
      const lo = Math.max(
        0,
        ...others.filter((o) => o.out <= sp.in).map((o) => o.out),
      )
      const hi = Math.min(
        sourceDuration,
        ...others.filter((o) => o.in >= sp.out).map((o) => o.in),
      )
      const sourceT = mapTime(rated, Math.max(0, g.t))
      const minSrc = Math.min(
        CAM_SPAN_MIN * rateAt(rated, sp.in),
        sp.out - sp.in,
      )
      const next =
        g.edge === 'start'
          ? {
              in: Math.min(Math.max(lo, sourceT), sp.out - minSrc),
              out: sp.out,
            }
          : {
              in: sp.in,
              out: Math.max(Math.min(hi, sourceT), sp.in + minSrc),
            }
      return (d) => {
        const z = (d.camMotion ?? []).find((x) => x.id === g.id)
        if (!z) return
        z.in = round(next.in)
        z.out = round(next.out)
        z.source = 'manual'
      }
    }

    // Only 'remove' remains in the gesture union.
    return (d) => {
      d.camMotion = (d.camMotion ?? []).filter((z) => z.id !== g.id)
    }
  },

  magnets(doc): number[] {
    return camMoveLane.items(doc).flatMap((i) => [i.t, i.t + (i.duration ?? 0)])
  },
}

/**
 * Webcam lane — the Cam member row of the take group. Its clips are the
 * visibility window INTERSECTED with each kept segment, at the video lane's
 * exact output positions, so a split on the Video row visibly splits this row
 * too. Gestures still edit only the WINDOW (`cam.window`, SOURCE time,
 * footage-anchored): move slides it (dragging any of its clips moves the one
 * window), resize lives on the window's REAL edges — the first clip's start
 * and the last clip's end; the cut boundaries between them belong to the
 * Video row. There is no remove — hide the bubble via its panel.
 */
export const camLane: LaneAdapter<ProjectDoc> = {
  id: 'cam',
  label: 'Cam',

  items(doc): LaneItem[] {
    if (!doc.source.camKey || !doc.cam.visible) return []
    const segments = effectiveSegments(doc)
    const speeds = doc.speed ?? []
    const starts = segmentStarts(segments, speeds)
    const first = segments[0]
    const last = segments[segments.length - 1]
    const win = doc.cam.window ?? { in: first.in, out: last.out }
    const items: LaneItem[] = []
    segments.forEach((s, i) => {
      const a = Math.max(s.in, win.in)
      const b = Math.min(s.out, win.out)
      if (b - a <= 1e-6) return
      items.push({
        id: `cam-${i}`,
        kind: 'clip',
        t: round(starts[i] + outputLen({ in: s.in, out: a }, speeds)),
        duration: round(outputLen({ in: a, out: b }, speeds)),
      })
    })
    return items
  },

  gesture(doc, g) {
    if (g.type !== 'move' && g.type !== 'resize') return null
    if (!g.id.startsWith('cam-')) return null
    const rated = ratedSegments(doc)
    const sourceDuration = anchorSourceDuration(doc)
    const current = doc.cam.window ?? { in: 0, out: sourceDuration }
    const eff = effectiveSegments(doc)
    const first = eff[0]
    const last = eff[eff.length - 1]
    if (g.type === 'move') {
      // Slide the whole window by the dragged clip's SOURCE delta — all the
      // row's clips are ONE window, so dragging any of them moves it.
      const index = Number(g.id.slice(4))
      const seg = eff.at(index)
      if (!seg) return null
      const clipSrcStart = Math.max(seg.in, Math.max(current.in, first.in))
      const span = Math.max(0.05, current.out - current.in)
      const delta = mapTime(rated, Math.max(0, g.t)) - clipSrcStart
      const base = Math.max(first.in, current.in)
      const newIn = Math.min(
        Math.max(first.in, base + delta),
        Math.max(first.in, last.out - span),
      )
      return (d) => {
        d.cam.window = { in: round(newIn), out: round(newIn + span) }
      }
    }
    // Only the window's REAL edges resize; interior edges are cut boundaries.
    // Derived from the window itself (not items(), which gates on camKey):
    // the first/last kept segment the window overlaps carry its edges.
    const overlapping = eff
      .map((s, i) => ({
        i,
        len: Math.min(s.out, current.out) - Math.max(s.in, current.in),
      }))
      .filter((x) => x.len > 1e-6)
    const edgeIdx =
      g.edge === 'start' ? overlapping.at(0)?.i : overlapping.at(-1)?.i
    if (edgeIdx === undefined || g.id !== `cam-${edgeIdx}`) return null
    const sourceT = Math.min(Math.max(mapTime(rated, g.t), 0), sourceDuration)
    const next =
      g.edge === 'start'
        ? { in: Math.min(sourceT, current.out - 0.05), out: current.out }
        : { in: current.in, out: Math.max(sourceT, current.in + 0.05) }
    return (d) => {
      d.cam.window = {
        in: round(Math.max(0, next.in)),
        out: round(Math.min(sourceDuration, next.out)),
      }
    }
  },

  magnets(doc): number[] {
    return camLane.items(doc).flatMap((i) => [i.t, i.t + (i.duration ?? 0)])
  },
}

/**
 * Mic sub-row of the take group: mirrors the video lane's cut boundaries
 * EXACTLY — one clip per kept segment at the same output positions — so the
 * voice visibly cuts and splits with the footage. VIEW-ONLY by design: cutting
 * happens on the Video row, because the take has ONE shared `segments` list
 * (that is what makes sub-track desync structurally impossible; per-row
 * segments would only buy bugs). Selecting a clip opens the Voice panel
 * (level/mute); the waveform is the row's content, so items carry no label.
 */
export const micLane: LaneAdapter<ProjectDoc> = {
  id: 'mic',
  label: 'Mic',

  items(doc): LaneItem[] {
    if (!voiceKey(doc)) return []
    const segments = effectiveSegments(doc)
    const speeds = doc.speed ?? []
    const starts = segmentStarts(segments, speeds)
    return segments.map((s, i) => ({
      id: `mic-${i}`,
      kind: 'clip',
      t: starts[i],
      duration: outputLen(s, speeds),
    }))
  },

  gesture() {
    return null
  },

  magnets() {
    return []
  },
}

/** Default new-span length in SOURCE seconds (openscreen-style: ≥1s, ~5% of the take). */
const spanDefaultLen = (sourceDuration: number): number =>
  Math.max(1, sourceDuration * 0.05)

/** Rate in force at a SOURCE moment (1 outside every rated piece). */
function rateAt(rated: Segment[], srcT: number): number {
  for (const p of rated)
    if (srcT >= p.in - 1e-9 && srcT < p.out + 1e-9) return segmentRate(p)
  return 1
}

/**
 * Keep a moved span's START on KEPT footage (as corrected
 * 2026-08-24). The only thing this guards is the span vanishing: a
 * start inside removed footage renders nothing and looks deleted. It is NOT
 * a wall at the cut — a span is source-anchored and legitimately straddles a
 * cut, so a drag pushes it ACROSS the line continuously (the first cut of
 * this clamp held a span flush behind the cut until its whole length had
 * passed, which read as "nothing can be dragged into the next clip"). The
 * tail may extend into cut footage; the lane draws the kept part.
 */
function clampToKept(kept: Segment[], newIn: number, len: number): number {
  void len
  let home: Segment | null = null
  let bestD = Infinity
  for (const s of kept) {
    const d = newIn < s.in ? s.in - newIn : newIn >= s.out ? newIn - s.out : 0
    if (d < bestD) {
      bestD = d
      home = s
    }
  }
  if (!home) return newIn
  const hi = Math.max(home.in, home.out - MIN_VISIBLE)
  return Math.min(Math.max(home.in, newIn), hi)
}

/** A span start must keep at least this much kept footage under it (s). */
const MIN_VISIBLE = 0.05

/** New spans speed UP by default — the archetypal screen-recording edit. */
const DEFAULT_SPEED_RATE = 2

/**
 * Speed lane — rate spans as clips ("2×"). Spans are SOURCE-anchored (footage
 * follows them through trims); the lane displays them at the output positions
 * of the rated pieces they produce, so a span visually contracts as its rate
 * grows. Spans never overlap: create no-ops inside an existing span, move
 * pushes out of collisions (or no-ops), resize clamps against neighbors.
 * The rate itself is edited in the toolbar (like zoom level), not by gesture.
 * Move/resize are POINTER-TRUE: the dragged edge's resulting output position
 * is exactly the pointer's (mapped through the rate map without this span),
 * so edges never lag the pointer at 1/rate speed.
 */
export const speedLane: LaneAdapter<ProjectDoc> = {
  id: 'speed',
  label: 'Speed',

  items(doc): LaneItem[] {
    const rated = ratedSegments(doc)
    return (doc.speed ?? []).flatMap((sp) => {
      // Output extent: accumulate the rated pieces this span produced
      // (containment match — spans don't overlap and pieces never cross span
      // boundaries). A span whose footage is fully cut away has no pieces and
      // renders nothing — it follows its footage, like zoom keyframes.
      let acc = 0
      let start: number | null = null
      let end = 0
      for (const p of rated) {
        const len = Math.max(0, p.out - p.in) / segmentRate(p)
        if (
          p.rate === sp.rate &&
          p.in >= sp.in - 1e-9 &&
          p.out <= sp.out + 1e-9
        ) {
          if (start === null) start = acc
          end = acc + len
        }
        acc += len
      }
      return start === null
        ? []
        : [
            {
              id: sp.id,
              kind: 'clip' as const,
              t: round(start),
              duration: round(end - start),
              label: `${sp.rate}×`,
            },
          ]
    })
  },

  gesture(doc, g) {
    const spans = doc.speed ?? []
    const rated = ratedSegments(doc)
    const sourceDuration = anchorSourceDuration(doc)

    if (g.type === 'create') {
      const srcT = mapTime(rated, Math.max(0, g.t))
      if (spans.some((s) => srcT >= s.in && srcT < s.out)) return null
      const next = spans
        .filter((s) => s.in > srcT)
        .sort((a, b) => a.in - b.in)
        .at(0)
      const limit = Math.min(sourceDuration, next ? next.in : sourceDuration)
      const len = Math.min(spanDefaultLen(sourceDuration), limit - srcT)
      if (len < SPEED_SPAN_MIN * DEFAULT_SPEED_RATE) return null
      const id = nextSpeedId(doc)
      return (d) => {
        d.speed = [
          ...(d.speed ?? []),
          {
            id,
            in: round(srcT),
            out: round(srcT + len),
            rate: DEFAULT_SPEED_RATE,
            source: 'manual' as const,
          },
        ].sort((a, b) => a.in - b.in)
      }
    }

    const sp = spans.find((s) => s.id === g.id)
    if (!sp) return null

    // POINTER-TRUE mapping: move/resize evaluate output positions through the
    // rate map WITHOUT the edited span. Mapping through the full map would
    // re-rate the footage being dragged across mid-gesture, making the edge
    // chase the pointer at 1/rate speed (and the clip land short of the drop).
    // With the span excluded, the dragged edge's resulting output position is
    // exactly g.t — the edge stays under the pointer.
    const others = spans.filter((o) => o.id !== g.id)
    const base = splitBySpeed(effectiveSegments(doc), others)

    if (g.type === 'move') {
      // Keep the SOURCE span length; retarget its start to the dragged output
      // position. Push out of any collision toward the nearer side; if it
      // still collides (dense lane), no-op rather than overlap.
      const len = sp.out - sp.in
      let newIn = clampToKept(
        effectiveSegments(doc),
        mapTime(base, Math.max(0, g.t)),
        len,
      )
      for (const o of others) {
        if (newIn < o.out && newIn + len > o.in) {
          const centerDelta = newIn + len / 2 - (o.in + o.out) / 2
          newIn = centerDelta < 0 ? o.in - len : o.out
        }
      }
      newIn = clampToKept(effectiveSegments(doc), newIn, len)
      if (newIn < 0 || newIn + len > sourceDuration) return null
      if (others.some((o) => newIn < o.out && newIn + len > o.in)) return null
      return (d) => {
        const s = d.speed?.find((x) => x.id === g.id)
        if (!s) return
        s.in = round(newIn)
        s.out = round(newIn + len)
        s.source = 'manual'
        d.speed!.sort((a, b) => a.in - b.in)
      }
    }

    if (g.type === 'resize') {
      const prev = others.filter((o) => o.out <= sp.in).map((o) => o.out)
      const nextIn = others.filter((o) => o.in >= sp.out).map((o) => o.in)
      const lo = Math.max(0, ...prev)
      const hi = Math.min(sourceDuration, ...nextIn)
      // The floor is OUTPUT seconds through the span's OWN rate: a 2× span
      // may not shrink below 0.5s of source (= 0.25s of screen). The old bare
      // `0.1` was a SOURCE floor — at 5× that was 20ms of screen, the sliver.
      const minSrc = Math.min(SPEED_SPAN_MIN * sp.rate, sp.out - sp.in)
      let next: { in: number; out: number }
      if (g.edge === 'start') {
        // Footage before the new in-point is unaffected by this span, so its
        // output position IS mapTime(base, g.t) — pointer-true directly.
        const sourceT = mapTime(base, Math.max(0, g.t))
        next = {
          in: Math.min(Math.max(lo, sourceT), sp.out - minSrc),
          out: sp.out,
        }
      } else {
        // Place the new out-point so the span's output END lands at g.t:
        // the span occupies (out - in) / rate output seconds after its start.
        const startOut = sourceToTimeline(base, sp.in) ?? sp.in
        const sourceT = sp.in + sp.rate * Math.max(0, g.t - startOut)
        next = {
          in: sp.in,
          out: Math.max(Math.min(hi, sourceT), sp.in + minSrc),
        }
      }
      return (d) => {
        const s = d.speed?.find((x) => x.id === g.id)
        if (!s) return
        s.in = round(next.in)
        s.out = round(next.out)
        s.source = 'manual'
      }
    }

    // Only 'remove' remains in the gesture union.
    return (d) => {
      d.speed = (d.speed ?? []).filter((s) => s.id !== g.id)
    }
  },

  magnets(doc): number[] {
    return speedLane.items(doc).flatMap((i) => [i.t, i.t + (i.duration ?? 0)])
  },
}

/**
 * Music/SFX lane — clips are OUTPUT-anchored (`clip.start` is final-cut
 * seconds; they do NOT follow footage through trims — see AudioClip). Move
 * retimes `start`; resizing trims into the source file: the start edge shifts
 * `in` and `start` together (content stays put under the untouched edge), the
 * end edge adjusts `out`. Clips are created from the audio inspector, not by
 * double-click (there is no meaningful "blank" audio clip).
 */
export const audioLane: LaneAdapter<ProjectDoc> = {
  id: 'audio',
  label: 'Audio',

  items(doc): LaneItem[] {
    return doc.audio.map((c) => ({
      id: c.id,
      kind: 'clip',
      t: round(c.start),
      duration: round(clipLength(c)),
      label: c.name,
    }))
  },

  gesture(doc, g) {
    if (g.type === 'move') {
      const clip = doc.audio.find((c) => c.id === g.id)
      if (!clip) return null
      const start = Math.max(0, g.t)
      return (d) => {
        const c = d.audio.find((x) => x.id === g.id)
        if (c) c.start = round(start)
      }
    }
    if (g.type === 'resize') {
      const clip = doc.audio.find((c) => c.id === g.id)
      if (!clip) return null
      if (g.edge === 'start') {
        if (clip.loop) {
          // Looping head-trim: keep the END fixed, shrink/grow the placed length
          // (the loop phase, not the source in-point, is what the edge drags).
          const end = clip.start + clipLength(clip)
          const newStart = Math.min(Math.max(0, g.t), end - 0.1)
          return (d) => {
            const c = d.audio.find((x) => x.id === g.id)
            if (!c) return
            c.start = round(newStart)
            c.loopLen = round(end - newStart)
          }
        }
        // Trim the head: consume/restore source material while the tail stays put.
        const delta = g.t - clip.start
        const newIn = Math.min(Math.max(0, clip.in + delta), clip.out - 0.05)
        const newStart = Math.max(0, clip.start + (newIn - clip.in))
        return (d) => {
          const c = d.audio.find((x) => x.id === g.id)
          if (!c) return
          c.in = round(newIn)
          c.start = round(newStart)
        }
      }
      if (clip.loop) {
        // Looping end-trim: the placed length is unbounded — the span repeats.
        const newLen = Math.max(0.1, g.t - clip.start)
        return (d) => {
          const c = d.audio.find((x) => x.id === g.id)
          if (c) c.loopLen = round(newLen)
        }
      }
      const span = Math.max(0.05, g.t - clip.start)
      const newOut = Math.min(clip.in + span, clip.duration)
      return (d) => {
        const c = d.audio.find((x) => x.id === g.id)
        if (c) c.out = round(Math.max(c.in + 0.05, newOut))
      }
    }
    if (g.type === 'remove') {
      if (!doc.audio.some((c) => c.id === g.id)) return null
      return (d) => {
        d.audio = d.audio.filter((c) => c.id !== g.id)
      }
    }
    return null
  },

  magnets(doc): number[] {
    return doc.audio.flatMap((c) => [
      round(c.start),
      round(c.start + clipLength(c)),
    ])
  },
}

/** Smallest unused overlay id. */
function nextOverlayId(doc: ProjectDoc): string {
  let n = 0
  while ((doc.overlays ?? []).some((o) => o.id === `t${n}`)) n++
  return `t${n}`
}

/**
 * Pose-diamond item ids: `{clipId}::k{index}` — a keyframe LaneItem
 * riding its clip's lane. Index-addressed into the clip's UNSORTED `motion`
 * array (writes never reorder it; the lowering sorts), so the id stays stable
 * through a drag that crosses a sibling pose.
 */
const POSE_ID = /^(.+)::k(\d+)$/
export function parsePoseId(
  id: string,
): { clipId: string; index: number } | null {
  const m = POSE_ID.exec(id)
  return m ? { clipId: m[1], index: Number(m[2]) } : null
}

/** Diamond items for a clip's poses (clip-local `at` → absolute lane time). */
function poseItems(
  clipId: string,
  start: number,
  duration: number,
  motion: readonly { at: number }[] | undefined,
): LaneItem[] {
  return (motion ?? []).map((p, i) => ({
    id: `${clipId}::k${i}`,
    kind: 'keyframe' as const,
    t: round(start + Math.min(Math.max(0, p.at), duration)),
  }))
}

/**
 * Text-overlay lane (compositor v2) — clips are OUTPUT-anchored like audio
 * (`start` is final-cut seconds; a title never retimes with trims/speed).
 * Overlaps are allowed (two titles can coexist — z-order is array order).
 * Create adds a house 'title' clip at the playhead, centered, lower-third.
 */
export const overlaysLane: LaneAdapter<ProjectDoc> = {
  id: 'overlays',
  label: 'Text',

  items(doc): LaneItem[] {
    return (doc.overlays ?? []).flatMap((o) => [
      {
        id: o.id,
        kind: 'clip' as const,
        t: round(o.start),
        duration: round(o.duration),
        label:
          o.kind === 'text'
            ? o.text.split('\n')[0].slice(0, 24) || 'Text'
            : o.kind === 'image'
              ? 'Image'
              : 'Video',
      },
      // Pose diamonds render after the clips, so they sit on top.
      ...poseItems(o.id, o.start, o.duration, o.motion),
    ])
  },

  gesture(doc, g) {
    const overlays = doc.overlays ?? []

    // Pose diamonds: retime within the clip, or remove. The diamond's
    // absolute lane time maps back to clip-local `at`.
    if (g.type !== 'create') {
      const kf = parsePoseId(g.id)
      if (kf) {
        const clip = overlays.find((o) => o.id === kf.clipId)
        const pose = clip?.motion?.[kf.index]
        if (!clip || !pose) return null
        if (g.type === 'move') {
          const at = Math.min(Math.max(0, g.t - clip.start), clip.duration)
          return (d) => {
            const o = (d.overlays ?? []).find((x) => x.id === kf.clipId)
            const p = o?.motion?.[kf.index]
            if (p) p.at = round(at)
          }
        }
        if (g.type === 'remove') {
          return (d) => {
            const o = (d.overlays ?? []).find((x) => x.id === kf.clipId)
            if (!o?.motion) return
            const next = o.motion.filter((_, i) => i !== kf.index)
            if (next.length) o.motion = next
            else delete o.motion
          }
        }
        return null
      }
    }

    if (g.type === 'create') {
      // Either document's output length: overlays ride the program
      // anchor too, whose length is not a footage sum.
      const outDur = docOutputDuration(doc)
      const start = Math.min(
        Math.max(0, g.t),
        Math.max(0, outDur - OVERLAY_MIN_DURATION),
      )
      const len = Math.max(OVERLAY_MIN_DURATION, Math.min(3, outDur - start))
      const id = nextOverlayId(doc)
      return (d) => {
        d.overlays = [
          ...(d.overlays ?? []),
          {
            id,
            kind: 'text' as const,
            start: round(start),
            duration: round(len),
            text: 'Title',
            preset: 'title' as const,
            // Frame fractions: centered, lower-third — at any aspect ratio.
            transform: { x: 0.5, y: 0.82, scale: 1, rotation: 0 },
          },
        ]
      }
    }

    const clip = overlays.find((o) => o.id === g.id)
    if (!clip) return null

    if (g.type === 'move') {
      const start = Math.max(0, g.t)
      return (d) => {
        const o = (d.overlays ?? []).find((x) => x.id === g.id)
        if (o) o.start = round(start)
      }
    }
    if (g.type === 'resize') {
      if (g.edge === 'start') {
        // Keep the END fixed; the head drags start + duration together.
        const end = clip.start + clip.duration
        const newStart = Math.min(Math.max(0, g.t), end - OVERLAY_MIN_DURATION)
        return (d) => {
          const o = (d.overlays ?? []).find((x) => x.id === g.id)
          if (!o) return
          o.start = round(newStart)
          o.duration = round(end - newStart)
        }
      }
      const newLen = Math.max(OVERLAY_MIN_DURATION, g.t - clip.start)
      return (d) => {
        const o = (d.overlays ?? []).find((x) => x.id === g.id)
        if (o) o.duration = round(newLen)
      }
    }
    // Only 'remove' remains (the gesture union is exhausted above).
    return (d) => {
      d.overlays = (d.overlays ?? []).filter((o) => o.id !== g.id)
    }
  },

  magnets(doc): number[] {
    return (doc.overlays ?? []).flatMap((o) => [
      round(o.start),
      round(o.start + o.duration),
    ])
  },
}

/**
 * Object lane — world-space props. Clips show the span (objects with no
 * span render as a full-length block and don't move — the span IS the lane's
 * noun). Created from the toolbar; asset/transform edited in the inspector.
 */
export const objectsLane: LaneAdapter<ProjectDoc> = {
  id: 'objects',
  label: '3D',

  items(doc): LaneItem[] {
    const outDur = docOutputDuration(doc)
    return (doc.objects ?? []).flatMap((o) => [
      {
        id: o.id,
        kind: 'clip' as const,
        t: round(o.span?.start ?? 0),
        duration: round(o.span?.duration ?? outDur),
        label:
          o.asset.kind === 'primitive'
            ? o.asset.shape
            : o.asset.kind === 'text3d'
              ? o.asset.text
              : 'model',
      },
      // Pose diamonds: clip-local `at` from the span start (0 span-less).
      ...poseItems(
        o.id,
        o.span?.start ?? 0,
        o.span?.duration ?? outDur,
        o.motion,
      ),
    ])
  },

  gesture(doc, g) {
    const objects = doc.objects ?? []
    if (g.type === 'create') return null // toolbar-created (needs asset choice)

    // Pose diamonds: retime within the clip, or remove.
    const kf = parsePoseId(g.id)
    if (kf) {
      const outDur = docOutputDuration(doc)
      const clip = objects.find((o) => o.id === kf.clipId)
      const pose = clip?.motion?.[kf.index]
      if (!clip || !pose) return null
      const start = clip.span?.start ?? 0
      const dur = clip.span?.duration ?? outDur
      if (g.type === 'move') {
        const at = Math.min(Math.max(0, g.t - start), dur)
        return (d) => {
          const o = (d.objects ?? []).find((x) => x.id === kf.clipId)
          const p = o?.motion?.[kf.index]
          if (p) p.at = round(at)
        }
      }
      if (g.type === 'remove') {
        return (d) => {
          const o = (d.objects ?? []).find((x) => x.id === kf.clipId)
          if (!o?.motion) return
          const next = o.motion.filter((_, i) => i !== kf.index)
          if (next.length) o.motion = next
          else delete o.motion
        }
      }
      return null
    }

    const clip = objects.find((o) => o.id === g.id)
    if (!clip) return null
    if (g.type === 'move') {
      if (!clip.span) return null
      const start = Math.max(0, g.t)
      return (d) => {
        const o = (d.objects ?? []).find((x) => x.id === g.id)
        if (o?.span) o.span.start = round(start)
      }
    }
    if (g.type === 'resize') {
      if (!clip.span) return null
      if (g.edge === 'start') {
        const end = clip.span.start + clip.span.duration
        const newStart = Math.min(Math.max(0, g.t), end - OVERLAY_MIN_DURATION)
        return (d) => {
          const o = (d.objects ?? []).find((x) => x.id === g.id)
          if (!o?.span) return
          o.span.start = round(newStart)
          o.span.duration = round(end - newStart)
        }
      }
      const newLen = Math.max(OVERLAY_MIN_DURATION, g.t - clip.span.start)
      return (d) => {
        const o = (d.objects ?? []).find((x) => x.id === g.id)
        if (o?.span) o.span.duration = round(newLen)
      }
    }
    // remove
    return (d) => {
      d.objects = (d.objects ?? []).filter((o) => o.id !== g.id)
    }
  },

  magnets(doc): number[] {
    return (doc.objects ?? []).flatMap((o) =>
      o.span
        ? [round(o.span.start), round(o.span.start + o.span.duration)]
        : [],
    )
  },
}

/** Smallest unused user-span id (planner spans are `z{n}`). */
function nextZoomId(doc: ProjectDoc): string {
  let n = 0
  while (doc.zoom.some((z) => z.id === `u${n}`)) n++
  return `u${n}`
}

/** Smallest unused user tilt-span id (Dynamic-tilt wand spans are `t{n}`). */
function nextTiltId(doc: ProjectDoc): string {
  let n = 0
  while ((doc.tilt ?? []).some((z) => z.id === `u${n}`)) n++
  return `u${n}`
}

/** Smallest unused cam-move span id (`m{n}` — reserved `auto` never collides). */
function nextCamMoveId(doc: ProjectDoc): string {
  let n = 0
  while ((doc.camMotion ?? []).some((z) => z.id === `m${n}`)) n++
  return `m${n}`
}

function nextSpeedId(doc: ProjectDoc): string {
  let n = 0
  while ((doc.speed ?? []).some((s) => s.id === `sp${n}`)) n++
  return `sp${n}`
}

function segIndex(id: string): number {
  return Number(id.replace('seg-', ''))
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000
}
