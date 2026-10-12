import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { previewPages } from '../render'

/**
 * Every LOAD tears the running program down and starts it again, so the
 * preview host must send it once. A host that repeated LOAD until READY
 * restarted any program whose setup outlived the retry interval (models,
 * fonts or sound still downloading), and such a program never finished.
 */
const config = {
  version: 2,
  duration: 2,
  camera: { preset: 'fullscreen' },
  createContent: '(ctx) => ({ objects: [] })',
  createTimeline: '(ctx) => ctx.gsap.timeline({ paused: true })',
}

function runHost() {
  const { hostHtml } = previewPages(config)
  const script = /<script>([\s\S]*)<\/script>/.exec(hostHtml)?.[1] ?? ''
  const sent: { type: string }[] = []
  let onMessage: (e: { data: unknown }) => void = () => {}
  const el = () => ({ textContent: '', addEventListener: () => {} })
  const frame = {
    contentWindow: { postMessage: (m: { type: string }) => sent.push(m) },
  }
  const document = {
    getElementById: (id: string) => (id === 'p' ? frame : el()),
  }
  const window = {
    addEventListener: (_t: string, fn: typeof onMessage) => {
      onMessage = fn
    },
  }
  new Function('document', 'window', script)(document, window)
  return { sent, fromPlayer: (data: unknown) => onMessage({ data }) }
}

describe('the preview host loads a program once', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('sends one LOAD on BRIDGE_READY, however long the program takes to be ready', () => {
    const { sent, fromPlayer } = runHost()
    fromPlayer({ type: 'BRIDGE_READY', protocol: 10, editor: false })
    vi.advanceTimersByTime(30_000)
    expect(sent.filter((m) => m.type === 'LOAD')).toHaveLength(1)
  })

  it('finds a bridge whose BRIDGE_READY it missed with a read-only probe, then loads once', () => {
    const { sent, fromPlayer } = runHost()
    vi.advanceTimersByTime(600)
    expect(sent.filter((m) => m.type === 'LOAD')).toHaveLength(0)
    expect(sent.some((m) => m.type === 'GET_STACK_STATE')).toBe(true)
    fromPlayer({ type: 'STACK_STATE', requestId: 0, entries: [] })
    vi.advanceTimersByTime(30_000)
    expect(sent.filter((m) => m.type === 'LOAD')).toHaveLength(1)
  })
})
