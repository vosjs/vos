import { describe, expect, it } from 'vitest'
import { STEP_SETTLE_SECONDS, stepOutputTime } from '../moments'
import {
  DEFAULT_CAM_STYLE,
  DEFAULT_CURSOR_STYLE,
  ratedSegments,
} from '@vosjs/studio-core'
import type { ProjectDoc, StepSpan } from '@vosjs/studio-core'

function doc(
  steps: StepSpan[] | undefined,
  zoom: ProjectDoc['zoom'] = [],
): ProjectDoc {
  return {
    source: {
      videoKey: 'blob:recording',
      cursor: [],
      meta: {
        dpr: 1,
        zoom: 1,
        t0: 0,
        durationMs: 20000,
        width: 1280,
        height: 720,
        fps: 30,
        steps,
      },
    },
    segments: [{ in: 2, out: 18 }],
    zoom,
    audio: [],
    cursor: DEFAULT_CURSOR_STYLE,
    cam: DEFAULT_CAM_STYLE,
    frame: {
      background: '#111',
      padding: 48,
      radius: 12,
      shadow: 0.4,
      border: 0,
      aspectRatio: 'native',
      browserBar: {
        kind: 'none',
        url: '',
        showUrl: true,
        showControls: true,
        height: 44,
      },
    },
    export: { resolution: '1080p', fps: 30, format: 'mp4' },
  }
}

const STEPS: StepSpan[] = [
  { step: 0, id: 'settle', do: 'wait', tStart: 0, tEnd: 0.9 },
  { step: 1, id: 'hover-a', do: 'hover', tStart: 0.9, tEnd: 2.6 },
  { step: 2, id: 'open', do: 'click', tStart: 2.6, tEnd: 4.1 },
  { step: 3, do: 'hover', tStart: 4.1, tEnd: 6.0, skipped: true },
  { step: 4, id: 'scroll', do: 'scroll', tStart: 6.0, tEnd: 7.2 },
  { step: 5, id: 'late', do: 'click', tStart: 18.5, tEnd: 19.2 },
]

describe('stepOutputTime', () => {
  it('lands a step at its gesture end plus the settle, in output seconds', () => {
    const rated = ratedSegments(doc(STEPS))
    expect(stepOutputTime(rated, STEPS[2], STEP_SETTLE_SECONDS)).toBeCloseTo(
      4.1 - 2 + STEP_SETTLE_SECONDS,
      6,
    )
  })

  it('answers null for a step the cut trimmed out', () => {
    const rated = ratedSegments(doc(STEPS))
    expect(stepOutputTime(rated, STEPS[5], STEP_SETTLE_SECONDS)).toBeNull()
  })
})
