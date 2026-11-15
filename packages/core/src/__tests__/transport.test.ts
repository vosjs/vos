import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { generateRenderTemplate } from '../runtime/renderTemplate'

/**
 * The transport, RUN: the playback document's own script, executed against
 * a window that records what it posts, loading a program whose timeline is
 * the real tween recorder's. What is asserted is what a program reads
 * (`window.__vos__.transport`, and `isPaused`, its mirror) after each
 * command, beside where the clock really is.
 */

interface Transport {
  playing: boolean
  speed: number
  epoch: number
}
interface Vos {
  transport: Transport
  isPaused?: boolean
  setGlobalPaused?: (paused: boolean) => void
  pauseCalls?: Array<boolean>
}
interface FakeWindow {
  parent: { postMessage: (msg: Record<string, unknown>) => void }
  addEventListener: (type: string, fn: (e: unknown) => void) => void
  innerWidth: number
  innerHeight: number
  devicePixelRatio: number
  __vos__?: Vos
  $fx?: {
    timeline: { time: () => number; paused: () => boolean } | null
  }
}

const g = globalThis as Record<string, unknown>

interface Deps {
  gsap: {
    timeline: (vars?: object) => {
      to: (target: object, vars: object) => unknown
      repeat: (n: number) => unknown
      kill: () => unknown
    }
  }
}

/**
 * What a compiled program with elements does on EVERY load: it resets
 * isPaused to true and installs the switch. The bridge has to put the truth
 * back after it.
 */
const program = (opts: { loop: boolean; timeline?: boolean }) => ({
  initVos: async (_root: unknown, deps: Deps) => {
    const ns = (g.window as FakeWindow).__vos__!
    ns.isPaused = true
    ns.pauseCalls = ns.pauseCalls || []
    ns.setGlobalPaused = (p) => {
      ns.isPaused = p
      ns.pauseCalls!.push(p)
    }
    if (opts.timeline === false) return { timeline: null, cleanup() {} }
    const tl = deps.gsap.timeline({ paused: true })
    tl.to({ x: 0 }, { x: 1, duration: 4 })
    if (opts.loop) tl.repeat(-1)
    return {
      timeline: tl,
      cleanup() {
        tl.kill()
      },
    }
  },
})

function boot() {
  const posted: Array<Record<string, unknown>> = []
  const listeners: Array<(e: unknown) => void> = []
  const win: FakeWindow = {
    parent: { postMessage: (msg) => void posted.push(msg) },
    addEventListener: (type, fn) => {
      if (type === 'message') listeners.push(fn)
    },
    innerWidth: 1280,
    innerHeight: 720,
    devicePixelRatio: 1,
  }
  g.window = win
  g.document = { body: {} }

  const html = generateRenderTemplate('', { mode: 'playback' })
  const body = html
    .split('<script type="module">')[1]
    .split('</script>')[0]
    .replace("import * as THREE from 'three';", '')
    // The document imports its program from a URL. Here the program is
    // handed over as the module it would have imported.
    .replace('await import(url)', 'await __module(url)')
  expect(body).toContain('await __module(url)')
  const modules = new Map<string, object>()
  new Function('THREE', '__module', body)({}, async (url: string) =>
    modules.get(url),
  )

  const send = (msg: Record<string, unknown>) => {
    for (const fn of listeners) fn({ source: win.parent, data: msg })
  }
  const load = async (
    mod: object,
    msg: Record<string, unknown> = {},
  ): Promise<void> => {
    const before = posted.filter((m) => m.type === 'READY').length
    const url = `data:program-${modules.size}`
    modules.set(url, mod)
    send({ type: 'LOAD', url, ...msg })
    await vi.waitFor(() => {
      const err = posted.find((m) => m.type === 'ERROR')
      if (err) throw new Error(String(err.error))
      expect(posted.filter((m) => m.type === 'READY').length).toBe(before + 1)
    })
    // READY is posted before the transport is restored; let that finish.
    await Promise.resolve()
  }
  const vos = () => win.__vos__!
  const time = () => win.$fx!.timeline!.time()
  return { send, load, vos, time, posted }
}

/** Run the play driver for `ms` of wall time, a frame at a time. */
async function run(ms: number) {
  await vi.advanceTimersByTimeAsync(ms)
}

