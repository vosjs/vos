import { describe, expect, it } from 'vitest'
import { takePushRefusal } from '../sync'

describe('what a take push refuses before it uploads anything', () => {
  it('lets an ordinary push through', () => {
    expect(takePushRefusal({ trackedVosId: null, programOnly: [] })).toBeNull()
    expect(takePushRefusal({ trackedVosId: 'a', programOnly: [] })).toBeNull()
  })

  // The defect: --vos on a re-recorded take was ignored and a second vos
  // appeared on the shelf. It is adoption now, so it is NOT refused here.
  it('lets --vos adopt a vos from an untracked directory', () => {
    expect(
      takePushRefusal({ vos: 'a', trackedVosId: null, programOnly: [] }),
    ).toBeNull()
  })

  it('lets --vos repeat what vos.json already says', () => {
    expect(
      takePushRefusal({ vos: 'a', trackedVosId: 'a', programOnly: [] }),
    ).toBeNull()
  })

  it('refuses --vos that disagrees with vos.json', () => {
    const why = takePushRefusal({
      vos: 'b',
      trackedVosId: 'a',
      programOnly: [],
    })
    expect(why).toContain('tracks vos a')
    expect(why).toContain('not b')
  })

  it('refuses a program-only flag instead of creating without it', () => {
    const why = takePushRefusal({
      trackedVosId: null,
      programOnly: ['slug', 'tags'],
    })
    expect(why).toContain('--slug, --tags belong to a PROGRAM push')
  })
})
