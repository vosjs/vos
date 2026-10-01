/**
 * `vos build <program.mjs> [--out config.json]` — author a program as real
 * module code and get the wire's config.
 *
 * A VosConfigJson carries its functions as STRINGS, so every port wrote a
 * build script that stringified them, and each one learned the same traps
 * by hand: a function that reads a constant from module scope works in Node
 * and throws in the page (the string travels without its closure), method
 * shorthand does not survive `toString()` as an expression, TypeScript
 * syntax passes the editor and dies in the browser. This verb is that build
 * script, once: it imports the module, stringifies each function, refuses
 * what cannot run on its own, and records where each function lives so an
 * error the engine reports as `createContent:12` can be found in the file.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parse } from 'acorn'
import { fullAncestor } from 'acorn-walk'
import { UsageError, parseArgs, strFlag } from './args'
import { EXIT_ERROR, EXIT_OK, createReporter } from './output'

/** The config keys whose values are functions on the wire. */
export const FUNCTION_KEYS = [
  'setup',
  'createContent',
  'createTimeline',
  'onFrame',
  'retime',
] as const

/** Names a program may read without declaring them: the page's globals. */
const PAGE_GLOBALS = new Set([
  'window',
  'document',
  'navigator',
  'location',
  'performance',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'devicePixelRatio',
  'Image',
  'ImageData',
  'ImageBitmap',
  'createImageBitmap',
  'OffscreenCanvas',
  'HTMLCanvasElement',
  'CanvasRenderingContext2D',
  'Path2D',
  'DOMMatrix',
  'FontFace',
  'Blob',
  'URL',
  'fetch',
  'Response',
  'TextEncoder',
  'TextDecoder',
  'AudioContext',
  'OfflineAudioContext',
  'getComputedStyle',
  'matchMedia',
  'atob',
  'btoa',
])
const JS_GLOBALS = new Set(Object.getOwnPropertyNames(globalThis))
JS_GLOBALS.add('undefined')
JS_GLOBALS.add('arguments')

export interface BuildProblem {
  fn: string
  message: string
}

/**
 * A function's own source as an EXPRESSION: arrow functions and `function`
 * expressions are already one; method shorthand (`createContent(ctx) {…}`,
 * `async setup(ctx) {…}`) is rewritten to a `function` expression.
 */
export function functionSource(fn: (...args: never[]) => unknown): string {
  const src = fn.toString()
  if (parsesAsExpression(src)) return src
  const asyncMethod = /^async\s+/.test(src)
  const body = asyncMethod ? src.replace(/^async\s+/, '') : src
  const candidate = `${asyncMethod ? 'async ' : ''}function ${body}`
  if (parsesAsExpression(candidate)) return candidate
  return src
}

function parsesAsExpression(src: string): boolean {
  try {
    parse(`(${src})`, { ecmaVersion: 'latest' })
    return true
  } catch {
    return false
  }
}

/**
 * The names a function reads that it neither declares nor gets from the
 * page (pure). Declarations count anywhere in the function (a deliberate
 * over-approximation: a name declared in any inner scope is not reported),
 * so what is left is what the string would carry no value for: module
 * constants, imports, helpers defined beside it.
 */
export function freeIdentifiers(src: string): string[] {
  const ast = parse(`(${src})`, { ecmaVersion: 'latest' })
  const declared = new Set<string>()
  const read = new Set<string>()
  const addPattern = (p: any): void => {
    if (!p) return
    if (p.type === 'Identifier') declared.add(p.name)
    else if (p.type === 'ObjectPattern')
      for (const prop of p.properties)
        addPattern(prop.type === 'RestElement' ? prop.argument : prop.value)
    else if (p.type === 'ArrayPattern')
      for (const el of p.elements) addPattern(el)
    else if (p.type === 'RestElement') addPattern(p.argument)
    else if (p.type === 'AssignmentPattern') addPattern(p.left)
  }
  fullAncestor(ast, (node: any, _state: unknown, ancestors: any[]) => {
    if (
      node.type === 'FunctionDeclaration' ||
      node.type === 'FunctionExpression' ||
      node.type === 'ArrowFunctionExpression'
    ) {
      if (node.id) declared.add(node.id.name)
      for (const p of node.params) addPattern(p)
    } else if (node.type === 'VariableDeclarator') addPattern(node.id)
    else if (node.type === 'ClassDeclaration' && node.id)
      declared.add(node.id.name)
    else if (node.type === 'CatchClause') addPattern(node.param)
    else if (node.type === 'Identifier') {
      const parent = ancestors[ancestors.length - 2]
      if (!parent) return
      if (
        parent.type === 'MemberExpression' &&
        parent.property === node &&
        !parent.computed
      )
        return
      if (
        (parent.type === 'Property' ||
          parent.type === 'MethodDefinition' ||
          parent.type === 'PropertyDefinition') &&
        parent.key === node &&
        !parent.computed &&
        !(parent.type === 'Property' && parent.shorthand)
      )
        return
      if (
        parent.type === 'LabeledStatement' ||
        parent.type === 'BreakStatement' ||
        parent.type === 'ContinueStatement'
      )
        return
      if (parent.type === 'MetaProperty') return
      read.add(node.name)
    }
  })
  return [...read]
    .filter(
      (n) => !declared.has(n) && !JS_GLOBALS.has(n) && !PAGE_GLOBALS.has(n),
    )
    .sort()
}

