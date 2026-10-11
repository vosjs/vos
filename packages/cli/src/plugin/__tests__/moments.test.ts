import { describe, expect, it } from 'vitest'
import { STEP_SETTLE_SECONDS, resolveStepTime } from '../moments'
import { DEFAULT_CAM_STYLE, DEFAULT_CURSOR_STYLE } from '@vosjs/studio-core'
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

describe('resolveStepTime', () => {
  it('reads step:<id>, step:<index> and an offset', () => {
    const d = doc(STEPS)
    expect(resolveStepTime(d, 'step:open')).toBeCloseTo(
      4.1 - 2 + STEP_SETTLE_SECONDS,
      6,
    )
    expect(resolveStepTime(d, 'step:2')).toBeCloseTo(
      4.1 - 2 + STEP_SETTLE_SECONDS,
      6,
    )
    expect(resolveStepTime(d, 'step:open+1.5')).toBeCloseTo(4.1 - 2 + 1.5, 6)
    expect(resolveStepTime(d, 'step:open-0.5')).toBeCloseTo(4.1 - 2 - 0.5, 6)
    expect(resolveStepTime(d, '3.5')).toBeNull()
  })

  it('an unknown or trimmed step is refused in words', () => {
    expect(() => resolveStepTime(doc(STEPS), 'step:nope')).toThrow(
      /no step "nope".*hover-a/,
    )
    expect(() => resolveStepTime(doc(STEPS), 'step:late')).toThrow(
      /outside the cut/,
    )
    expect(() => resolveStepTime(doc(undefined), 'step:open')).toThrow(
      /carries none/,
    )
  })
})
