/**
 * The machine (AN1): what `vos setup` and `vos doctor` know about the
 * computer they run on, as pure functions over injected facts. Agent
 * detection by directory, the rules block with its begin/end markers (so a
 * second run replaces its own text and never a person's), the browser
 * probe in the order the recorder itself resolves one, and the doctor
 * report in words. Nothing here spawns a process or prints; `machineCmd.ts`
 * does that and hands the answers in.
 *
 * Not `setup.ts`: that module is the SI `setup` steps of actions.json.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'

export type AgentName = 'claude' | 'cursor' | 'codex' | 'copilot'

export const AGENT_NAMES: readonly AgentName[] = [
  'claude',
  'cursor',
  'codex',
  'copilot',
]

/** One place an agent keeps its files: a project directory or a home one. */
export interface AgentHome {
  agent: AgentName
  /** The directory, absolute. Skills go under `<dir>/skills/`. */
  dir: string
  scope: 'project' | 'global'
}

/**
 * Where each agent keeps its project files. Codex reads `.codex/` and the
 * cross-agent `.agents/`; Copilot keeps its instructions under `.github/`.
 */
const PROJECT_DIRS: Record<AgentName, string[]> = {
  claude: ['.claude'],
  cursor: ['.cursor'],
  codex: ['.codex', '.agents'],
  copilot: ['.github/copilot'],
}

/** The home-directory forms, read under --global. */
const HOME_DIRS: Record<AgentName, string[]> = {
  claude: ['.claude'],
  cursor: ['.cursor'],
  codex: ['.codex', '.agents'],
  copilot: ['.copilot'],
}

export interface DetectOptions {
  /** The person's home directory; read only when `global` is set. */
  home?: string
  global?: boolean
  /** Injected for tests. */
  exists?: (path: string) => boolean
}

/**
 * The agents present, by the directories they leave behind. A project
 * directory counts on its own; a home directory counts under --global.
 * Order is AGENT_NAMES order, project before global, so output is stable.
 */
export function detectAgents(
  root: string,
  opts: DetectOptions = {},
): AgentHome[] {
  const exists = opts.exists ?? existsSync
  const out: AgentHome[] = []
  for (const agent of AGENT_NAMES) {
    for (const rel of PROJECT_DIRS[agent]) {
      const dir = join(root, rel)
      if (exists(dir)) out.push({ agent, dir, scope: 'project' })
    }
    // Copilot's project presence is often a single file, not a directory.
    if (
      agent === 'copilot' &&
      !out.some((h) => h.agent === 'copilot') &&
      exists(join(root, '.github', 'copilot-instructions.md'))
    ) {
      out.push({
        agent,
        dir: join(root, '.github', 'copilot'),
        scope: 'project',
      })
    }
  }
  if (opts.global && opts.home) {
    for (const agent of AGENT_NAMES) {
      for (const rel of HOME_DIRS[agent]) {
        const dir = join(opts.home, rel)
        if (exists(dir)) out.push({ agent, dir, scope: 'global' })
      }
    }
  }
  return out
}

/**
 * `--agent claude,cursor` or `--agent all`, validated. The homes it names
 * are the project directories whether or not they exist yet, so a person
 * can ready an agent they are about to install.
 */
export function agentsFromFlag(
  value: string,
  root: string,
): { homes: AgentHome[] } | { error: string } {
  const wanted =
    value.trim() === 'all'
      ? [...AGENT_NAMES]
      : value
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
  const bad = wanted.filter((w) => !AGENT_NAMES.includes(w as AgentName))
  if (bad.length)
    return {
      error: `--agent takes ${AGENT_NAMES.join(', ')} or all, not "${bad.join(', ')}"`,
    }
  if (!wanted.length) return { error: '--agent expects a name' }
  return {
    homes: wanted.map((agent) => ({
      agent: agent as AgentName,
      dir: join(root, PROJECT_DIRS[agent as AgentName][0]),
      scope: 'project',
    })),
  }
}

/** Where skills live for one home; the layout the skills CLI writes. */
export function skillsDirFor(home: AgentHome): string {
  return join(home.dir, 'skills')
}

/** The cross-agent home the bundled copy lands in when no agent is found. */
export function fallbackSkillsHome(root: string): AgentHome {
  return { agent: 'codex', dir: join(root, '.agents'), scope: 'project' }
}

/** The skills installed under one skills directory: every `<name>/SKILL.md`. */
export function installedSkills(
  dir: string,
  exists: (p: string) => boolean = existsSync,
  list: (p: string) => string[] = (p) => {
    try {
      return readdirSync(p)
    } catch {
      return []
    }
  },
): string[] {
  if (!exists(dir)) return []
  return list(dir)
    .filter((name) => exists(join(dir, name, 'SKILL.md')))
    .sort()
}

