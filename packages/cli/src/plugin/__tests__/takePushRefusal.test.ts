import { describe, expect, it } from 'vitest'
import { DESCRIPTION_MAX, descriptionProblem, takePushRefusal } from '../sync'

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
    // and names --desc among what a take push reads
    expect(why).toContain('--desc, --prompt')
  })
})

describe('--desc, before anything uploads', () => {
  it('takes a sentence up to the platform limit, and nothing at all', () => {
    expect(descriptionProblem(undefined)).toBeNull()
    expect(
      descriptionProblem('Create a key, copy it once, revoke it.'),
    ).toBeNull()
    expect(descriptionProblem('x'.repeat(DESCRIPTION_MAX))).toBeNull()
  })

  it('refuses an empty one and one past the limit, in words', () => {
    expect(descriptionProblem('  ')).toContain('--desc is empty')
    expect(descriptionProblem('x'.repeat(DESCRIPTION_MAX + 1))).toBe(
      `--desc is ${DESCRIPTION_MAX + 1} characters and a vos keeps ${DESCRIPTION_MAX}: shorten it`,
    )
  })
})