describe('the transport a program reads', () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: [
        'setTimeout',
        'clearTimeout',
        'Date',
        'requestAnimationFrame',
        'cancelAnimationFrame',
      ],
    })
  })
  afterEach(() => {
    vi.useRealTimers()
    delete g.window
    delete g.document
    delete g.__vosTween
  })

  it('starts stopped, and a load that does not autoplay leaves it so', async () => {
    const { load, vos } = boot()
    expect(vos().transport).toEqual({ playing: false, speed: 1, epoch: 0 })
    await load(program({ loop: true }))
    expect(vos().transport.playing).toBe(false)
    expect(vos().isPaused).toBe(true)
  })

  it('an autoplay load is playing, though the program reset isPaused', async () => {
    const { load, vos, time } = boot()
    await load(program({ loop: true }), { autoplay: true })
    expect(vos().transport.playing).toBe(true)
    expect(vos().isPaused).toBe(false)
    await run(1000)
    expect(time()).toBeGreaterThan(0.9)
  })

  it('a seek leaves a playing timeline playing, from the new moment', async () => {
    const { load, send, vos, time } = boot()
    await load(program({ loop: true }))
    send({ type: 'PLAY' })
    await run(500)
    const epoch = vos().transport.epoch
    send({ type: 'SEEK_TIME', value: 2 })
    expect(vos().transport.playing).toBe(true)
    expect(vos().isPaused).toBe(false)
    expect(vos().transport.epoch).toBe(epoch + 1)
    await run(500)
    expect(time()).toBeGreaterThan(2.4)
    expect(time()).toBeLessThan(2.6)
    expect(vos().transport.epoch).toBe(epoch + 1)
  })

  it('a legacy progress seek does the same', async () => {
    const { load, send, vos, time } = boot()
    await load(program({ loop: true }))
    send({ type: 'PLAY' })
    await run(200)
    send({ type: 'SEEK', value: 0.5 })
    expect(vos().transport.playing).toBe(true)
    expect(vos().isPaused).toBe(false)
    await run(200)
    expect(time()).toBeGreaterThan(2.1)
  })

  it('a seek leaves a paused timeline paused', async () => {
    const { load, send, vos, time } = boot()
    await load(program({ loop: true }))
    send({ type: 'PLAY' })
    await run(300)
    send({ type: 'PAUSE' })
    send({ type: 'SEEK_TIME', value: 3 })
    expect(vos().transport.playing).toBe(false)
    expect(vos().isPaused).toBe(true)
    await run(500)
    expect(time()).toBe(3)
  })

  it('a warm load of a playing timeline is playing, where it was', async () => {
    const { load, send, vos, time } = boot()
    await load(program({ loop: true }))
    send({ type: 'PLAY' })
    await run(1000)
    const epoch = vos().transport.epoch
    const was = time()
    await load(program({ loop: true }))
    // The program's setup reset isPaused to true on the way in.
    expect(vos().transport.playing).toBe(true)
    expect(vos().isPaused).toBe(false)
    expect(time()).toBeCloseTo(was, 1)
    expect(vos().transport.epoch).toBe(epoch + 1)
  })

  it('a warm load of a paused timeline is paused', async () => {
    const { load, send, vos } = boot()
    await load(program({ loop: true }), { autoplay: true })
    send({ type: 'PAUSE' })
    await load(program({ loop: true }), { autoplay: true })
    expect(vos().transport.playing).toBe(false)
    expect(vos().isPaused).toBe(true)
  })

  it('carries the speed, and keeps it across a warm load', async () => {
    const { load, send, vos, time } = boot()
    await load(program({ loop: true }))
    send({ type: 'PLAY_SPEED', value: 2 })
    expect(vos().transport.speed).toBe(2)
    send({ type: 'PLAY' })
    await run(500)
    expect(time()).toBeGreaterThan(0.9)
    await load(program({ loop: true }))
    expect(vos().transport.speed).toBe(2)
  })

  it("ticks the epoch once when a loop wraps, and not while it doesn't", async () => {
    const { load, send, vos, time } = boot()
    await load(program({ loop: true }))
    send({ type: 'PLAY' })
    const epoch = vos().transport.epoch
    await run(3500)
    expect(vos().transport.epoch).toBe(epoch)
    await run(1000)
    expect(time()).toBeLessThan(1)
    expect(vos().transport.epoch).toBe(epoch + 1)
    expect(vos().transport.playing).toBe(true)
  })

  it('a timeline that does not loop stops at its end, and says so', async () => {
    const { load, send, vos, time } = boot()
    await load(program({ loop: false }))
    send({ type: 'PLAY' })
    await run(3000)
    expect(vos().transport.playing).toBe(true)
    await run(1500)
    expect(time()).toBe(4)
    expect(vos().transport.playing).toBe(false)
    expect(vos().isPaused).toBe(true)
  })

  it('tells the program only when the answer changes', async () => {
    const { load, send, vos } = boot()
    await load(program({ loop: true }))
    send({ type: 'PLAY' })
    await run(200)
    const calls = vos().pauseCalls!.length
    send({ type: 'SEEK_TIME', value: 1 })
    send({ type: 'SEEK_TIME', value: 2 })
    send({ type: 'PLAY_SPEED', value: 2 })
    send({ type: 'PLAY' })
    expect(vos().pauseCalls!.length).toBe(calls)
  })

  it('with no timeline, the last PLAY or PAUSE stands', async () => {
    const { load, send, vos } = boot()
    await load(program({ loop: false, timeline: false }))
    expect(vos().isPaused).toBe(true)
    send({ type: 'PLAY' })
    expect(vos().transport.playing).toBe(true)
    expect(vos().isPaused).toBe(false)
    send({ type: 'SEEK_TIME', value: 1 })
    expect(vos().isPaused).toBe(false)
    send({ type: 'PAUSE' })
    expect(vos().transport.playing).toBe(false)
    expect(vos().isPaused).toBe(true)
  })
})
