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
  bundledSkillsVersion,
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
  accountLabel,
  apiError,
  apiJson,
  lastCredential,
  platformOrigin,
  resolveCredential,
} from './platform'
import {
  ACCOUNT_ENV,
  DEFAULT_STORE,
  activate,
  findStored,
  isActive,
  listStored,
  readActive,
  removeAll,
  removeStored,
  switchTarget,
} from './accounts'
import type { Store, StoredCredential } from './accounts'
import type { Reporter } from './output'

const BOOLEAN_FLAGS = new Set([
  'json',
  'help',
  'global',
  'no-skills',
  'skills-from-catalog',
  'no-rules',
  'no-browser',
])
/** `vos logout --all` forgets every stored credential. */
const LOGOUT_FLAGS = new Set([...BOOLEAN_FLAGS, 'all'])

/** The skills catalog's repository, for the opt-in install through skills.sh. */
export const SKILLS_SOURCE = 'vosjs/skills'
/**
 * The catalog CLI (`npx skills`) the opt-in runs, pinned: `npx skills` with
 * no version runs whatever its owner published last, with this machine's
 * permissions. Moved on purpose, with the bundled skills (`pnpm sync-skills`).
 */
export const SKILLS_CLI_VERSION = '1.7.2'
/** The catalog at ONE tag, the one the bundled copy was synced from. */
export function skillsCatalogAt(version: string): string {
  return `https://github.com/${SKILLS_SOURCE}/tree/v${version}`
}

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
    credential: safeResolve() !== null,
    accounts: storedAccounts(platformOrigin()),
    ...(opts.url ? { devServer: await devServerFact(opts.url) } : {}),
  }
}

/** The ladder, with a misnamed VOS_ACCOUNT read as "nothing resolves" here. */
function safeResolve(): string | null {
  try {
    return resolveCredential()
  } catch {
    return null
  }
}