export interface BuiltProgram {
  config: Record<string, unknown>
  /** Each function's place in the module, 1-based, or absent if not found. */
  sources: Record<string, { file: string; line: number } | null>
  problems: BuildProblem[]
}

/**
 * Turn a program module's export into the wire's config (pure apart from
 * `toString`). `file` and `text` locate each function in the source.
 */
export function buildProgram(
  program: Record<string, unknown>,
  file: string,
  text: string,
): BuiltProgram {
  const problems: BuildProblem[] = []
  const sources: BuiltProgram['sources'] = {}

  const stringify = (fn: unknown, name: string): string | undefined => {
    if (fn === undefined) return undefined
    if (typeof fn === 'string') return fn
    if (typeof fn !== 'function') {
      problems.push({
        fn: name,
        message: `must be a function, got ${typeof fn}`,
      })
      return undefined
    }
    const raw = fn.toString()
    const src = functionSource(fn as (...a: never[]) => unknown)
    const at = text.indexOf(raw)
    sources[name] =
      at >= 0 ? { file, line: text.slice(0, at).split('\n').length } : null
    let free: string[]
    try {
      free = freeIdentifiers(src)
    } catch (e) {
      problems.push({
        fn: name,
        message: `does not parse as JavaScript the page can run: ${(e as Error).message}`,
      })
      return src
    }
    for (const n of free) {
      problems.push({
        fn: name,
        message: `reads \`${n}\` from outside the function; the string travels without it. Move it inside the function, or put its value in data and read ctx.data.`,
      })
    }
    return src
  }

  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(program)) {
    if ((FUNCTION_KEYS as readonly string[]).includes(key)) {
      const s = stringify(value, key)
      if (s !== undefined) out[key] = s
    } else if (key === 'stack' && Array.isArray(value)) {
      out.stack = value.map((entry: Record<string, unknown>, i: number) => {
        const e: Record<string, unknown> = { ...entry }
        for (const k of FUNCTION_KEYS) {
          if (k in e) {
            const s = stringify(e[k], `stack[${String(entry.id ?? i)}].${k}`)
            if (s !== undefined) e[k] = s
          }
        }
        return e
      })
    } else {
      out[key] = value
    }
  }

  // Data, params and the rest ride as JSON: a function or a class instance
  // in them would vanish on the way.
  for (const key of Object.keys(out)) {
    if ((FUNCTION_KEYS as readonly string[]).includes(key) || key === 'stack')
      continue
    const bad = nonJson(out[key], key)
    if (bad) problems.push({ fn: key, message: bad })
  }
  return { config: out, sources, problems }
}

function nonJson(value: unknown, path: string): string | null {
  if (value === null) return null
  const t = typeof value
  if (t === 'function')
    return `${path} is a function; only the hooks (${FUNCTION_KEYS.join(', ')}) may be`
  if (t === 'number' && !Number.isFinite(value as number))
    return `${path} is ${String(value)}, which JSON cannot carry`
  if (t === 'undefined' || t === 'symbol' || t === 'bigint')
    return `${path} is ${t}, which JSON cannot carry`
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const r = nonJson(value[i], `${path}[${i}]`)
      if (r) return r
    }
    return null
  }
  if (t === 'object') {
    const proto = Object.getPrototypeOf(value)
    if (proto !== Object.prototype && proto !== null)
      return `${path} is a ${proto?.constructor?.name ?? 'class'} instance; use plain objects and arrays`
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const r = nonJson(v, `${path}.${k}`)
      if (r) return r
    }
  }
  return null
}

const BOOLEAN_FLAGS = new Set(['json', 'help'])

export async function cmdBuild(argv: string[]): Promise<number> {
  const { positionals, flags } = parseArgs(argv, BOOLEAN_FLAGS)
  const source = positionals[0]
  if (!source)
    throw new UsageError('vos build <program.mjs> [--out config.json] [--json]')
  const r = createReporter(flags.json === true)
  const file = resolve(source)
  const text = readFileSync(file, 'utf8')
  // A query busts the module cache, so a second build in one process reads
  // the edited file.
  const mod = (await import(`${pathToFileURL(file).href}?t=${Date.now()}`)) as {
    default?: unknown
    program?: unknown
  }
  const program = (mod.default ?? mod.program) as Record<string, unknown>
  if (!program || typeof program !== 'object')
    throw new UsageError(
      `${source} exports no program: \`export default { version: 2, duration, camera, createContent, createTimeline, … }\``,
    )

  const built = buildProgram(program, basename(file), text)
  for (const p of built.problems) r.log(`error ${p.fn}: ${p.message}`)
  if (built.problems.length) {
    r.done(
      { ok: false, problems: built.problems },
      `${source}: ${built.problems.length} problem${built.problems.length === 1 ? '' : 's'}, nothing written`,
    )
    return EXIT_ERROR
  }

  const out = resolve(
    strFlag(flags, 'out') ?? join(dirname(file), 'config.json'),
  )
  writeFileSync(out, JSON.stringify(built.config, null, 2) + '\n')
  const sidecar = out.replace(/\.json$/, '') + '.sources.json'
  writeFileSync(sidecar, JSON.stringify(built.sources, null, 2) + '\n')
  for (const [fn, at] of Object.entries(built.sources)) {
    if (at) r.log(`  ${fn} → ${at.file}:${at.line}`)
  }
  r.done(
    { ok: true, out, sources: sidecar, functions: Object.keys(built.sources) },
    `Wrote ${out} (${Object.keys(built.sources).length} functions; an engine error at fn:N is that function's line N, from the line above)`,
  )
  return EXIT_OK
}
