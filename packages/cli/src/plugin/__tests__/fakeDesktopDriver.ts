import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { DesktopDriver } from '../recordApp'
import type { Command, CommandResult, RecordRequest } from '@vosjs/driver'

// A stand-in for @vosjs/driver, for the desktop verbs' tests: it records
// nothing, writes the take a real helper writes, answers a script's commands
// about a few known elements, and outlines a window of four controls.

export const FIELD = { x: 16, y: 60, w: 320, h: 28 }
export const BUTTON = { x: 560, y: 6, w: 80, h: 22 }

/** The track a person leaves: travel, a press, a sentence typed in a field, a press. */
export const TRACK = [
  ...Array.from({ length: 40 }, (_, i) => ({
    t: 1200 + i * 16,
    x: 120 + i * 12,
    y: 330 - i * 8,
    type: 'move',
  })),
  { t: 2358, x: 600, y: 17, type: 'down', button: 0, rect: BUTTON },
  { t: 2430, x: 600, y: 17, type: 'up', button: 0 },
  { t: 3055, x: 176, y: 74, type: 'key', rect: FIELD },
  { t: 3414, x: 176, y: 74, type: 'key', rect: FIELD },
  { t: 3790, x: 176, y: 74, type: 'key', rect: FIELD },
  { t: 5399, x: 600, y: 17, type: 'down', button: 0, rect: BUTTON },
  { t: 5470, x: 600, y: 17, type: 'up', button: 0 },
]

export interface FakeOptions {
  screenRecording?: boolean
  accessibility?: boolean
  /** What `record` fails with, as the driver's errors are shaped. */
  fail?: { code: string; message: string }
  heldFrames?: number
}

/** What the stand-in app has that a script can name. */
const ELEMENTS: Record<string, typeof FIELD> = {
  "button[id='save']": BUTTON,
  "textfield[id='title']": FIELD,
}

/** A driver that records nothing and writes the take a real one writes. */
export function fakeDriver(o: FakeOptions = {}) {
  const requests: RecordRequest[] = []
  const commands: Command[] = []
  const started = Date.now()
  /** Answers a script's command as the helper does, on a clock that began with the driver. */
  const send = async (command: Command): Promise<CommandResult> => {
    commands.push(command)
    const t = Date.now() - started
    const at = { ok: true as const, tStart: t, tEnd: t }
    if (command.do === 'now') return at
    const selector = 'selector' in command ? command.selector : undefined
    const rect = selector !== undefined ? ELEMENTS[selector] : undefined
    if (command.do === 'locate')
      return rect
        ? { ...at, count: 1, enabled: true, rect, name: 'Save' }
        : { ...at, count: 0 }
    if (selector !== undefined && !rect)
      return {
        ok: false,
        code: 'not-found',
        message: `Nothing in the window matches ${selector}.`,
      }
    return {
      ...at,
      ...(rect ? { rect, count: 1, enabled: true } : {}),
      ...(command.do === 'click' ? { pressed: true } : {}),
    }
  }
  const driver: DesktopDriver = {
    tree: async () => ({
      app: 'TextEdit',
      window: { w: 656, h: 422 },
      elements: [
        {
          role: 'button',
          name: 'Save',
          id: 'save',
          selector: "button[id='save']",
          unique: true,
          enabled: true,
          rect: BUTTON,
        },
        {
          role: 'textfield',
          name: 'Title',
          id: 'title',
          selector: "textfield[id='title']",
          unique: true,
          enabled: true,
          rect: FIELD,
        },
        {
          role: 'button',
          name: 'Again',
          selector: "button[name='Again']:nth(0)",
          unique: false,
          enabled: false,
          rect: { x: 150, y: 237, w: 82, h: 30 },
        },
        {
          role: 'button',
          selector: 'button:nth(3)',
          unique: false,
          enabled: true,
          rect: { x: 8, y: 8, w: 16, h: 16 },
        },
      ],
    }),
    still: async (request) => {
      await mkdir(join(request.out, '..'), { recursive: true })
      await writeFile(request.out, 'not a real picture')
      return {
        out: request.out,
        app: 'TextEdit',
        window: request.window ?? 41,
        width: 1312,
        height: 844,
        scale: 2,
        frame: { x: 185, y: 83, w: 656, h: 422 },
      }
    },
    check: async () => ({
      version: '0.1.2',
      protocol: 1,
      screenRecording: o.screenRecording ?? true,
      accessibility: o.accessibility ?? true,
      path: '/helper',
      bundleId: '',
      os: 'test',
    }),
    windows: async () => [
      {
        id: 41,
        app: 'TextEdit',
        appId: 'com.apple.TextEdit',
        titled: true,
        frame: { x: 185, y: 83, w: 656, h: 422 },
      },
      {
        id: 42,
        app: 'TextEdit',
        appId: 'com.apple.TextEdit',
        titled: false,
        frame: { x: 394, y: 338, w: 520, h: 222 },
      },
    ],
    record: (request) => {
      requests.push(request)
      if (o.fail) {
        const error = Object.assign(new Error(o.fail.message), {
          code: o.fail.code,
        })
        const failed = Promise.reject(error)
        failed.catch(() => {})
        return {
          pid: undefined,
          ready: failed,
          done: failed,
          stop: () => failed,
          send: () => failed,
        }
      }
      const write = async () => {
        await mkdir(request.out, { recursive: true })
        await writeFile(join(request.out, 'recording.mp4'), 'not a real video')
        await writeFile(join(request.out, 'cursor.json'), JSON.stringify(TRACK))
        await writeFile(
          join(request.out, 'meta.json'),
          JSON.stringify({
            dpr: 2,
            zoom: 1,
            t0: 1794475400000,
            durationMs: 6692,
            width: 656,
            height: 422,
            fps: 60,
            captureWidth: 1312,
            captureHeight: 844,
            captureSurface: 'app',
            platform: 'mac',
            producer: 'desktop',
            cornerRadius: 18.2,
            app: { name: 'TextEdit', id: 'com.apple.TextEdit' },
          }),
        )
      }
      const stopped = (reason: 'stop' | 'cap') =>
        ({
          event: 'stopped',
          reason,
          durationMs: 6692,
          frames: 386,
          idleFrames: 0,
          droppedFrames: 0,
          bytes: 16,
          events: TRACK.length,
          windowMoved: false,
          resized: false,
          sourceUpdates: 0,
          filterRefreshes: 0,
          heldFrames: o.heldFrames ?? 0,
          files: {
            recording: join(request.out, 'recording.mp4'),
            cursor: join(request.out, 'cursor.json'),
            meta: join(request.out, 'meta.json'),
          },
          clock: { t0Host: 0, arrivalLagMsMean: 0, arrivalLagMsMax: 0 },
        }) as never
      // A real take ends at its ceiling; the stand-in ends at once, as if it had.
      const done = write().then(() => stopped('cap'))
      return {
        pid: 1,
        ready: Promise.resolve({
          event: 'ready',
          protocol: 1,
          window: request.window ?? 41,
          app: 'TextEdit',
          frame: { x: 185, y: 83, w: 656, h: 422 },
          scale: 2,
          captureWidth: 1312,
          captureHeight: 844,
          filter: 'others-out',
          accessibility: true,
          cornerRadius: 18.2,
        } as never),
        done,
        stop: () => done,
        send,
      }
    },
  }
  return { driver, requests, commands }
}
