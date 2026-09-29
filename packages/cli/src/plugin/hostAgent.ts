import { existsSync } from 'node:fs'

/**
 * Which coding agent is driving this CLI, read from the environment the agent
 * spawned it in. Used ONLY to name the tool on a pushed version (`clientId`),
 * which the platform treats as display-only: attribution trust stays with the
 * credential, so a wrong or spoofed answer changes a label and nothing else.
 *
 * The signals follow `@vercel/detect-agent` (Apache-2.0), kept as a small
 * synchronous table because every push reads it: the cross-tool `AI_AGENT`
 * convention first, then each host's own marker. Returns a lowercase slug,
 * or null when nothing says an agent is here.
 */
export type Env = Record<string, string | undefined>

const SLUG = /^[a-z0-9][a-z0-9.-]{0,39}$/

/** The markers each host sets in the shells it runs, in precedence order. */
const MARKERS: Array<[slug: string, test: (env: Env) => boolean]> = [
  ['cursor', (e) => !!e.CURSOR_TRACE_ID],
  [
    'cursor-cli',
    (e) => !!e.CURSOR_AGENT || e.CURSOR_EXTENSION_HOST_ROLE === 'agent-exec',
  ],
  ['gemini-cli', (e) => !!e.GEMINI_CLI],
  ['codex', (e) => !!(e.CODEX_SANDBOX || e.CODEX_CI || e.CODEX_THREAD_ID)],
  ['antigravity', (e) => !!e.ANTIGRAVITY_AGENT],
  ['augment-cli', (e) => !!e.AUGMENT_AGENT],
  ['opencode', (e) => !!e.OPENCODE_CLIENT],
  [
    'claude-code',
    (e) => !!(e.CLAUDECODE || e.CLAUDE_CODE) && !e.CLAUDE_CODE_IS_COWORK,
  ],
  ['claude-cowork', (e) => !!(e.CLAUDECODE || e.CLAUDE_CODE)],
  ['replit', (e) => !!e.REPL_ID],
  [
    'github-copilot',
    (e) => !!(e.COPILOT_MODEL || e.COPILOT_ALLOW_ALL || e.COPILOT_GITHUB_TOKEN),
  ],
]

const DEVIN_LOCAL_PATH = '/opt/.devin'

/**
 * `AI_AGENT` is free text by convention (`claude-code_2-1-284_agent`,
 * `github-copilot`, `v0`): the tool's name is its leading run of
 * `[a-z0-9.-]`, lowercased, so a version or a role suffix never reaches the
 * label and nothing but a short slug ever leaves the machine.
 */
export function slugFromAiAgent(value: string): string | null {
  const head = value.trim().toLowerCase().split('_')[0] ?? ''
  if (head === 'github-copilot-cli') return 'github-copilot'
  return SLUG.test(head) ? head : null
}

export function detectHostAgent(
  env: Env = process.env,
  exists: (path: string) => boolean = existsSync,
): string | null {
  if (env.AI_AGENT) {
    const slug = slugFromAiAgent(env.AI_AGENT)
    if (slug) return slug
  }
  for (const [slug, test] of MARKERS) if (test(env)) return slug
  try {
    if (exists(DEVIN_LOCAL_PATH)) return 'devin'
  } catch {
    // An unreadable path is not an agent.
  }
  return null
}
