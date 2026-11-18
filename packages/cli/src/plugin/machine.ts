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
import { dirname, isAbsolute, join, relative, sep } from 'node:path'

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
 * The block `vos setup` writes into AGENTS.md (or CLAUDE.md). The few things
 * an agent needs every session and nothing more: the skill, the hand-back,
 * local by default, where a credential comes from, and how the block itself
 * is taken back out. The full contract is the reference it names, never a
 * wall inside a rules file.
 */
export const RULES_BODY = `## Product videos (vosso)
- Skill: product-video (installed by vos setup) records the real product from actions.json
- Look before you cut: vos frames take --at-zooms; edit take/doc.json and re-render, never re-record
- Hand back: vos open take serves the take into the studio at vos.so, doc.json intact
- Local by default: vos push only when asked for a link, the shelf or a cloud render
- Deleting: vos delete moves a vos to Trash and vos restore brings it back; if you deleted by mistake, restore it and say so. Only the person can delete forever, at vos.so/app/trash
- Credentials: VOS_API_KEY, then the account in use at ~/.config/vos/credentials (vos whoami says which; vos switch <handle> changes it), then vos login; never print one
- Undo: vos setup --remove takes the skills and this block back out
- Reference: https://vos.so/llms-full.txt`

export const RULES_BLOCK = `${RULES_BEGIN}\n${RULES_BODY}\n${RULES_END}`

/** Where the first marked block sits in a file, or null when it has none. */
function rulesSpan(text: string): { begin: number; end: number } | null {
  const begin = text.indexOf(RULES_BEGIN)
  if (begin === -1) return null
  const end = text.indexOf(RULES_END, begin)
  return end === -1 ? null : { begin, end: end + RULES_END.length }
}

/**
 * The file with the block in it, idempotently: a file already carrying the
 * markers gets the text between them replaced (an older block, or one a
 * person edited, gives way to the current one); any other file gets the
 * block appended after one blank line, and nothing of the file is rewritten
 * to make room: it keeps its own bytes, and it ends in a newline after the
 * block only if it ended in one before. That is what lets
 * `removeRulesBlock` hand the file back exactly. `changed` is false when
 * the file already reads exactly this.
 */
export function applyRulesBlock(existing: string | null): {
  text: string
  changed: boolean
} {
  const current = existing ?? ''
  const span = rulesSpan(current)
  let text: string
  if (span) {
    text = current.slice(0, span.begin) + RULES_BLOCK + current.slice(span.end)
  } else if (current.trim() === '') {
    text = `${RULES_BLOCK}\n`
  } else {
    const newline = current.endsWith('\n')
    text = `${current}${newline ? '\n' : '\n\n'}${RULES_BLOCK}${newline ? '\n' : ''}`
  }
  return { text, changed: text !== current }
}

/** What `applyRulesBlock` would do to a file, without doing it. */
export type RulesAction = 'write' | 'replace' | 'current'

export function rulesAction(existing: string | null): RulesAction {
  const current = existing ?? ''
  if (!applyRulesBlock(current).changed) return 'current'
  return rulesSpan(current) ? 'replace' : 'write'
}

/**
 * The file with the block taken back out, and nothing else of it touched:
 * the text between the markers goes (whatever it reads now, so a block a
 * person edited goes whole), with the blank line its insertion added. A
 * file that was only ever the block comes back empty, which the caller
 * reads as "delete the file". The inverse of `applyRulesBlock` for a file
 * it appended to. `changed` is false when the file carries no block.
 */
