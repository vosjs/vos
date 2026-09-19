import { describe, expect, it } from 'vitest'
import { programPushTarget } from '../sync'

describe('where a program push lands', () => {
  it('creates from a directory that tracks nothing', () => {
    expect(programPushTarget({ trackedVosId: null })).toEqual({
      kind: 'create',
    })
  })

  // The defect: a bare re-push after a create read the tracked id as LINEAGE
  // and made a fresh remix of it, so pushing twice left "… remix remix"
  // siblings on the shelf and edited none of them.
  it('iterates the vos the directory tracks, with no flags', () => {
    expect(programPushTarget({ trackedVosId: 'a' })).toEqual({
      kind: 'version',
      vosId: 'a',
      tracked: true,
    })
  })

  it('takes --vos as the target, tracked or not', () => {
    expect(programPushTarget({ vos: 'b', trackedVosId: null })).toEqual({
      kind: 'version',
      vosId: 'b',
      tracked: false,
    })
    expect(programPushTarget({ vos: 'b', trackedVosId: 'a' })).toEqual({
      kind: 'version',
      vosId: 'b',
      tracked: false,
    })
  })

  it('still creates when --remix-of says so, even in a tracked directory', () => {
    expect(programPushTarget({ remixOf: 'a', trackedVosId: 'a' })).toEqual({
      kind: 'create',
      remixOfId: 'a',
    })
  })

  it('refuses create-only flags against a tracked directory, naming both doors', () => {
    const t = programPushTarget({
      trackedVosId: 'a',
      createOnly: ['title'],
    })
    expect(t.kind).toBe('refuse')
    if (t.kind !== 'refuse') throw new Error('expected a refusal')
    expect(t.why).toContain('tracks vos a')
    expect(t.why).toContain('--remix-of a')
  })

  it('lets create-only flags through on a create', () => {
    expect(
      programPushTarget({ trackedVosId: null, createOnly: ['title', 'slug'] }),
    ).toEqual({ kind: 'create' })
    expect(
      programPushTarget({
        remixOf: 'a',
        trackedVosId: 'a',
        createOnly: ['title'],
      }),
    ).toEqual({ kind: 'create', remixOfId: 'a' })
  })
})