// ---------------------------------------------------------------------------
// The rules block
// ---------------------------------------------------------------------------

export const RULES_BEGIN =
  '<!-- vos:begin (written by vos setup; the block is replaced on the next run) -->'
export const RULES_END = '<!-- vos:end -->'

/**
 * The block `vos setup` writes into AGENTS.md (or CLAUDE.md). Four things
 * an agent needs every session and nothing more: the skill, the hand-back,
 * local by default, where a credential comes from. The full contract is
 * the reference it names, never a wall inside a rules file.
 */
export const RULES_BODY = `## Product videos (vosso)
- Skill: product-video (npx skills add vosjs/skills) records the real product from actions.json
- Look before you cut: vos frames take --at-zooms; edit take/doc.json and re-render, never re-record
- Hand back: vos open take serves the take into the studio at vos.so, doc.json intact
- Local by default: vos push only when asked for a link, the shelf or a cloud render
- Credentials: VOS_API_KEY, then ~/.config/vos/credentials, then vos login; never print one
- Reference: https://vos.so/llms-full.txt`

export const RULES_BLOCK = `${RULES_BEGIN}\n${RULES_BODY}\n${RULES_END}`

/**
 * The file with the block in it, idempotently: a file already carrying the
 * markers gets the text between them replaced (an older block, or one a
 * person edited, gives way to the current one); any other file gets the
 * block appended after one blank line. `changed` is false when the file
 * already reads exactly this.
 */
export function applyRulesBlock(existing: string | null): {
  text: string
  changed: boolean
} {
  const current = existing ?? ''
  const begin = current.indexOf(RULES_BEGIN)
  const end = current.indexOf(RULES_END)
  let text: string
  if (begin !== -1 && end !== -1 && end > begin) {
    text =
      current.slice(0, begin) +
      RULES_BLOCK +
      current.slice(end + RULES_END.length)
  } else if (current.trim() === '') {
    text = `${RULES_BLOCK}\n`
  } else {
    text = `${current.replace(/\s*$/, '')}\n\n${RULES_BLOCK}\n`
  }
  return { text, changed: text !== current }
}

/**
 * AGENTS.md when it exists, else CLAUDE.md when it exists, else AGENTS.md
 * (the cross-agent name, created). A file the project already keeps wins,
 * because the block belongs where the agent already reads.
 */
export function rulesFileFor(
  root: string,
  exists: (p: string) => boolean = existsSync,
): string {
  const agents = join(root, 'AGENTS.md')
  if (exists(agents)) return agents
  const claude = join(root, 'CLAUDE.md')
  if (exists(claude)) return claude
  return agents
}

// ---------------------------------------------------------------------------
// The browser
// ---------------------------------------------------------------------------

export interface BrowserProbe {
  kind: 'env' | 'chrome' | 'chromium' | 'none'
  path: string | null
  /** The one line doctor prints for it. */
  line: string
}

/** The system Chrome's install locations, the ones `channel: 'chrome'` reads. */
export function chromeCandidates(
  platform: NodeJS.Platform,
  env: Record<string, string | undefined>,
): string[] {
  if (platform === 'darwin')
    return ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
  if (platform === 'win32')
    return [
      join(
        env['PROGRAMFILES'] ?? 'C:\\Program Files',
        'Google',
        'Chrome',
        'Application',
        'chrome.exe',
      ),
      join(
        env['LOCALAPPDATA'] ?? '',
        'Google',
        'Chrome',
        'Application',
        'chrome.exe',
      ),
    ]
  return [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/opt/google/chrome/chrome',
  ]
}

/**
 * The browser the recorder will use, in the recorder's own order:
 * VOS_BROWSER_PATH, then the system Chrome, then Playwright's bundled
 * Chromium (`bundled` answers its path when it is installed).
 */
export function probeBrowser(opts: {
  platform: NodeJS.Platform
  env: Record<string, string | undefined>
  exists: (p: string) => boolean
  bundled: () => string | null
}): BrowserProbe {
  const explicit = opts.env.VOS_BROWSER_PATH?.trim()
  if (explicit) {
    return opts.exists(explicit)
      ? { kind: 'env', path: explicit, line: `${explicit} (VOS_BROWSER_PATH)` }
      : {
          kind: 'none',
          path: null,
          line: `VOS_BROWSER_PATH points at ${explicit}, which does not exist`,
        }
  }
  const chrome = chromeCandidates(opts.platform, opts.env).find(opts.exists)
  if (chrome) return { kind: 'chrome', path: chrome, line: 'Chrome (system)' }
  const chromium = opts.bundled()
  if (chromium)
    return { kind: 'chromium', path: chromium, line: 'Chromium (Playwright)' }
  return {
    kind: 'none',
    path: null,
    line: 'none: install Google Chrome, or run npx playwright install chromium',
  }
}