export function removeRulesBlock(existing: string): {
  text: string
  changed: boolean
} {
  let text = existing
  // A file can only hold a second block when someone pasted one; each goes.
  for (let i = 0; i < 8; i++) {
    const span = rulesSpan(text)
    if (!span) break
    let before = text.slice(0, span.begin)
    let after = text.slice(span.end)
    if (before.trim() === '' && after.trim() === '') {
      text = ''
      break
    }
    if (after === '') {
      // The file ends at the marker: it had no final newline when the block
      // went in, and the insertion put two in front of it.
      before = before.replace(/\n{1,2}$/, '')
    } else {
      // The end marker's own line ending, then the blank line above the
      // block (or, for a block at the top of a file, the one below it).
      if (after.startsWith('\n')) after = after.slice(1)
      if (before.trim() === '') after = after.replace(/^\n+/, '')
      else if (before.endsWith('\n\n')) before = before.slice(0, -1)
    }
    text = before + after
  }
  return { text, changed: text !== existing }
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
  /**
   * The accounts stored for the origin, by name (MA1), the active one
   * first; absent on a build before the store. Never a key.
   */
  accounts?: { label: string; active: boolean }[]
  devServer?: {
    url: string
    ok: boolean
    status: number | null
    error?: string
  }
  /**
   * Recording a desktop app (`vos record --app`): whether the helper runs
   * here, and what macOS lets it do. The grants are the app's this was run
   * from. Absent on a build before the verb.
   */
  desktop?:
    | {
        available: true
        version: string
        screenRecording: boolean
        accessibility: boolean
      }
    | { available: false; reason: string }
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

/**
 * The doctor's desktop line: whether `vos record --app` can run. Recording a
 * desktop app is an extra, so nothing here fails the doctor: a machine that
 * records pages is ready.
 */
export function desktopLine(d: NonNullable<DoctorFacts['desktop']>): string {
  if (!d.available) return `not available (${d.reason})`
  if (!d.screenRecording)
    return `vos-driver ${d.version}; Screen Recording not granted ✗  switch it on for the app this runs from: System Settings, Privacy & Security, Screen & System Audio Recording`
  return `vos-driver ${d.version}; Screen Recording ✓; Accessibility ${
    d.accessibility
      ? '✓'
      : 'not granted (a scripted take needs it; a performed one records, and a press carries no bounds, so its zoom cannot fit the control)'
  }`
}

/** The report in words; the JSON is `facts` plus `ok` and `next_step`. */
/**
 * The doctor's credential line: the active account by name and the others
 * stored beside it (`@hongbin ✓ (also vosso)`), or that a credential is
 * present from a flag or the environment, or absent. Never a key.
 */
export function credentialLine(
  facts: Pick<DoctorFacts, 'credential' | 'accounts'>,
): string {
  const accounts = facts.accounts ?? []
  const active = accounts.find((a) => a.active)
  const others = accounts.filter((a) => !a.active).map((a) => a.label)
  if (active) {
    return `${active.label} ✓${others.length ? ` (also ${others.join(', ')})` : ''}`
  }
  if (facts.credential) {
    return `present ✓${others.length ? ` (stored: ${others.join(', ')}; vos switch to use one)` : ''}`
  }
  return `absent (vos login when you need hosting)${others.length ? `; stored: ${others.join(', ')}, vos switch to use one` : ''}`
}

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
  lines.push(`credential  ${credentialLine(facts)}`)
  if (facts.desktop) lines.push(`desktop     ${desktopLine(facts.desktop)}`)
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
      'Run: npx vos guide (the steps to record this product; the product-video skill carries the loop)'
  return { ok: nodeOk && browserOk, lines, next_step, facts }
}

// ---------------------------------------------------------------------------
// The plan, the receipt, the undo
// ---------------------------------------------------------------------------

/** The one command `vos setup` runs for a browser, when it finds none. */
export const BROWSER_INSTALL = 'npx playwright install chromium'
/** How a person takes back what `vos setup` wrote. */
export const SETUP_UNDO = 'npx vos setup --remove'

/** The file system a plan reads, injected so a plan needs none to be tested. */
export interface PlanFs {
  exists: (path: string) => boolean
  /** The file's text, or null when it cannot be read. */
  read: (path: string) => string | null
  list: (path: string) => string[]
  /** A symbolic link sits at the path itself (never followed). */
  isLink: (path: string) => boolean
  /** A real directory sits at the path itself (a link to one is not one). */
  isDir: (path: string) => boolean
}

/** What one run of `vos setup` was asked for, after its flags are read. */
export interface SetupAsk {
  root: string
  /** The person's home directory: the base of a --global home. */
  home: string
  /** The homes the flags select; empty means the `.agents` fallback. */
  homes: AgentHome[]
  global: boolean
  skills: 'bundled' | 'skills.sh' | 'skipped'
  /** The copy of the catalog this package ships, or null when it has none. */
  bundledDir: string | null
  /** The catalog command `--skills-from-catalog` would run, as typed. */
  catalogCommand: string | null
  browser: BrowserProbe
  /** False under --no-browser: nothing is installed whatever is found. */
  installBrowser: boolean
  /** False under --no-rules. */
  rules: boolean
}

