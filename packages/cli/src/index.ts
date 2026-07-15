/**
 * @vosjs/cli — programmatic surface.
 *
 * The same rendering core the `vos` bin uses, exposed as functions so other
 * tools (scripts, servers, MCP wrappers) can render without shelling out.
 */
export { renderVideo, renderStill, previewPages } from './render'
export type {
  RenderVideoOptions,
  RenderStillOptions,
  RenderResult,
} from './render'
export { loadVosConfig, configDuration } from './loadConfig'
export type { LoadedConfig } from './loadConfig'
export { launchBrowser, BrowserUnavailableError } from './browser'
