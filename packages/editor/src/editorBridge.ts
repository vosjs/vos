/**
 * Editor-bridge client — the host-side counterpart of the engine's editor-mode
 * bridge (@vosjs/core 0.4, `generateRenderTemplate({ editor: true })`):
 * request/response correlation for HIT_TEST / GET_ELEMENT_RECTS and the
 * ephemeral SET_ELEMENT_PROPS channel. Headless and transport-agnostic: the
 * host supplies `post` (usually iframe.contentWindow.postMessage) and feeds
 * incoming player messages through `handleEvent`.
 *
 * Requests resolve with a fallback (null / []) after `timeoutMs` so a player
 * that is not in editor mode (or mid-reload) can never hang the UI.
 */
import type { ElementRect } from '@vosjs/core/runtime'

export type { ElementRect }

export interface EditorBridgeClient {
  /** Feed a player→host message; returns true when it was consumed. */
  handleEvent: (msg: unknown) => boolean
  /** Topmost element id at viewport CSS px, or null. */
  hitTest: (x: number, y: number) => Promise<string | null>
  getElementRects: () => Promise<ElementRect[]>
  /**
   * Ephemeral property override (element props proxy) — previews a gesture on
   * the running instance; does NOT survive a LOAD. The durable edit is a
   * config patch committed by the host.
   */
  setElementProps: (id: string, props: Record<string, number | boolean>) => void
  /** Rect pushes (the player posts them on resize) + rect responses. */
  onRects: (fn: (rects: ElementRect[]) => void) => () => void
  /** Reject-all outstanding requests (e.g. the iframe document reloaded). */
  reset: () => void
}

interface BridgeMessage {
  type?: string
  requestId?: number | null
  id?: string | null
  rects?: ElementRect[]
}

export function createEditorBridgeClient(
  post: (msg: Record<string, unknown>) => void,
  options: { timeoutMs?: number } = {},
): EditorBridgeClient {
  const timeoutMs = options.timeoutMs ?? 1000
  let nextRequestId = 1
  const pending = new Map<
    number,
    { settle: (msg: BridgeMessage | null) => void; timer: ReturnType<typeof setTimeout> }
  >()
  const rectSubs = new Set<(rects: ElementRect[]) => void>()

  const request = (msg: Record<string, unknown>): Promise<BridgeMessage | null> =>
    new Promise((resolve) => {
      const requestId = nextRequestId++
      const timer = setTimeout(() => {
        pending.delete(requestId)
        resolve(null)
      }, timeoutMs)
      pending.set(requestId, {
        settle: (m) => {
          clearTimeout(timer)
          pending.delete(requestId)
          resolve(m)
        },
        timer,
      })
      post({ ...msg, requestId })
    })

  return {
    handleEvent(raw: unknown): boolean {
      if (typeof raw !== 'object' || raw === null) return false
      const msg = raw as BridgeMessage
      if (msg.type === 'HIT_RESULT') {
        if (typeof msg.requestId === 'number') pending.get(msg.requestId)?.settle(msg)
        return true
      }
      if (msg.type === 'ELEMENT_RECTS') {
        if (typeof msg.requestId === 'number') pending.get(msg.requestId)?.settle(msg)
        // pushes (requestId null) and responses both refresh subscribers
        if (msg.rects) rectSubs.forEach((fn) => fn(msg.rects!))
        return true
      }
      return false
    },

    async hitTest(x, y) {
      const res = await request({ type: 'HIT_TEST', x, y })
      return res?.id ?? null
    },

    async getElementRects() {
      const res = await request({ type: 'GET_ELEMENT_RECTS' })
      return res?.rects ?? []
    },

    setElementProps(id, props) {
      post({ type: 'SET_ELEMENT_PROPS', id, props })
    },

    onRects(fn) {
      rectSubs.add(fn)
      return () => rectSubs.delete(fn)
    },

    reset() {
      for (const [, p] of pending) {
        clearTimeout(p.timer)
        p.settle(null)
      }
      pending.clear()
    },
  }
}
