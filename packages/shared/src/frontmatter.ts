/**
 * SKILL.md-style frontmatter (FR recipes-as-files): recipes are plain
 * markdown assets, and the FILE is the single source of truth — name and
 * description are read out of it, never stored beside it where they could
 * drift. Deliberately tiny and tolerant: a leading `---` block of
 * `key: value` lines, no YAML nesting (a recipe needing more than that is
 * a skill, and skills live in vosjs/skills).
 */

export interface RecipeSummary {
  name: string
  description: string
}

/**
 * The optional hints a recipe may carry for the DOOR: what it
 * governs and where work starts. Absent hints change nothing for an agent
 * (it reads the body); present ones let the handoff dialog pre-pick the
 * seed and shape its example ask. Never validated beyond "is a string" —
 * the platform enforces no taxonomy, and nothing pre-writes them.
 * `applies` is normalized to the three words the door knows; anything else
 * reads as `any`. There is deliberately NO status hint: a recipe's workflow
 * state is the user's, and a line in their document never outranks what
 * they ask for now.
 */
export interface RecipeHints {
  applies?: 'program' | 'take' | 'any'
  /** A vos id to vary, or `input` (the user's recording), or `none`. */
  seed?: string
}

export function recipeHints(text: string): RecipeHints {
  const { fields } = splitFrontmatter(text)
  const out: RecipeHints = {}
  const applies = (fields.applies || '').trim().toLowerCase()
  if (applies) {
    out.applies = /^take/.test(applies)
      ? 'take'
      : /^program/.test(applies)
        ? 'program'
        : 'any'
  }
  const seed = (fields.seed || '').trim()
  if (seed) out.seed = seed.slice(0, 120)
  return out
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/

export function parseFrontmatter(text: string): Record<string, string> {
  const match = FRONTMATTER_RE.exec(text)
  if (!match) return {}
  const fields: Record<string, string> = {}
  for (const line of match[1].split(/\r?\n/)) {
    const colon = line.indexOf(':')
    if (colon <= 0) continue
    const key = line.slice(0, colon).trim()
    const value = line
      .slice(colon + 1)
      .trim()
      .replace(/^['"]|['"]$/g, '')
    if (key && value) fields[key] = value
  }
  return fields
}

/**
 * The file split in two: its frontmatter fields and everything after them.
 * A reader wants both halves separately — the fields ARE the file's name and
 * description (so they belong in a page's header, not in its body), and a
 * markdown renderer handed the raw `---` block draws it as a rule followed
 * by a stray line of yaml.
 */
export function splitFrontmatter(text: string): {
  fields: Record<string, string>
  body: string
} {
  return {
    fields: parseFrontmatter(text),
    body: text.replace(FRONTMATTER_RE, ''),
  }
}

/**
 * The summary agents route on. Fallback order mirrors how a human reads
 * the file: frontmatter name → first `# heading` → the filename stem;
 * description falls back to the first prose line after the frontmatter.
 */
export function recipeSummary(text: string, filename: string): RecipeSummary {
  const { fields, body } = splitFrontmatter(text)
  const heading = /^#\s+(.+)$/m.exec(body)?.[1]?.trim()
  const firstProse = body
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith('#'))
  return {
    name:
      fields.name ||
      heading ||
      filename.replace(/\.(md|markdown)$/i, '') ||
      filename,
    description: (fields.description || firstProse || '').slice(0, 200),
  }
}