/** What `vos setup` would do, as data. Nothing in it has happened. */
export interface SetupPlan {
  agents: AgentName[]
  global: boolean
  skills: {
    via: 'bundled' | 'skills.sh' | 'skipped'
    /** The catalog tag the skills are at, when the package says. */
    version: string | null
    /** The command that would be spawned (the catalog path only). */
    command: string | null
    targets: SkillsTarget[]
  }
  browser: {
    kind: BrowserProbe['kind']
    path: string | null
    /** The command that would be run, or null when none would be. */
    install: string | null
  }
  /** Null under --no-rules. */
  rules: { file: string; action: RulesAction; block: string } | null
}

/** What a copy into one skills directory does with each skill. */
export interface SkillsTarget {
  dir: string
  /** Every skill the copy is about. */
  names: string[]
  /** The ones already there as directories: the copy overwrites them. */
  existing: string[]
  /** The ones left as they are, each with why. Never copied over. */
  kept: { name: string; reason: string }[]
}

/** Why a skill that is already there as a link is not copied over. */
export const KEPT_LINK =
  'a symbolic link, so this skill was installed another way'
/** Why a file standing where a skill would go is not copied over. */
export const KEPT_FILE =
  'a file, not a directory, and vos setup deletes nothing to make room'
/** Why nothing is copied into a skills directory reached through a link. */
export function keptBehindLink(link: string): string {
  return `reached through a symbolic link (${link}), and vos setup copies nothing through one`
}

/** The directory a home's paths are walked down from. */
function baseOf(home: AgentHome, bases: { root: string; home: string }) {
  return home.scope === 'global' ? bases.home : bases.root
}

/**
 * The symbolic link a home's skills directory is reached through, or null:
 * the directory itself, or any directory between it and the repository
 * (the person's home, under --global).
 */
export function skillsDirLink(
  home: AgentHome,
  bases: { root: string; home: string },
  isLink: (path: string) => boolean,
): string | null {
  return linkOnPath(baseOf(home, bases), skillsDirFor(home), isLink)
}

/**
 * What copying `names` into one home's skills directory does, decided
 * before any byte moves: a skill already there as a symbolic link is left
 * as it is (never copied over, never followed, never removed), a file
 * standing in the way is left too, a directory is overwritten, and a
 * skills directory reached through a link takes nothing at all.
 */
export function skillsTarget(
  home: AgentHome,
  names: string[],
  bases: { root: string; home: string },
  fs: PlanFs,
): SkillsTarget {
  const dir = skillsDirFor(home)
  const link = skillsDirLink(home, bases, fs.isLink)
  if (link) {
    const reason = keptBehindLink(link)
    return {
      dir,
      names,
      existing: [],
      kept: names.map((name) => ({ name, reason })),
    }
  }
  const existing: string[] = []
  const kept: SkillsTarget['kept'] = []
  for (const name of names) {
    const path = join(dir, name)
    if (fs.isLink(path)) kept.push({ name, reason: KEPT_LINK })
    else if (fs.isDir(path)) existing.push(name)
    else if (fs.exists(path)) kept.push({ name, reason: KEPT_FILE })
  }
  return { dir, names, existing, kept }
}

/**
 * The plan for one `vos setup`: the same decisions the verb makes, read off
 * the disk and never written to it.
 */
export function planSetup(ask: SetupAsk, fs: PlanFs): SetupPlan {
  const names =
    ask.skills !== 'skipped' && ask.bundledDir
      ? installedSkills(ask.bundledDir, fs.exists, fs.list)
      : []
  const targets =
    ask.skills === 'skipped'
      ? []
      : (ask.homes.length ? ask.homes : [fallbackSkillsHome(ask.root)]).map(
          (home) => skillsTarget(home, names, ask, fs),
        )
  let rules: SetupPlan['rules'] = null
  if (ask.rules) {
    const file = rulesFileFor(ask.root, fs.exists)
    rules = {
      file,
      action: rulesAction(fs.exists(file) ? fs.read(file) : null),
      block: RULES_BLOCK,
    }
  }
  return {
    agents: [...new Set(ask.homes.map((h) => h.agent))],
    global: ask.global,
    skills: {
      via: ask.skills,
      version:
        ask.skills !== 'skipped' && ask.bundledDir
          ? bundledSkillsVersion(ask.bundledDir, fs.read)
          : null,
      command: ask.skills === 'skills.sh' ? ask.catalogCommand : null,
      targets,
    },
    browser: {
      kind: ask.browser.kind,
      path: ask.browser.path,
      install:
        ask.browser.kind === 'none' && ask.installBrowser
          ? BROWSER_INSTALL
          : null,
    },
    rules,
  }
}

