/**
 * `vos setup`, `vos doctor`, `vos whoami`, `vos logout` (AN1): the verbs
 * that ready the machine and say what is on it. The facts come from
 * `machine.ts`; this file is the part that spawns, copies and prints.
 *
 * Output: NDJSON when `--json` is given OR stdout is not a TTY (an agent
 * reads these verbs far more often than a person does), always ending in a
 * `done` event that carries `next_step`. No verb here ever prints a
 * credential; `whoami` answers a key's NAME and the account's handle.
 */
import { spawnSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { UsageError, parseArgs, strFlag } from './args'
import {
  agentsFromFlag,
  applyRulesBlock,
  bundledSkillsDir,
  detectAgents,
  doctorReport,
  fallbackSkillsHome,
  installedSkills,
  probeBrowser,
  rulesFileFor,
  skillsDirFor,
} from './machine'
import type { AgentHome, BrowserProbe, DoctorFacts } from './machine'
import { EXIT_ERROR, EXIT_NO_BROWSER, EXIT_OK, createReporter } from './output'
import {
  CREDENTIALS_PATH,
  apiError,
  apiJson,
  platformOrigin,
  resolveCredential,
} from './platform'
import type { Reporter } from './output'

const BOOLEAN_FLAGS = new Set([
  'json',
  'help',
  'global',
  'no-skills',
  'no-rules',
  'no-browser',
])

/** The skills catalog on skills.sh, the first rung of the install. */
export const SKILLS_SOURCE = 'vosjs/skills'

function reporterFor(flags: Record<string, string | true>): Reporter {
  return createReporter(flags.json === true || process.stdout.isTTY !== true)
}

function npx(): string {
  return process.platform === 'win32' ? 'npx.cmd' : 'npx'
}

/** Playwright's bundled Chromium, when it has been installed. */
function bundledChromium(): string | null {
  try {
    const p = chromium.executablePath()
    return p && existsSync(p) ? p : null
  } catch {
    return null
  }
}

function probe(): BrowserProbe {
  return probeBrowser({
    platform: process.platform,
    env: process.env,
    exists: existsSync,
    bundled: bundledChromium,
  })
}

function ffmpegVersion(): string | null {
  const res = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' })
  if (res.status !== 0 || !res.stdout) return null
  const m = /ffmpeg version (\S+)/.exec(res.stdout)
  return m ? m[1] : 'present'
}

async function devServerFact(url: string): Promise<DoctorFacts['devServer']> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(2000),
      redirect: 'manual',
    })
    return { url, ok: res.status < 500, status: res.status }
  } catch (e) {
    return {
      url,
      ok: false,
      status: null,
      error: e instanceof Error ? e.message.split('\n')[0] : String(e),
    }
  }
}

/** The vos skills, by name: what the bundled catalog carries. */
function catalogNames(): string[] | null {
  const bundled = bundledSkillsDir(import.meta.url.replace('file://', ''))
  return bundled ? installedSkills(bundled) : null
}

/**
 * Every home's installed VOS skills, project and (under --global) home. A
 * home directory holds every skill a person ever installed; doctor answers
 * for ours, so the list is filtered to the catalog's names when the
 * bundled copy is there to say what they are.
 */
function skillsFacts(homes: AgentHome[]): DoctorFacts['skills'] {
  const ours = catalogNames()
  return homes.map((h) => ({
    agent: h.agent,
    scope: h.scope,
    names: installedSkills(skillsDirFor(h)).filter(
      (n) => !ours || ours.includes(n),
    ),
  }))
}

async function doctorFacts(opts: {
  homes: AgentHome[]
  url?: string
}): Promise<DoctorFacts> {
  return {
    node: process.versions.node,
    browser: probe(),
    ffmpeg: ffmpegVersion(),
    skills: skillsFacts(opts.homes),
    credential: resolveCredential() !== null,
    ...(opts.url ? { devServer: await devServerFact(opts.url) } : {}),
  }
}

/**
 * `vos setup`: the skills into the agents' directories (skills.sh when
 * `npx` answers, else the copy this package ships), a browser found or
 * installed, one idempotent block in the rules file, then doctor.
 */