/** The stored accounts for an origin, by name, for doctor and whoami. */
function storedAccounts(
  origin: string,
  store: Store = DEFAULT_STORE,
): { label: string; active: boolean }[] {
  return listStored(store, origin).map((c) => ({
    label: accountLabel(c.account),
    active: isActive(c, store),
  }))
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
  const fromCatalog = flags['skills-from-catalog'] === true
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

  // 2. The skills. The copy this package ships is the default: it is the
  // catalog at the tag this release was cut from (skills/VERSION), reviewed
  // and tested with it, and it needs no network. `--skills-from-catalog`
  // asks skills.sh for that SAME tag through a pinned catalog CLI, so what
  // lands is what this release was tested with either way; the bundled copy
  // stays the fallback when skills.sh cannot be reached. An unpinned
  // `npx skills add vosjs/skills` ran whatever both repositories held that
  // minute, with this machine's permissions.
  let skillsVia: 'skills.sh' | 'bundled' | 'skipped' = 'skipped'
  let skillNames: string[] = []
  if (!noSkills) {
    const bundled = bundledSkillsDir(import.meta.url.replace('file://', ''))
    const version = bundled ? bundledSkillsVersion(bundled) : null
    const targets = homes.length ? homes : [fallbackSkillsHome(root)]
    const copyBundled = (dir: string) => {
      for (const home of targets) {
        const dest = skillsDirFor(home)
        mkdirSync(dest, { recursive: true })
        for (const name of installedSkills(dir)) {
          cpSync(join(dir, name), join(dest, name), { recursive: true })
        }
      }
    }
    if (fromCatalog) {
      const source = version ? skillsCatalogAt(version) : SKILLS_SOURCE
      const args = [
        `skills@${SKILLS_CLI_VERSION}`,
        'add',
        source,
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
        // the copy this package ships is the same files at its tag.
        if (!bundled)
          throw new Error(
            `could not install the skills: npx ${args.join(' ')} failed (${(res.stderr ?? '').trim().split('\n').at(-1) ?? res.error?.message ?? 'no output'}) and this build carries no bundled copy`,
          )
        copyBundled(bundled)
        skillsVia = 'bundled'
        r.log(
          `skills.sh did not answer; copied the bundled skills into ${targets.map((t) => skillsDirFor(t)).join(', ')}`,
        )
      }
    } else {
      if (!bundled)
        throw new Error(
          'this build carries no bundled skills; run with --skills-from-catalog',
        )
      copyBundled(bundled)
      skillsVia = 'bundled'
      r.log(
        `installed the bundled vos skills${version ? ` (catalog ${version})` : ''} into ${targets.map((t) => skillsDirFor(t)).join(', ')}`,
      )
    }
    skillNames = [
      ...new Set(targets.flatMap((h) => installedSkills(skillsDirFor(h)))),
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
 * `GET /user/whoami` (key- or session-readable on vos.so), which rung of the
 * ladder the key came from, and every other account stored for the origin
 * (MA1). Never the key.
 */
export async function cmdWhoami(argv: string[]): Promise<number> {
  const { flags } = parseArgs(argv, BOOLEAN_FLAGS)
  const r = reporterFor(flags)
  const origin = platformOrigin({
    origin: strFlag(flags, 'origin'),
    api: strFlag(flags, 'api'),
  })
  const stored = storedAccounts(origin)
  const others = stored.filter((a) => !a.active).map((a) => a.label)
  const alsoStored = others.length
    ? ` Also stored: ${others.join(', ')}; vos switch <name> to use one.`
    : ''
  const key = resolveCredential({
    key: strFlag(flags, 'key'),
    account: strFlag(flags, 'account'),
    origin,
  })
  if (!key) {
    r.done(
      {
        signedIn: false,
        origin,
        accounts: stored,
        next_step:
          'vos login (only needed for hosting, sharing or cloud rendering)',
      },
      `Not signed in to ${origin}. Recording and rendering need no account; vos login when you want a link.${alsoStored}`,
    )
    return EXIT_ERROR
  }
  const resolved = lastCredential()
  const via = resolved?.via ?? 'stored'
  const viaLine =
    via === 'flag'
      ? ' (the key passed as --key)'
      : via === 'env'
        ? ' (from VOS_API_KEY, which outranks the stored credential)'
        : via === 'account-flag'
          ? ' (--account)'
          : via === 'account-env'
            ? ` (${ACCOUNT_ENV})`
            : ''
  const res = await apiJson(origin, '/api/user/whoami', { key })
  if (res.status === 404) {
    // An origin from before the route: the credential exists, that is all
    // this CLI can say about it without printing it.
    r.done(
      {
        signedIn: true,
        origin,
        via,
        user: null,
        key: null,
        accounts: stored,
        next_step: 'vos push when you want the work hosted',
      },
      `A credential is present for ${origin}${viaLine} (this origin cannot say whose).${alsoStored}`,
    )
    return EXIT_OK
  }
  if (res.status === 401 || res.status === 403) {
    r.done(
      {
        signedIn: false,
        origin,
        via,
        error: apiError('whoami', res),
        accounts: stored,
        next_step: 'vos login',
      },
      `The stored credential is refused by ${origin}${viaLine}: ${apiError('whoami', res)}. Run vos login.${alsoStored}`,
    )
    return EXIT_ERROR
  }
  if (res.status !== 200) throw new Error(apiError('whoami', res))
  const user = res.body.user as {
    id?: string
    name?: string | null
    username?: string | null
    kind?: string
  } | null
  const actor = res.body.actor as {
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
  const orgLine =
    user?.kind === 'org'
      ? ` (an organization${actor ? `, ${actor.username ? `@${actor.username}` : (actor.name ?? 'you')} recorded as the person behind it` : ''})`
      : ''
  const keyLine = k
    ? `key "${k.name ?? ''}" (${k.prefix ?? '…'}, ${(k.scopes ?? []).join(', ') || 'no scopes'})`
    : 'a session, not a key'
  // A stored credential from before the account line learns its name here,
  // so `vos switch` can find it from now on.
  if (via === 'stored' && resolved && !resolved.account && user?.id) {
    const active = readActive(DEFAULT_STORE)
    if (active && active.key === key) {
      activate(DEFAULT_STORE, {
        ...active,
        account: {
          id: user.id,
          kind: user.kind === 'org' ? 'org' : 'person',
          handle: user.username ?? null,
        },
      })
    }
  }
  r.done(
    {
      signedIn: true,
      origin,
      via,
      user,
      actor: actor ?? null,
      key: k,
      accounts: storedAccounts(origin),
      next_step: 'vos push when you want the work hosted',
    },
    `Signed in to ${origin} as ${who}${orgLine}, with ${keyLine}${viaLine}.${alsoStored}`,
  )
  return EXIT_OK
}

/**
 * `vos switch [<handle>]`: make another stored credential the active one
 * (MA1). With exactly two stored for the origin and no name, the other one
 * (gh's rule); otherwise the name is required and the stored ones are
 * listed. Prints names, never a key.
 */
export function cmdSwitch(argv: string[]): number {
  const { flags, positionals } = parseArgs(argv, BOOLEAN_FLAGS)
  const r = reporterFor(flags)
  const origin = platformOrigin({
    origin: strFlag(flags, 'origin'),
    api: strFlag(flags, 'api'),
  })
  const store = DEFAULT_STORE
  const stored = listStored(store, origin)
  const active = readActive(store)
  const target = switchTarget(
    stored,
    active?.key ?? null,
    positionals[0],
    origin,
  )
  if (!target.ok) throw new UsageError(target.error)
  const to = target.to
  if (active && active.key === to.key) {
    r.done(
      {
        origin,
        account: to.account,
        changed: false,
        accounts: storedAccounts(origin, store),
        next_step: 'vos push when you want the work hosted',
      },
      `${accountLabel(to.account)} is already the account in use on ${origin}.`,
    )
    return EXIT_OK
  }
  activate(store, to)
  const envKey = Boolean(process.env.VOS_API_KEY?.trim())
  r.done(
    {
      origin,
      account: to.account,
      changed: true,
      accounts: storedAccounts(origin, store),
      next_step: envKey
        ? 'unset VOS_API_KEY; it outranks the stored credential'
        : 'vos push when you want the work hosted',
    },
    `Now ${accountLabel(to.account)} on ${origin}${
      active?.account ? ` (${accountLabel(active.account)} stays stored)` : ''
    }.${envKey ? ' VOS_API_KEY is set in this shell and still outranks it.' : ''}`,
  )
  return EXIT_OK
}

/**
 * `vos logout [<handle>] [--all]`: forget the active credential, a named
 * one, or every stored one (MA1). Idempotent; says what remains.
 */
export function cmdLogout(argv: string[]): number {
  const { flags, positionals } = parseArgs(argv, LOGOUT_FLAGS)
  const r = reporterFor(flags)
  const origin = platformOrigin({
    origin: strFlag(flags, 'origin'),
    api: strFlag(flags, 'api'),
  })
  const store = DEFAULT_STORE
  const envKey = Boolean(process.env.VOS_API_KEY?.trim())
  const envNote = envKey
    ? ' VOS_API_KEY is still set in this shell and still resolves.'
    : ''
  const envStep = envKey
    ? 'unset VOS_API_KEY as well; it still resolves'
    : 'vos login when you next need hosting'
  if (flags.all === true) {
    const { had } = removeAll(store)
    r.done(
      {
        path: CREDENTIALS_PATH,
        removed: had,
        all: true,
        envCredential: envKey,
        next_step: envStep,
      },
      (had ? 'Removed every stored credential.' : 'Nothing was stored.') +
        envNote,
    )
    return EXIT_OK
  }
  const ref = positionals[0]
  const target: StoredCredential | null = ref
    ? findStored(store, origin, ref)
    : readActive(store)
  if (!target) {
    const have = storedAccounts(origin, store)
    r.done(
      {
        path: CREDENTIALS_PATH,
        removed: false,
        envCredential: envKey,
        accounts: have,
        next_step: envStep,
      },
      (ref
        ? `Nothing stored for ${ref.startsWith('@') ? ref : `@${ref}`} on ${origin}.`
        : `Nothing stored at ${CREDENTIALS_PATH}.`) +
        (have.length
          ? ` Stored: ${have.map((a) => a.label).join(', ')}.`
          : '') +
        envNote,
    )
    return EXIT_OK
  }
  const { wasActive } = removeStored(store, target)
  const left = storedAccounts(origin, store)
  const leftLine = left.length
    ? wasActive
      ? ` Still stored: ${left.map((a) => a.label).join(', ')}; vos switch <name> to use one.`
      : ` ${left.find((a) => a.active)?.label ?? 'another account'} stays in use.`
    : ''
  r.done(
    {
      path: CREDENTIALS_PATH,
      removed: true,
      account: target.account,
      wasActive,
      envCredential: envKey,
      accounts: left,
      next_step: left.length && wasActive ? 'vos switch <name>' : envStep,
    },
    `Removed ${accountLabel(target.account)} (${target.origin}).${leftLine}${envNote}`,
  )
  return EXIT_OK
}