/** A path as a person reads it: relative inside the working directory. */
export function displayPath(path: string, cwd: string): string {
  const rel = relative(cwd, path)
  return rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel : path
}

/** The plan in words, for a person at a terminal. */
export function setupPlanLines(plan: SetupPlan, cwd: string): string[] {
  const lines = ['vos setup would do this. Nothing has been changed.', '']
  lines.push(
    plan.agents.length
      ? `agents: ${plan.agents.join(', ')}${plan.global ? ' (their home directories too)' : ''}`
      : 'agents: none detected here (the skills would land in .agents/skills, which every agent reads)',
  )
  const { skills } = plan
  if (skills.via === 'skipped') lines.push('skills: none (--no-skills)')
  else {
    lines.push(
      skills.via === 'skills.sh'
        ? `skills: through skills.sh, by running ${skills.command}; the copy this package ships is copied instead when it does not answer`
        : `skills: the copy this package ships${skills.version ? ` (catalog ${skills.version})` : ''}, copied`,
    )
    for (const t of skills.targets) {
      const left = new Set(t.kept.map((k) => k.name))
      const fresh = t.names.filter(
        (n) => !t.existing.includes(n) && !left.has(n),
      )
      lines.push(`  into ${displayPath(t.dir, cwd)}`)
      if (fresh.length) lines.push(`    new: ${fresh.join(', ')}`)
      if (t.existing.length)
        lines.push(
          `    already there, would be overwritten: ${t.existing.join(', ')}`,
        )
      // One line per reason: a linked skills directory keeps every name for
      // the same one.
      for (const reason of new Set(t.kept.map((k) => k.reason)))
        lines.push(
          `    left as it is (${reason}): ${t.kept
            .filter((k) => k.reason === reason)
            .map((k) => k.name)
            .join(', ')}`,
        )
    }
  }
  const { browser } = plan
  lines.push(
    browser.kind !== 'none'
      ? `browser: found (${browser.path}); nothing would be installed`
      : browser.install
        ? `browser: none found; would run ${browser.install}`
        : 'browser: none found, and none would be installed (--no-browser)',
  )
  if (!plan.rules) lines.push('rules: none (--no-rules)')
  else {
    const file = displayPath(plan.rules.file, cwd)
    lines.push(
      plan.rules.action === 'current'
        ? `rules: ${file} already carries this block; it would not be touched`
        : plan.rules.action === 'replace'
          ? `rules: the marked block in ${file} would be replaced with this one, and nothing else in the file`
          : `rules: this block would be added at the end of ${file}`,
      '',
      ...plan.rules.block.split('\n'),
    )
  }
  lines.push(
    '',
    `Nothing was changed. npx vos setup does it; ${SETUP_UNDO} undoes it.`,
  )
  return lines
}

/** What one run of `vos setup` wrote, as the verb noted it while writing. */
export interface SetupWrites {
  /** The skill directories whose contents changed; `replaced` when one was there. */
  skills: { path: string; replaced: boolean }[]
  /** What stood where a skill would go and was left as it was, with why. */
  kept: { path: string; reason: string }[]
  /** The rules file, when its text changed. */
  rules: { file: string; action: 'write' | 'replace'; created: boolean } | null
  /** The browser install: whether it ran, and the browser it left. */
  browser: { ran: boolean; path: string | null }
}

/**
 * The receipt: every path a run created or modified, absolute and sorted,
 * and the same in words, then what it found in the way and left as it was.
 * A run that changed nothing says so. A path that was left is never listed
 * as changed.
 */
