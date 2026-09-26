/**
 * `setup` steps: the module moved to `@vosjs/render-core/record` (AN4).
 * This file keeps every name the CLI and its tests import. The CLI's
 * recorder hands `process.env` in for a `{ env }` text; the fleet hands the
 * job's own map.
 */
export {
  SetupEnvError,
  SetupError,
  parseHeaders,
  resolveSetupText,
  runSetup,
  setupEnvNames,
  validateSetup,
} from '@vosjs/render-core/record'
export type {
  SetupResult,
  SetupStep,
  SetupText,
} from '@vosjs/render-core/record'
