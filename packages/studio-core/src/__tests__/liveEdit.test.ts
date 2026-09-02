/**
 * No studio edit may reload the player.
 *
 * The take editor is an interpreter: `lowerToComposition` emits CONSTANT
 * function strings and every editable value travels in `ctx.data`, so the
 * compiled program is a STRUCTURAL HASH. `useComposition` compiles it without
 * data and hands it to the player, where `classifyEdit` reads any change to
 * that string as a program edit — a warm LOAD, which tears the scene down and
 * awaits a fresh module import with an empty body on screen (a black frame)
 * before it can paint again.
 *
 * So the invariant is byte equality of the compiled program, not "roughly the
 * same config": one changed character costs a visible reload on every edit of
 * that kind. This walks the whole editable surface of ProjectDoc and pins it.
 *
 * A genuinely structural edit would be a legitimate exception — but the doc has
 * none. Trims ride `data.duration` (the lowering bakes a placeholder), and
 * feature blocks (overlays, objects, tilt, audio) must be emitted
 * UNCONDITIONALLY so that adding the FIRST one is a data edit too.
 */
import { describe, expect, it } from 'vitest'
import { compileVosConfig } from '@vosjs/core'
import { lowerToComposition } from '../lower/lowerToComposition'
import { planAutoZoom } from '../planner/autoZoom'
import {
  DEFAULT_BROWSER_BAR,
  DEFAULT_CAM_STYLE,
  DEFAULT_CURSOR_STYLE,
  DEFAULT_FRAME_STYLE,
} from '../types'
import type { CursorTrack, ProjectDoc } from '../types'

const cursor: CursorTrack = [
  { t: 0, x: 100, y: 100, type: 'move' },
  {
    t: 1000,
    x: 960,
    y: 540,
    type: 'down',
    rect: { x: 900, y: 500, w: 120, h: 80 },
  },
  { t: 1100, x: 960, y: 540, type: 'up' },
  { t: 2000, x: 200, y: 200, type: 'move' },
]

const base: ProjectDoc = {
  source: {
    videoKey: 'opfs:recording-1',
    cursor,
    meta: {
      dpr: 2,
      zoom: 1,
      t0: 0,
      durationMs: 3000,
      width: 1920,
      height: 1080,
      fps: 30,
    },
  },
  segments: [{ in: 0, out: 3 }],
  zoom: planAutoZoom(cursor, { width: 1920, height: 1080 }),
  audio: [],
  cursor: DEFAULT_CURSOR_STYLE,
  cam: DEFAULT_CAM_STYLE,
  frame: DEFAULT_FRAME_STYLE,
  export: { resolution: '1080p', fps: 30, format: 'mp4' },
}

/**
 * Exactly what useComposition ships to the player: the config MINUS data —
 * the main program's AND every stack entry's (the shared layers ride
 * the studio entry's own data, delivered as `deps.stack` / SET_DATA target).
 */
function programOf(doc: ProjectDoc): string {
  const { config } = lowerToComposition(doc)
  const { data: _data, stack, ...programConfig } = config
  const entries = (stack as { data?: unknown }[]).map(
    ({ data: _d, ...entry }) => entry,
  )
  return compileVosConfig({ ...programConfig, stack: entries } as never)
}

const BASELINE = programOf(base)

/**
 * Every edit the studio can make, as a doc transform. Names read as the
 * gesture a person performs, so a failure names the control that reloads.
 */