export function setupReceipt(
  writes: SetupWrites,
  cwd: string,
): { changed: string[]; lines: string[] } {
  const left = new Set(writes.kept.map((k) => k.path))
  const notes = new Map<string, string>()
  for (const s of writes.skills)
    if (!left.has(s.path)) notes.set(s.path, s.replaced ? 'replaced' : 'new')
  if (writes.rules)
    notes.set(
      writes.rules.file,
      writes.rules.created
        ? 'created, holding the vos block'
        : writes.rules.action === 'replace'
          ? 'the vos block replaced'
          : 'the vos block added',
    )
  if (writes.browser.ran && writes.browser.path)
    notes.set(
      writes.browser.path,
      `Chromium, installed by ${BROWSER_INSTALL}; vos setup --remove leaves it`,
    )
  const changed = [...notes.keys()].sort()
  const lines = changed.length
    ? [
        'changed:',
        ...changed.map((p) => `  ${displayPath(p, cwd)} (${notes.get(p)})`),
      ]
    : ['changed: nothing (what vos setup writes was already in place)']
  if (writes.kept.length)
    lines.push(
      'left as it was:',
      ...writes.kept.map((k) => `  ${displayPath(k.path, cwd)} (${k.reason})`),
    )
  if (writes.browser.ran && !writes.browser.path)
    lines.push(`ran: ${BROWSER_INSTALL} (no browser was found after it)`)
  lines.push(`undo: ${SETUP_UNDO}`)
  return { changed, lines }
}

