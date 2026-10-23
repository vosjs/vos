/**
 * actions.json: the module moved to `@vosjs/render-core/record` (AN4), so
 * vosso's hosted recorder validates a request through the same
 * `validateActions` the CLI runs. This file keeps every name the CLI and
 * its tests import.
 */
import type { ActionsFile } from '@vosjs/render-core/record'

export { validateActions } from '@vosjs/render-core/record'
export type { ActionStep, ActionsFile } from '@vosjs/render-core/record'

/**
 * A `js` check that cannot parse, said before a browser opens: the
 * structural check is host-free (a fleet isolate compiles no code), so the
 * parse is the CLI's. The expression is compiled, never run, as the body
 * the recorder evaluates it in (an async function, so `await` reads).
 */
export function jsSyntaxProblems(
  actions: Pick<ActionsFile, 'steps'>,
): string[] {
  const out: string[] = []
  const AsyncFunction = Object.getPrototypeOf(async function () {})
    .constructor as new (body: string) => unknown
  actions.steps.forEach((s, i) => {
    const js =
      s.do === 'expect' ? s.js : s.do === 'await' ? s.until.js : undefined
    if (typeof js !== 'string') return
    try {
      new AsyncFunction(`return await (${js}\n)`)
    } catch (e) {
      out.push(
        `steps[${i}]: ${s.do === 'await' ? 'await until.js' : 'expect js'} does not parse as an expression (${e instanceof Error ? e.message : String(e)})`,
      )
    }
  })
  return out
}
