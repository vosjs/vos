import { describe, expect, it } from 'vitest'
import {
  parseFrontmatter,
  recipeHints,
  recipeSummary,
  splitFrontmatter,
} from '../frontmatter'

const FULL = `---
name: demo-style
description: "How my product demos should feel"
---

# Demo style

Calm pacing, one idea per beat.
`

describe('parseFrontmatter', () => {
  it('reads key: value lines and strips quotes', () => {
    expect(parseFrontmatter(FULL)).toEqual({
      name: 'demo-style',
      description: 'How my product demos should feel',
    })
  })

  it('returns empty for no frontmatter and for malformed blocks', () => {
    expect(parseFrontmatter('# Just a doc')).toEqual({})
    expect(parseFrontmatter('---\nunterminated')).toEqual({})
  })

  it('handles CRLF files', () => {
    expect(parseFrontmatter('---\r\nname: x\r\n---\r\nbody')).toEqual({
      name: 'x',
    })
  })
})

describe('recipeSummary', () => {
  it('prefers frontmatter', () => {
    expect(recipeSummary(FULL, 'other.md')).toEqual({
      name: 'demo-style',
      description: 'How my product demos should feel',
    })
  })

  it('falls back to the first heading, then prose', () => {
    const doc = '# Glass looks\n\nAlways translucency, never transmission.\n'
    expect(recipeSummary(doc, 'glass.md')).toEqual({
      name: 'Glass looks',
      description: 'Always translucency, never transmission.',
    })
  })

  it('falls back to the filename stem when the file says nothing', () => {
    expect(recipeSummary('', 'wild-ideas.md').name).toBe('wild-ideas')
  })

  it('caps description at 200 chars', () => {
    const doc = 'x'.repeat(400)
    expect(recipeSummary(doc, 'a.md').description.length).toBe(200)
  })
})

describe('splitFrontmatter', () => {
  it('hands back the fields and a body with no yaml left in it', () => {
    const { fields, body } = splitFrontmatter(FULL)
    expect(fields.name).toBe('demo-style')
    // The raw block must not reach a markdown renderer, which would draw the
    // `---` as a rule followed by a stray line of yaml.
    expect(body.startsWith('---')).toBe(false)
    expect(body).not.toContain('description:')
  })

  it('leaves a file without frontmatter whole', () => {
    const doc = '# Just a doc\n\nBody.\n'
    expect(splitFrontmatter(doc)).toEqual({ fields: {}, body: doc })
  })

  it('keeps a horizontal rule that is not frontmatter', () => {
    const doc = 'Intro.\n\n---\n\nOutro.\n'
    expect(splitFrontmatter(doc).body).toBe(doc)
  })
})

describe('recipeHints', () => {
  it('reads applies and seed; normalizes applies to three words', () => {
    const doc = '---\napplies: Takes\nseed: input\n---\n'
    expect(recipeHints(doc)).toEqual({ applies: 'take', seed: 'input' })
    expect(recipeHints('---\napplies: programs\n---\n').applies).toBe('program')
    expect(recipeHints('---\napplies: whatever\n---\n').applies).toBe('any')
  })

  it('is empty for a recipe that declares nothing, and never reads a status', () => {
    expect(recipeHints(FULL)).toEqual({})
    expect(recipeHints('---\nstatus: draft\n---\nSTATUS: seed\n')).toEqual({})
    expect(
      recipeSummary(FULL + '\nSTATUS: draft\n', 'x.md'),
    ).not.toHaveProperty('status')
  })
})
