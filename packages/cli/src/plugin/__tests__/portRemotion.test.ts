import { describe, expect, it } from 'vitest'
import { mergeSceneTexts, remotionScenes, themeColors } from '../portRemotion'
import type { Inventory, InventoryText } from '../portInventory'
import { planScaffold } from '../portScaffold'

const text = (
  t: string,
  x: number,
  y: number,
  extra: Partial<InventoryText> = {},
): InventoryText => ({
  id: 'div-0',
  text: t,
  tag: 'div',
  box: { x, y, width: 100, height: 40 },
  font: {
    family: 'Anton',
    size: 120,
    weight: 400,
    style: 'normal',
    color: 'rgb(242, 239, 232)',
    letterSpacing: 0,
    transform: 'none',
  },
  ...extra,
})

describe('reading a Remotion source', () => {
  it('names the palette after the colour constants the source declares', () => {
    expect(
      themeColors([
        "export const INK = '#0B0B0F'\nexport const PAPER = '#F2EFE8'",
        "const ACCENT_RED: string = '#ff4d2e'\nconst size = 12",
      ]),
    ).toEqual({ ink: '#0b0b0f', paper: '#f2efe8', accentRed: '#ff4d2e' })
  })

  it('takes the sequences as scenes, named by what they hold, without the transitions over them', () => {
    const scenes = remotionScenes(
      [
        { from: 0, durationInFrames: 60, name: 'Intro' },
        { from: 60, durationInFrames: 90, name: 'Rhythm' },
        { from: 120, durationInFrames: 36, name: 'SlatWipe' },
        { from: 150, durationInFrames: 90, name: null },
        { from: 240, durationInFrames: 60, name: 'Intro' },
      ],
      30,
    )
    expect(scenes.map((s) => [s.name, s.start, s.duration])).toEqual([
      ['Intro', 0, 2],
      ['Rhythm', 2, 3],
      ['scene3', 5, 3],
      ['Intro2', 8, 2],
    ])
  })

  it('keeps a word once per scene, a line on every scene once with no scene, and a counter once', () => {
    const hud = text('CLAUDE / REEL', 92, 50)
    const merged = mergeSceneTexts([
      {
        scene: 'Intro',
        texts: [hud, text('MOTION', 500, 350), text('00:00:01:20', 1676, 50)],
      },
      {
        scene: 'Rhythm',
        texts: [hud, text('RHYTHM', 415, 270), text('00:00:03:10', 1676, 50)],
      },
      { scene: 'Depth', texts: [hud, text('DEPTH', 667, 355)] },
    ])
    expect(merged.map((t) => [t.text, t.scene])).toEqual([
      ['CLAUDE / REEL', null],
      ['MOTION', 'Intro'],
      ['00:00:01:20', 'Intro'],
      ['RHYTHM', 'Rhythm'],
      ['DEPTH', 'Depth'],
    ])
  })
})

describe('the scaffold of a read source', () => {
  it('splits a word animated letter by letter and stands each scene on its ground', () => {
    const inv = {
      source: 'reel',
      engine: 'remotion',
      width: 1920,
      height: 1080,
      fps: 30,
      duration: 4,
      scenes: [
        { name: 'Intro', start: 0, duration: 2, ground: 'rgb(255, 77, 46)' },
        { name: 'Depth', start: 2, duration: 2, ground: 'rgb(11, 11, 15)' },
      ],
      texts: [
        text('MOTION', 500, 350, { scene: 'Intro', split: 'chars' }),
        text('DEPTH', 667, 355, { scene: 'Depth' }),
      ],
      palette: { red: '#ff4d2e', ink: '#0b0b0f' },
      colors: [],
      fonts: [],
      media: [],
      canvases: [],
      gaps: [],
      variables: {},
      scriptStrings: [],
      render: null,
      stills: [],
    } as unknown as Inventory
    const plan = planScaffold(inv, { sourceDir: '/x' })
    expect(plan.program).toMatch(/"split": \{\s*"type": "chars"\s*\}/)
    expect(plan.program).toMatch(/"ground": "red"/)
    expect(plan.program).toMatch(/"ground": "ink"/)
    // Window sets reach a split word's units, which carry their own opacity.
    expect(plan.program).toMatch(
      /el\.segments && el\.segments\.length \? el\.segments : el\.props/,
    )
  })
})