/** The `name:` a SKILL.md's frontmatter gives, or null when it has none. */
export function skillFrontmatterName(text: string): string | null {
  const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  if (!front) return null
  const line = /^name:[ \t]*(.+?)[ \t]*$/m.exec(front[1])
  return line ? line[1].replace(/^(['"])(.*)\1$/, '$2') : null
}

/** A skill's directory name: one path segment, and never `.` or `..`. */
const SKILL_NAME = /^[a-z0-9][a-z0-9_-]*$/i

/** The rules files a run may have written, older runs included. */
export const RULES_FILES = ['AGENTS.md', 'CLAUDE.md'] as const

/** What the undo reads: the plan's file system, and what sits AT a path. */
export interface RemovalFs extends PlanFs {
  /** The path with every link resolved; the path itself when it cannot be. */
  realpath: (path: string) => string
}

export type RemovalItem =
  /** A skill's own directory, removed whole. */
  | { kind: 'skill'; path: string }
  /** A link to a skill: the link is removed, never what it points at. */
  | { kind: 'link'; path: string }
  /** A skills directory the removal leaves empty. */
  | { kind: 'dir'; path: string }
  /** A rules file, rewritten without the block. */
  | { kind: 'rules'; path: string; text: string }
  /** A rules file that was only ever the block. */
  | { kind: 'rules-file'; path: string }

export interface RemovalPlan {
  remove: RemovalItem[]
  kept: { path: string; reason: string }[]
}

/** The first symbolic link on the way from `base` down to `dir`, or null. */
function linkOnPath(
  base: string,
  dir: string,
  isLink: (path: string) => boolean,
): string | null {
  let at = base
  for (const part of relative(base, dir).split(sep).filter(Boolean)) {
    at = join(at, part)
    if (isLink(at)) return at
  }
  return null
}

/**
 * What `vos setup --remove` takes back out, decided before anything is
 * touched. A skill goes only when it is provably the one this package
 * ships: a bundled skill's name, holding a SKILL.md whose frontmatter names
 * that same skill. The only paths ever built are a selected skills
 * directory joined with a BUNDLED name, so nothing on the person's disk
 * steers where a removal lands; a skills directory reached through a
 * symbolic link is left alone, and a skill that is itself a link loses the
 * link, never what it points at. The rules files lose the marked block and
 * nothing else.
 */
export function planRemoval(
  ask: {
    root: string
    /** The person's home directory: the base of a --global home. */
    home: string
    homes: AgentHome[]
    /** False under --no-skills. */
    skills: boolean
    /** False under --no-rules. */
    rules: boolean
    bundledDir: string | null
  },
  fs: RemovalFs,
): RemovalPlan {
  const remove: RemovalItem[] = []
  const kept: RemovalPlan['kept'] = []

  if (ask.skills && ask.bundledDir) {
    const bundledDir = ask.bundledDir
    const ours = installedSkills(bundledDir, fs.exists, fs.list)
      .filter((name) => SKILL_NAME.test(name))
      .map((name) => ({
        name,
        named: skillFrontmatterName(
          fs.read(join(bundledDir, name, 'SKILL.md')) ?? '',
        ),
      }))
      .filter((s): s is { name: string; named: string } => s.named !== null)
    const seen = new Set<string>()
    for (const home of ask.homes) {
      const dir = skillsDirFor(home)
      if (seen.has(dir)) continue
      seen.add(dir)
      const link = skillsDirLink(home, ask, fs.isLink)
      if (link) {
        kept.push({
          path: link,
          reason:
            'a symbolic link: nothing behind it was read or removed, so take the vos skills out of where it points by hand',
        })
        continue
      }
      if (!fs.isDir(dir)) continue
      const gone = new Set<string>()
      for (const { name, named } of ours) {
        const path = join(dir, name)
        const linked = fs.isLink(path)
        if (!linked && !fs.isDir(path)) {
          if (fs.exists(path))
            kept.push({ path, reason: 'not a directory, so not a skill' })
          continue
        }
        const skill = fs.read(join(path, 'SKILL.md'))
        if (skill === null) {
          kept.push({
            path,
            reason: 'it holds no SKILL.md, so vos setup did not write it',
          })
          continue
        }
        const found = skillFrontmatterName(skill)
        if (found !== named) {
          kept.push({
            path,
            // A name read off the person's disk is quoted short, never whole.
            reason: `its SKILL.md names ${found === null ? 'no skill' : `"${found.slice(0, 80)}"`}, not "${named}", so it is not the one vos ships`,
          })
          continue
        }
        remove.push({ kind: linked ? 'link' : 'skill', path })
        gone.add(name)
      }
      if (gone.size && fs.list(dir).every((entry) => gone.has(entry))) {
        remove.push({ kind: 'dir', path: dir })
        if (fs.list(home.dir).every((entry) => entry === 'skills'))
          kept.push({
            path: home.dir,
            reason:
              'an empty directory now: it is left because nothing says whether vos setup made it',
          })
      }
    }
  }

  if (ask.rules) {
    const files = RULES_FILES.map((name) => join(ask.root, name)).filter(
      (file) => fs.exists(file),
    )
    const real = files
      .filter((file) => !fs.isLink(file))
      .map((file) => fs.realpath(file))
    for (const file of files) {
      const { text, changed } = removeRulesBlock(fs.read(file) ?? '')
      if (!changed) continue
      if (fs.isLink(file)) {
        // A second name for a file handled under its own name needs nothing.
        if (!real.includes(fs.realpath(file)))
          kept.push({
            path: file,
            reason:
              'a symbolic link to a file that carries the vos block: take the block out of the file it points at by hand',
          })
        continue
      }
      remove.push(
        text.trim() === ''
          ? { kind: 'rules-file', path: file }
          : { kind: 'rules', path: file, text },
      )
    }
  }
  return { remove, kept }
}

/** One removal in words. */
function removalNote(item: RemovalItem): string {
  switch (item.kind) {
    case 'skill':
      return 'the skill'
    case 'link':
      return 'a link to the skill; what it points at stays'
    case 'dir':
      return 'the skills directory, empty once its skills are out'
    case 'rules':
      return 'the vos block; the rest of the file stays as it was'
    case 'rules-file':
      return 'the file, which held only the vos block'
  }
}

/**
 * The undo in words: what went (or, for a plan, what would), what was left
 * and why, and the lines only the person can run.
 */
export function removalLines(
  result: {
    removed: RemovalItem[]
    kept: RemovalPlan['kept']
    manual: string[]
    plan: boolean
  },
  cwd: string,
): string[] {
  const lines: string[] = []
  if (result.plan)
    lines.push(
      'vos setup --remove would do this. Nothing has been changed.',
      '',
    )
  if (result.removed.length)
    lines.push(
      result.plan ? 'would remove:' : 'removed:',
      ...result.removed.map(
        (item) => `  ${displayPath(item.path, cwd)} (${removalNote(item)})`,
      ),
    )
  else
    lines.push(
      `${result.plan ? 'would remove' : 'removed'}: nothing (no vos skill and no vos block is here)`,
    )
  if (result.kept.length)
    lines.push(
      'kept:',
      ...result.kept.map((k) => `  ${displayPath(k.path, cwd)}: ${k.reason}`),
    )
  lines.push(
    'left for you (this never removes a browser, the package, a credential or a take):',
    ...result.manual.map((line) => `  ${line}`),
  )
  if (result.plan) lines.push('', `Nothing was changed. ${SETUP_UNDO} does it.`)
  return lines
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
/**
 * The catalog tag the bundled copy was synced from (`skills/VERSION`, written
 * by `scripts/sync-skills.mjs`), or null when the file is absent.
 */
export function bundledSkillsVersion(
  dir: string,
  read: (path: string) => string | null = readOrNull,
): string | null {
  const v = read(join(dir, 'VERSION'))?.trim() ?? ''
  return /^\d+\.\d+\.\d+$/.test(v) ? v : null
}

function readOrNull(path: string): string | null {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

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