// ---------------------------------------------------------------------------
// The doctor
// ---------------------------------------------------------------------------

export const NODE_MIN_MAJOR = 18

export interface DoctorFacts {
  node: string
  browser: BrowserProbe
  /** The first line of `ffmpeg -version`, or null when absent. */
  ffmpeg: string | null
  skills: { agent: AgentName; scope: AgentHome['scope']; names: string[] }[]
  /** A credential resolves (flag, env or file). Never the value. */
  credential: boolean
  devServer?: {
    url: string
    ok: boolean
    status: number | null
    error?: string
  }
}

export interface DoctorReport {
  /** Ready to record: a browser and a new-enough node. */
  ok: boolean
  lines: string[]
  next_step: string
  facts: DoctorFacts
}

function major(version: string): number {
  return parseInt(version.split('.')[0] ?? '0', 10)
}

/** The report in words; the JSON is `facts` plus `ok` and `next_step`. */
export function doctorReport(facts: DoctorFacts): DoctorReport {
  const lines: string[] = []
  const nodeOk = major(facts.node) >= NODE_MIN_MAJOR
  lines.push(
    `node        ${facts.node} ${nodeOk ? '✓' : `✗  ${NODE_MIN_MAJOR} or newer is needed`}`,
  )
  const browserOk = facts.browser.kind !== 'none'
  lines.push(`browser     ${facts.browser.line} ${browserOk ? '✓' : '✗'}`)
  lines.push(
    `ffmpeg      ${facts.ffmpeg ? `${facts.ffmpeg} ✓` : 'absent (optional)'}`,
  )
  const withSkills = facts.skills.filter((s) => s.names.length)
  if (withSkills.length) {
    const names = [...new Set(withSkills.flatMap((s) => s.names))].sort()
    const agents = [
      ...new Set(
        withSkills.map((s) =>
          s.scope === 'global' ? `${s.agent} (global)` : s.agent,
        ),
      ),
    ]
    lines.push(`skills      ${names.join(', ')} (${agents.join(', ')}) ✓`)
  } else {
    lines.push('skills      none ✗  run: npx vos setup')
  }
  lines.push(
    `credential  ${facts.credential ? 'present ✓' : 'absent (vos login when you need hosting)'}`,
  )
  if (facts.devServer) {
    const d = facts.devServer
    lines.push(
      `dev server  ${d.url} ${
        d.ok
          ? 'answers ✓'
          : `does not answer ✗${d.error ? `  (${d.error})` : d.status ? `  (HTTP ${d.status})` : ''}`
      }`,
    )
  }

  let next_step: string
  if (!nodeOk)
    next_step = `Install Node ${NODE_MIN_MAJOR} or newer, then run npx vos doctor again`
  else if (!browserOk)
    next_step = 'Install Google Chrome, or run: npx playwright install chromium'
  else if (facts.devServer && !facts.devServer.ok)
    next_step = `Start the dev server so ${facts.devServer.url} answers, then record`
  else if (!withSkills.length) next_step = 'Run: npx vos setup'
  else
    next_step =
      'Record: npx vos record --actions actions.json --out take --strict (the product-video skill writes actions.json)'
  return { ok: nodeOk && browserOk, lines, next_step, facts }
}

// ---------------------------------------------------------------------------
// The bundled skills
// ---------------------------------------------------------------------------

/**
 * The copy of vosjs/skills this package ships (`packages/cli/skills`,
 * synced by `scripts/sync-skills.mjs`), found by walking up from the
 * calling module to the package root, so it resolves from `dist/` and from
 * `src/` alike. Null when the package carries none.
 */
export function bundledSkillsDir(from: string): string | null {
  let dir = dirname(from)
  for (let i = 0; i < 6; i++) {
    const pkg = join(dir, 'package.json')
    if (existsSync(pkg)) {
      try {
        const name = (
          JSON.parse(readFileSync(pkg, 'utf8')) as { name?: string }
        ).name
        if (name === '@vosjs/cli') {
          const skills = join(dir, 'skills')
          return existsSync(skills) && statSync(skills).isDirectory()
            ? skills
            : null
        }
      } catch {
        // not ours; keep walking
      }
    }
    const up = dirname(dir)
    if (up === dir) break
    dir = up
  }
  return null
}