export async function cmdSetup(argv: string[]): Promise<number> {
  const { flags } = parseArgs(argv, BOOLEAN_FLAGS)
  const r = reporterFor(flags)
  const root = process.cwd()
  const global = flags.global === true
  const url = strFlag(flags, 'url')
  // Every flag is read up front: the flag tracker records READS, and a
  // --no-browser consulted only when no browser exists would count as
  // ignored on the machine that has one.
  const noSkills = flags['no-skills'] === true
  const noRules = flags['no-rules'] === true
  const noBrowser = flags['no-browser'] === true

  // 1. Which agents.
  const wanted = strFlag(flags, 'agent')
  let homes: AgentHome[]
  if (wanted) {
    const v = agentsFromFlag(wanted, root)
    if ('error' in v) throw new UsageError(v.error)
    homes = v.homes
  } else {
    homes = detectAgents(root, { home: homedir(), global })
  }
  const agents = [...new Set(homes.map((h) => h.agent))]
  r.event({ event: 'agents', agents, global })
  r.log(
    agents.length
      ? `agents: ${agents.join(', ')}`
      : 'agents: none detected here (the skills land in .agents/skills, which every agent reads)',
  )

  // 2. The skills.
  let skillsVia: 'skills.sh' | 'bundled' | 'skipped' = 'skipped'
  let skillNames: string[] = []
  if (!noSkills) {
    const args = [
      'skills',
      'add',
      SKILLS_SOURCE,
      '-y',
      ...(global ? ['-g'] : []),
    ]
    r.log(`installing the vos skills: npx ${args.join(' ')}`)
    const res = spawnSync(npx(), args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
      timeout: 120_000,
    })
    if (res.status === 0) {
      skillsVia = 'skills.sh'
    } else {
      // The catalog CLI did not answer (no network, no npx, an older npm):
      // the copy this package ships is the same files at its release.
      const bundled = bundledSkillsDir(import.meta.url.replace('file://', ''))
      if (!bundled)
        throw new Error(
          `could not install the skills: npx skills add ${SKILLS_SOURCE} failed (${(res.stderr ?? '').trim().split('\n').at(-1) ?? res.error?.message ?? 'no output'}) and this build carries no bundled copy`,
        )
      const targets = homes.length ? homes : [fallbackSkillsHome(root)]
      for (const home of targets) {
        const dest = skillsDirFor(home)
        mkdirSync(dest, { recursive: true })
        for (const name of installedSkills(bundled)) {
          cpSync(join(bundled, name), join(dest, name), { recursive: true })
        }
      }
      skillsVia = 'bundled'
      r.log(
        `skills.sh did not answer; copied the bundled skills into ${targets.map((t) => skillsDirFor(t)).join(', ')}`,
      )
    }
    skillNames = [
      ...new Set(
        (homes.length ? homes : [fallbackSkillsHome(root)]).flatMap((h) =>
          installedSkills(skillsDirFor(h)),
        ),
      ),
    ].sort()
  }
  r.event({ event: 'skills', via: skillsVia, names: skillNames })

  // 3. The browser.
  let browser = probe()
  if (browser.kind === 'none' && !noBrowser) {
    r.log(
      'no browser found; installing Chromium: npx playwright install chromium',
    )
    spawnSync(npx(), ['playwright', 'install', 'chromium'], {
      cwd: root,
      stdio: ['ignore', 'ignore', 'inherit'],
      shell: process.platform === 'win32',
      timeout: 600_000,
    })
    browser = probe()
  }
  r.event({ event: 'browser', kind: browser.kind, path: browser.path })
  r.log(`browser: ${browser.line}`)

  // 4. The rules block.
  let rules: { file: string; changed: boolean } | null = null
  if (!noRules) {
    const file = rulesFileFor(root)
    const existing = existsSync(file) ? readFileSync(file, 'utf8') : null
    const { text, changed } = applyRulesBlock(existing)
    if (changed) writeFileSync(file, text)
    rules = { file, changed }
    r.log(
      changed
        ? `rules: wrote the vosso block into ${file}`
        : `rules: ${file} already carries the block`,
    )
  }
  r.event({ event: 'rules', ...(rules ?? { file: null, changed: false }) })

  // 5. Doctor.
  const report = doctorReport(
    await doctorFacts({
      homes: homes.length ? homes : [fallbackSkillsHome(root)],
      url,
    }),
  )
  r.done(
    {
      agents,
      skills: { via: skillsVia, names: skillNames },
      browser: { kind: browser.kind, path: browser.path },
      rules,
      doctor: { ok: report.ok, ...report.facts },
      next_step: report.next_step,
    },
    `${report.lines.join('\n')}\n\nNext: ${report.next_step}`,
  )
  return report.ok ? EXIT_OK : EXIT_NO_BROWSER
}

