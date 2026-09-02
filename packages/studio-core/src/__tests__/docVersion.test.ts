import { describe, expect, it } from 'vitest'
import { DOC_SCHEMA_VERSION, migrateHostedDoc } from '../docVersion'

/**
 * The migrate-on-read seam: a v-minus-one fixture must
 * upgrade losslessly, and current docs must pass through untouched — a
 * drifting seam corrupts every hosted take on open.
 */

const V0_FIXTURE = {
  // An unstamped (pre-stamp era) hosted doc — the v-minus-one case.
  source: { videoKey: '/api/assets/a1/file', cursor: [], meta: {} },
  segments: [{ in: 0, out: 5 }],
  zoom: [{ id: 'z1', in: 1, out: 2, level: 2, cx: 0.5, cy: 0.5 }],
  audio: [],
  cursor: { smoothing: 0.15, size: 24 },
  cam: { visible: true },
  frame: { padding: 0.08 },
  export: { resolution: '1080p', fps: 30, format: 'mp4' },
}

describe('migrateHostedDoc', () => {
  it('stamps a v0 (unstamped) doc without touching its content', () => {
    const migrated = migrateHostedDoc(V0_FIXTURE)
    expect(migrated.docSchemaVersion).toBe(DOC_SCHEMA_VERSION)
    const { docSchemaVersion: _v, ...rest } = migrated
    expect(rest).toEqual(V0_FIXTURE)
  })

  it('passes a current doc through by reference (no rewrite churn)', () => {
    const current = { ...V0_FIXTURE, docSchemaVersion: DOC_SCHEMA_VERSION }
    expect(migrateHostedDoc(current)).toBe(current)
  })

  it('stamps a v1 recording doc to the family era without touching it', () => {
    const v1 = { ...V0_FIXTURE, docSchemaVersion: 1 }
    const migrated = migrateHostedDoc(v1)
    expect(migrated.docSchemaVersion).toBe(DOC_SCHEMA_VERSION)
    const { docSchemaVersion: _v, ...rest } = migrated
    expect(rest).toEqual(V0_FIXTURE)
  })

  it('a program document is a member too (stamped, never reshaped)', () => {
    const program = {
      program: { config: { version: 2, duration: 4 }, tweenEdits: {} },
      overlays: [],
    }
    const migrated = migrateHostedDoc(program)
    expect(migrated.docSchemaVersion).toBe(DOC_SCHEMA_VERSION)
    expect(migrated.program).toBe(program.program)
  })

  it('never downgrades a future doc', () => {
    const future = { ...V0_FIXTURE, docSchemaVersion: DOC_SCHEMA_VERSION + 1 }
    expect(migrateHostedDoc(future).docSchemaVersion).toBe(
      DOC_SCHEMA_VERSION + 1,
    )
  })
})