const EDITS: [string, ProjectDoc][] = [
  // --- Timeline ------------------------------------------------------------
  ['trim (segments)', { ...base, segments: [{ in: 0.5, out: 2.5 }] }],
  [
    'split into two segments',
    {
      ...base,
      segments: [
        { in: 0, out: 1 },
        { in: 2, out: 3 },
      ],
    },
  ],
  ['untrim (empty segments)', { ...base, segments: [] }],
  [
    'speed span',
    { ...base, speed: [{ id: 's1', in: 0.5, out: 1.5, rate: 2 }] },
  ],

  // --- Camera --------------------------------------------------------------
  [
    'zoom span added',
    {
      ...base,
      zoom: [{ id: 'z1', in: 0.5, out: 2, level: 2, cx: 0.5, cy: 0.5 }],
    },
  ],
  ['zoom spans cleared', { ...base, zoom: [] }],
  [
    'zoom level changed',
    {
      ...base,
      zoom: [{ id: 'z1', in: 0.5, out: 2, level: 3.5, cx: 0.3, cy: 0.7 }],
    },
  ],
  [
    'zoom focus mode (cursor follow)',
    {
      ...base,
      zoom: [
        {
          id: 'z1',
          in: 0.5,
          out: 2,
          level: 2,
          cx: 0.5,
          cy: 0.5,
          focusMode: 'auto',
        },
      ],
    },
  ],
  [
    'zoom transition speed',
    {
      ...base,
      zoom: [
        {
          id: 'z1',
          in: 0.5,
          out: 2,
          level: 2,
          cx: 0.5,
          cy: 0.5,
          transition: 'instant',
        },
      ],
    },
  ],
  [
    'tilt transition speed',
    {
      ...base,
      tilt: [{ id: 't1', in: 0.5, out: 2, rx: 4, ry: -6, transition: 'fast' }],
    },
  ],
  ['camera style', { ...base, zoomStyle: 'cinema' }],
  ['camera style: none', { ...base, zoomStyle: 'none' }],
  ['zoom params override (Custom)', { ...base, zoomParams: { rampIn: 0.9 } }],
  [
    'tilt span added',
    { ...base, tilt: [{ id: 't1', in: 0.5, out: 2, rx: 4, ry: -6 }] },
  ],
  ['dynamic tilt style', { ...base, tiltStyle: 'medium' }],

  // --- Cursor --------------------------------------------------------------
  ['cursor hidden', { ...base, cursor: { ...base.cursor, visible: false } }],
  ['cursor size', { ...base, cursor: { ...base.cursor, size: 40 } }],
  ['cursor smoothing', { ...base, cursor: { ...base.cursor, smoothing: 0.6 } }],
  [
    'cursor hide-when-idle',
    { ...base, cursor: { ...base.cursor, hideWhenIdle: false } },
  ],
  [
    'click effects off',
    {
      ...base,
      cursor: {
        ...base.cursor,
        clickFx: { ...base.cursor.clickFx, style: 'none' },
      },
    },
  ],
  [
    'click effect style + intensity',
    {
      ...base,
      cursor: {
        ...base.cursor,
        clickFx: {
          ...base.cursor.clickFx,
          style: 'pulse',
          intensity: 'strong',
          color: '#ff0000',
        },
      },
    },
  ],

  // --- Frame / backdrop ----------------------------------------------------
  ['frame padding', { ...base, frame: { ...base.frame, padding: 0.2 } }],
  ['frame radius', { ...base, frame: { ...base.frame, radius: 40 } }],
  [
    'frame background colour',
    { ...base, frame: { ...base.frame, background: '#123456' } },
  ],
  [
    'frame border on, at its own width and colour',
    {
      ...base,
      frame: {
        ...base.frame,
        border: 0.6,
        borderWidth: 8,
        borderColor: '#0af',
      },
    },
  ],
  [
    'background media (vos loop)',
    {
      ...base,
      frame: {
        ...base.frame,
        backgroundMedia: {
          kind: 'video',
          key: 'blob:bg',
          duration: 4,
          dim: 0.3,
        },
      },
    },
  ],
  [
    'browser bar on',
    {
      ...base,
      frame: {
        ...base.frame,
        browserBar: {
          ...DEFAULT_BROWSER_BAR,
          kind: 'minimal',
          url: 'vos.so',
          theme: {
            id: 'ink',
            bar: '#101010',
            text: '#f5f5f5',
            pill: '#1e1e1e',
          },
        },
      },
    },
  ],

  // --- Webcam bubble -------------------------------------------------------
  ['cam hidden', { ...base, cam: { ...base.cam, visible: false } }],
  [
    'cam size + position',
    { ...base, cam: { ...base.cam, size: 0.4, position: 'top-right' } },
  ],
  ['cam free position', { ...base, cam: { ...base.cam, x: 0.7, y: 0.3 } }],
  [
    'FIRST cam move span added',
    {
      ...base,
      source: { ...base.source, camKey: 'blob:cam' },
      camMotion: [{ id: 'm1', in: 0.5, out: 2, x: 0.8, y: 0.2, size: 0.35 }],
    },
  ],
  [
    'cam move pose edited',
    {
      ...base,
      source: { ...base.source, camKey: 'blob:cam' },
      camMotion: [
        {
          id: 'm1',
          in: 0.5,
          out: 2,
          x: 0.3,
          y: 0.7,
          size: 0.5,
          ease: 'power2.out',
        },
      ],
    },
  ],

  // --- Audio split (AT): mic sidecar + per-track gains ---------------------
  [
    'mic sidecar attached',
    { ...base, source: { ...base.source, micKey: 'blob:mic' } },
  ],
  [
    'mic + system gains',
    {
      ...base,
      source: { ...base.source, micKey: 'blob:mic' },
      micGain: 0.4,
      systemGain: 0.7,
    },
  ],

  // --- Overlays ------------------------------------------------------------
  [
    'FIRST text overlay added',
    {
      ...base,
      overlays: [
        {
          id: 'o1',
          kind: 'text',
          start: 0.5,
          duration: 2,
          text: 'Hello',
          preset: 'title',
          transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0 },
        },
      ],
    },
  ],
  [
    'text overlay edited (content + position)',
    {
      ...base,
      overlays: [
        {
          id: 'o1',
          kind: 'text',
          start: 0.5,
          duration: 2,
          text: 'Goodbye, world',
          preset: 'caption',
          size: 64,
          color: '#00ff00',
          transform: { x: 0.2, y: 0.8, scale: 1.4, rotation: 8 },
        },
      ],
    },
  ],
  [
    'text overlay styled (family/weight/italic/align/spacing/stroke)',
    {
      ...base,
      overlays: [
        {
          id: 'o1',
          kind: 'text',
          start: 0.5,
          duration: 2,
          text: 'Hello',
          preset: 'title',
          family: 'Playfair Display',
          weight: 700,
          italic: true,
          align: 'right',
          letterSpacing: 2,
          lineHeight: 1.4,
          stroke: { color: '#000000', width: 2 },
          transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0 },
        },
      ],
    },
  ],
  [
    '3D text prop (text3d asset, glass material)',
    {
      ...base,
      objects: [
        {
          id: 'p1',
          asset: {
            kind: 'text3d',
            text: 'Launch',
            typeface: 'Bebas Neue',
            material: 'glass',
          },
          transform3d: {
            x: 0.5,
            y: 0.4,
            z: 0.5,
            rx: 0,
            ry: 0,
            rz: 0,
            scale: 0.3,
          },
        },
      ],
    },
  ],
  [
    'text overlay wrap (maxWidth) toggled on',
    {
      ...base,
      overlays: [
        {
          id: 'o1',
          kind: 'text',
          start: 0.5,
          duration: 2,
          text: 'A long headline that wraps',
          preset: 'title',
          maxWidth: 0.6,
          transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0 },
        },
      ],
    },
  ],
  [
    'text overlay animation preset (fx: staggered typewriter)',
    {
      ...base,
      overlays: [
        {
          id: 'o1',
          kind: 'text',
          start: 0.5,
          duration: 2,
          text: 'Hello world',
          preset: 'title',
          fx: {
            fx: 'typewriter',
            unit: 'char',
            direction: 'forward',
            stagger: 0.05,
          },
          transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0 },
        },
      ],
    },
  ],
  [
    'text overlay background toggled on',
    {
      ...base,
      overlays: [
        {
          id: 'o1',
          kind: 'text',
          start: 0.5,
          duration: 2,
          text: 'Hello',
          preset: 'title',
          box: { color: '#101014', opacity: 0.8 },
          transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0 },
        },
      ],
    },
  ],
  [
    'FIRST overlay motion pose added',
    {
      ...base,
      overlays: [
        {
          id: 'o1',
          kind: 'text',
          start: 0.5,
          duration: 2,
          text: 'Hello',
          preset: 'title',
          transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0 },
          motion: [{ at: 0 }],
        },
      ],
    },
  ],
  [
    'overlay motion poses edited',
    {
      ...base,
      overlays: [
        {
          id: 'o1',
          kind: 'text',
          start: 0.5,
          duration: 2,
          text: 'Hello',
          preset: 'title',
          transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0 },
          motion: [
            { at: 0, x: 0.2, y: 0.2 },
            { at: 1.5, x: 0.8, y: 0.6, scale: 1.5, opacity: 0.6 },
          ],
        },
      ],
    },
  ],
  [
    'media overlay added',
    {
      ...base,
      overlays: [
        {
          id: 'o2',
          kind: 'image',
          start: 0,
          duration: 1,
          key: 'blob:img',
          width: 0.5,
          radius: 20,
          transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0 },
        },
      ],
    },
  ],

  // --- 3D props ------------------------------------------------------------
  [
    '3D prop motion poses added',
    {
      ...base,
      objects: [
        {
          id: 'p1',
          asset: { kind: 'primitive', shape: 'torus', color: '#ff8800' },
          span: { start: 0.5, duration: 2 },
          transform3d: {
            x: 0.5,
            y: 0.5,
            z: 0.5,
            scale: 0.3,
            rx: 0,
            ry: 0,
            rz: 0,
          },
          animation: 'spin',
          motion: [
            { at: 0, x: 1.1, scale: 0.1 },
            { at: 0.8, x: 0.7, scale: 0.3, ry: 20 },
          ],
        },
      ],
    },
  ],
  [
    'FIRST 3D prop added',
    {
      ...base,
      objects: [
        {
          id: 'p1',
          asset: { kind: 'primitive', shape: 'torus', color: '#ff8800' },
          transform3d: {
            x: 0.5,
            y: 0.5,
            z: 0.5,
            scale: 0.3,
            rx: 0,
            ry: 0,
            rz: 0,
          },
        },
      ],
    },
  ],

  // --- Audio ---------------------------------------------------------------
  [
    'FIRST audio clip added',
    {
      ...base,
      audio: [
        {
          id: 'a1',
          key: 'blob:track',
          name: 'track.mp3',
          start: 0,
          in: 0,
          out: 3,
          duration: 30,
          gain: 0.8,
          fadeIn: 0.5,
          fadeOut: 0.5,
        },
      ],
    },
  ],
  ['mic gain', { ...base, micGain: 0.4 }],

  // --- Export settings (must not touch the program at all) -----------------
  [
    'export resolution',
    { ...base, export: { ...base.export, resolution: '4k' } },
  ],
  ['export fps', { ...base, export: { ...base.export, fps: 60 } }],
]

describe('no studio edit reloads the player', () => {
  it.each(EDITS)('%s stays a live data edit', (_name, doc) => {
    expect(programOf(doc)).toBe(BASELINE)
  })

  /**
   * The guard on the guard. Nothing in the doc reaches the program today —
   * that is the whole point of the interpreter — so no doc edit can serve as
   * the negative case. Prove the comparison is SENSITIVE instead: change one
   * field of the emitted config and the compiled string must move. Without
   * this, a lowering that accidentally emitted a constant would pass every
   * assertion above while reloading nothing because it rendered nothing.
   */
  it('is not vacuous — the compiled string tracks the emitted config', () => {
    const { config } = lowerToComposition(base)
    const { data: _data, ...program } = config
    // The lowering bakes a PLACEHOLDER duration of 1; any other value is a
    // different program.
    expect(compileVosConfig({ ...program, duration: 2 } as never)).not.toBe(
      BASELINE,
    )
  })
})