/** `vos doctor`: what is ready, in words; exit 3 when no browser. */
export async function cmdDoctor(argv: string[]): Promise<number> {
  const { flags } = parseArgs(argv, BOOLEAN_FLAGS)
  const r = reporterFor(flags)
  const root = process.cwd()
  const homes = detectAgents(root, { home: homedir(), global: true })
  const report = doctorReport(
    await doctorFacts({
      homes: homes.length ? homes : [fallbackSkillsHome(root)],
      url: strFlag(flags, 'url'),
    }),
  )
  r.done(
    { ok: report.ok, ...report.facts, next_step: report.next_step },
    `${report.lines.join('\n')}\n\nNext: ${report.next_step}`,
  )
  return report.ok ? EXIT_OK : EXIT_NO_BROWSER
}

/**
 * `vos whoami`: the key's name and the account it belongs to, from
 * `GET /user/whoami` (key- or session-readable on vos.so). Never the key.
 */
export async function cmdWhoami(argv: string[]): Promise<number> {
  const { flags } = parseArgs(argv, BOOLEAN_FLAGS)
  const r = reporterFor(flags)
  const origin = platformOrigin({
    origin: strFlag(flags, 'origin'),
    api: strFlag(flags, 'api'),
  })
  const key = resolveCredential(strFlag(flags, 'key'))
  if (!key) {
    r.done(
      {
        signedIn: false,
        origin,
        next_step:
          'vos login (only needed for hosting, sharing or cloud rendering)',
      },
      `Not signed in to ${origin}. Recording and rendering need no account; vos login when you want a link.`,
    )
    return EXIT_ERROR
  }
  const res = await apiJson(origin, '/api/user/whoami', { key })
  if (res.status === 404) {
    // An origin from before the route: the credential exists, that is all
    // this CLI can say about it without printing it.
    r.done(
      {
        signedIn: true,
        origin,
        user: null,
        key: null,
        next_step: 'vos push when you want the work hosted',
      },
      `A credential is present for ${origin} (this origin cannot say whose).`,
    )
    return EXIT_OK
  }
  if (res.status === 401 || res.status === 403) {
    r.done(
      {
        signedIn: false,
        origin,
        error: apiError('whoami', res),
        next_step: 'vos login',
      },
      `The stored credential is refused by ${origin}: ${apiError('whoami', res)}. Run vos login.`,
    )
    return EXIT_ERROR
  }
  if (res.status !== 200) throw new Error(apiError('whoami', res))
  const user = res.body.user as {
    name?: string | null
    username?: string | null
  } | null
  const k = res.body.key as {
    name?: string
    prefix?: string
    scopes?: string[]
    createdAt?: string
  } | null
  const who = user?.username
    ? `@${user.username}`
    : (user?.name ?? 'an account')
  const keyLine = k
    ? `key "${k.name ?? ''}" (${k.prefix ?? '…'}, ${(k.scopes ?? []).join(', ') || 'no scopes'})`
    : 'a session, not a key'
  r.done(
    {
      signedIn: true,
      origin,
      user,
      key: k,
      next_step: 'vos push when you want the work hosted',
    },
    `Signed in to ${origin} as ${who}, with ${keyLine}.`,
  )
  return EXIT_OK
}

/** `vos logout`: remove the credentials file. Idempotent. */
export function cmdLogout(argv: string[]): number {
  const { flags } = parseArgs(argv, BOOLEAN_FLAGS)
  const r = reporterFor(flags)
  const had = existsSync(CREDENTIALS_PATH)
  rmSync(CREDENTIALS_PATH, { force: true })
  const envKey = Boolean(process.env.VOS_API_KEY?.trim())
  r.done(
    {
      path: CREDENTIALS_PATH,
      removed: had,
      envCredential: envKey,
      next_step: envKey
        ? 'unset VOS_API_KEY as well; it still resolves'
        : 'vos login when you next need hosting',
    },
    (had
      ? `Removed ${CREDENTIALS_PATH}.`
      : `Nothing stored at ${CREDENTIALS_PATH}.`) +
      (envKey
        ? ' VOS_API_KEY is still set in this shell and still resolves.'
        : ''),
  )
  return EXIT_OK
}
