/**
 * actions.json: the module moved to `@vosjs/render-core/record` (AN4), so
 * vosso's hosted recorder validates a request through the same
 * `validateActions` the CLI runs. This file keeps every name the CLI and
 * its tests import.
 */
export { validateActions } from '@vosjs/render-core/record'
export type { ActionStep, ActionsFile } from '@vosjs/render-core/record'
