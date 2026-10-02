import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import {
  createElementProps,
  createSplitGroup,
  createSplitGroupProps,
  relayoutSplitGroup,
} from '../createElementProps'

// Three letters on a line around the word's centre (props space, y down).
const word = () => {
  const group = createSplitGroup(0, 0, 100)
  const meshes = [-100, 0, 100].map((x) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ transparent: true }),
    )
    m.position.set(x, 0, 0)
    return m
  })
  const units = meshes.map((m) =>
    createElementProps(
      THREE,
      m,
      m.position.x,
      -m.position.y,
      1,
      null,
      null,
      null,
      null,
      null,
      group,
    ),
  )
  const props = createSplitGroupProps(group, () => meshes)
  return { group, meshes, units, props }
}

const near = (a: number, b: number) => expect(a).toBeCloseTo(b, 6)

describe('a split word moves as a word', () => {
  it("moves every letter with the element's props, not the first one", () => {
    const { meshes, props } = word()
    props.x = 40
    props.y = 30
    expect(meshes.map((m) => m.position.x)).toEqual([-60, 40, 140])
    expect(meshes.map((m) => m.position.y)).toEqual([-30, -30, -30])
  })

  it('fades every letter, over each letter its own fade', () => {
    const { meshes, units, props } = word()
    units[2].opacity = 0.5
    props.opacity = 0.4
    const op = meshes.map(
      (m) => (m.material as THREE.MeshBasicMaterial).opacity,
    )
    near(op[0], 0.4)
    near(op[1], 0.4)
    near(op[2], 0.2)
  })

  it('scales and turns the word about its centre', () => {
    const { meshes, props } = word()
    props.scale = 2
    expect(meshes.map((m) => m.position.x)).toEqual([-200, 0, 200])
    near(meshes[2].scale.x, 2)
    props.scale = 1
    props.rotation = 90
    // A quarter turn counter-clockwise puts the right-hand letter above.
    near(meshes[2].position.x, 0)
    near(meshes[2].position.y, 100)
    near(meshes[2].rotation.z, Math.PI / 2)
  })

  it("composes a letter's own animation under the word's", () => {
    const { meshes, units, props } = word()
    props.x = 10
    units[0].y = 50 // the first letter drops 50
    near(meshes[0].position.x, -90)
    near(meshes[0].position.y, -50)
    near(meshes[1].position.y, 0)
  })

  it('keeps the offset a tween added when a data edit lays the word out again', () => {
    const { group, props } = word()
    props.x = 25
    relayoutSplitGroup(group, 300, 0)
    expect(group.state.x).toBe(325)
    expect(group.members.size).toBe(0)
  })

  it('leaves an element without a group exactly as before', () => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ transparent: true }),
    )
    const p = createElementProps(THREE, m, 0, 0)
    p.x = 12
    p.y = 7
    p.opacity = 0.3
    expect(m.position.x).toBe(12)
    expect(m.position.y).toBe(-7)
    near((m.material as THREE.MeshBasicMaterial).opacity, 0.3)
  })
})

// The same three letters, under a committed transform (a resize or a rotate
// the editor saved into `config.transform`).
const committedWord = (base: { scale?: number; rotation?: number }) => {
  const group = createSplitGroup(0, 0, 100, base)
  const meshes = [-100, 0, 100].map((x) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ transparent: true }),
    )
    m.position.set(x, 0, 0)
    return m
  })
  meshes.map((m) =>
    createElementProps(
      THREE,
      m,
      m.position.x,
      -m.position.y,
      1,
      null,
      null,
      null,
      null,
      null,
      group,
    ),
  )
  for (const recompose of group.members) recompose()
  const props = createSplitGroupProps(group, () => meshes)
  return { meshes, props }
}

describe('a split word keeps its committed transform', () => {
  it('wears a committed scale on every letter, about the word centre', () => {
    const { meshes } = committedWord({ scale: 1.5 })
    expect(meshes.map((m) => m.position.x)).toEqual([-150, 0, 150])
    near(meshes[0].scale.x, 1.5)
    near(meshes[2].scale.y, 1.5)
  })

  it('a later props.scale stays relative to the committed scale', () => {
    const { meshes, props } = committedWord({ scale: 2 })
    props.scale = 0.5 // a timeline or a drag preview
    near(meshes[2].position.x, 100)
    near(meshes[2].scale.x, 1)
  })

  it('wears a committed rotation, the absolute props.rotation starts there', () => {
    const { meshes, props } = committedWord({ rotation: 90 })
    near(meshes[2].position.x, 0)
    near(meshes[2].position.y, 100)
    near(meshes[2].rotation.z, Math.PI / 2)
    expect(props.rotation).toBe(90)
  })

  it('without a committed transform the word is unchanged', () => {
    const { meshes } = committedWord({})
    expect(meshes.map((m) => m.position.x)).toEqual([-100, 0, 100])
    near(meshes[1].scale.x, 1)
  })
})
