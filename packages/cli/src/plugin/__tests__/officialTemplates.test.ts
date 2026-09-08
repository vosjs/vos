import { describe, expect, it } from 'vitest'
import {
  OFFICIAL_END_CARD_TITLE,
  OFFICIAL_POSTER_TITLES,
  findOfficialByRef,
  templateKey,
} from '../officialTemplates'

const shelf = [
  {
    id: 'a',
    title: 'Split cover, landscape',
    slug: 'split-cover-landscape-x1',
  },
  { id: 'b', title: 'Split cover, square' },
  { id: 'c', title: 'End card', slug: 'end-card-9f' },
  { id: 'd', title: 'End card' },
]

describe('officialTemplates', () => {
  it('reduces a title or a ref to letters and digits', () => {
    expect(templateKey('Split cover, landscape')).toBe('splitcoverlandscape')
    expect(templateKey(' end-card ')).toBe('endcard')
  })

  it('finds an official vos by title or slug, ignoring case, spaces and punctuation', () => {
    expect(findOfficialByRef(shelf, 'End card')?.id).toBe('c')
    expect(findOfficialByRef(shelf, 'end-card')?.id).toBe('c')
    expect(findOfficialByRef(shelf, 'split-cover-landscape')?.id).toBe('a')
    expect(findOfficialByRef(shelf, 'SPLIT COVER SQUARE')?.id).toBe('b')
    expect(findOfficialByRef(shelf, 'split-cover-landscape-x1')?.id).toBe('a')
    expect(findOfficialByRef(shelf, 'Split cover, portrait')).toBeNull()
    expect(findOfficialByRef(shelf, '')).toBeNull()
  })

  it('the first match in shelf order wins', () => {
    expect(findOfficialByRef(shelf, OFFICIAL_END_CARD_TITLE)?.id).toBe('c')
  })

  it('names one poster per aspect class', () => {
    expect(Object.keys(OFFICIAL_POSTER_TITLES)).toEqual([
      'landscape',
      'square',
      'portrait',
      'tile',
    ])
  })
})
