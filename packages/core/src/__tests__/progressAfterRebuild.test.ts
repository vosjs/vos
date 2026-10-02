import { describe, expect, it } from 'vitest'
import { generateRenderTemplate } from '../runtime/renderTemplate'

/**
 * The transport reports the LIVE timeline. A data swap can rebuild the
 * content and its timeline in place, carrying the progress callback over to
 * the new timeline; the reporter must read the new one, never the killed one
 * its closure was made over. Run for real: the reporter's code lifted out of
 * the generated page, over fake timelines.
 */

type FakeTl = {
  t: number
  cb: (() => void) | null
  edits: unknown[] | null
  time: () => number
  progress: () => number
  duration: () => number
  seek: (t: number) => void
  eventCallback: (name: string, fn?: () => void) => (() => void) | null
  applyEdits: (e: unknown[]) => void
}

const fakeTl = (t: number): FakeTl => {
  const tl: FakeTl = {
    t,
    cb: null,
    edits: null,
    time: () => tl.t,
    progress: () => tl.t / 15,
    duration: () => 15,
    seek: (to) => {
      tl.t = to
      tl.cb?.()
    },
    eventCallback: (_name, fn) => {
      if (fn === undefined) return tl.cb
      tl.cb = fn
      return null
    },
    applyEdits: (e) => {
      tl.edits = e
    },
  }
  return tl
}

type Env = {
  current: { timeline: FakeTl } | null
  tweenEdits: unknown[] | null
}

function reporter() {
  const html = generateRenderTemplate('', { mode: 'playback' })
  const start = html.indexOf('const __liveTimeline')
  const end = html.indexOf('// Warm load / swap.')
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  const posted: { time: number; duration: number }[] = []
  const env: Env = { current: null, tweenEdits: null }
  const body = html
    .slice(start, end)
    .replaceAll('__current', 'env.current')
    .replaceAll('__tweenEdits', 'env.tweenEdits')
  const make = new Function(
    'env',
    '__post',
    `const __finiteDuration = (tl) => tl.duration();
     const __epoch = 1;
     ${body}
     return { __attachProgress, __afterDataSwap };`,
  )
  const api = make(env, (m: { time: number; duration: number }) =>
    posted.push(m),
  ) as {
    __attachProgress: (tl: FakeTl, epoch: number) => void
    __afterDataSwap: (before: FakeTl) => void
  }
  return { api, env, posted }
}

describe('the transport reports the live timeline', () => {
  it('reports the REBUILT timeline after a data swap, never the killed one', () => {
    const { api, env, posted } = reporter()
    const old = fakeTl(12)
    env.current = { timeline: old }
    api.__attachProgress(old, 1)
    // A data swap rebuilds the timeline and carries the callback over.
    const rebuilt = fakeTl(12)
    rebuilt.eventCallback('onUpdate', old.eventCallback('onUpdate')!)
    env.current = { timeline: rebuilt }
    api.__afterDataSwap(old)
    posted.length = 0
    rebuilt.seek(3)
    rebuilt.seek(7.5)
    expect(posted.map((m) => m.time)).toEqual([3, 7.5])
  })

  it('applies the host tween edits to a rebuilt timeline and says where it is', () => {
    const { api, env, posted } = reporter()
    const old = fakeTl(4)
    env.tweenEdits = [{ index: 0, duration: 2 }]
    const rebuilt = fakeTl(4)
    env.current = { timeline: rebuilt }
    api.__afterDataSwap(old)
    expect(rebuilt.edits).toEqual([{ index: 0, duration: 2 }])
    expect(posted.at(-1)?.time).toBe(4)
  })

  it('a swap that keeps the timeline posts nothing extra', () => {
    const { api, env, posted } = reporter()
    const same = fakeTl(2)
    env.current = { timeline: same }
    api.__afterDataSwap(same)
    expect(posted).toHaveLength(0)
  })
})
