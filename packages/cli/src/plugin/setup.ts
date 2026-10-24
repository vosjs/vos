/**
 * `setup` and `teardown` steps: the module moved to `@vosjs/render-core/record` (AN4).
 * This file keeps every name the CLI and its tests import. The CLI's
 * recorder hands `process.env` in for a `{ env }` text; the fleet hands the
 * job's own map.
 */
export {
  SetupEnvError,
  SetupError,
  TEARDOWN_BOUND_MS,
  parseHeaders,
  resolveSetupText,
  runSetup,
  scriptEnvNames,
  setupEnvNames,
  teardownEnvProblem,
  teardownLine,
  validateSetup,
} from '@vosjs/render-core/record'
export type {
  SetupResult,
  SetupStep,
  SetupText,
  StepPhase,
  TeardownReport,
} from '@vosjs/render-core/record'
