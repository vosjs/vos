import {
  CDN_ORIGIN,
  dracoDecoderPath,
  gsapUrl,
  threeAddonsPrefix,
  threeUrl,
} from '../addons/cdn'
import { ADDON_REGISTRY } from '../addons/registry'
import { VOS_BRIDGE_PROTOCOL } from './bridge'
import { transformModuleCode } from './transformModuleCode'

export interface RenderTemplateOptions {
  mode: 'playback' | 'capture-video' | 'capture-thumbnail'
  /**
   * Enable the editor-mode bridge extension (playback mode only): element
   * hit-testing (`HIT_TEST`), bounds queries (`GET_ELEMENT_RECTS`) and ephemeral
   * property overrides (`SET_ELEMENT_PROPS`). Off by default so the production
   * player carries none of it. See `runtime/bridge.ts` for the protocol.
   */
  editor?: boolean
  /** IIFE string for Elements System (from @vosjs/elements/bundle) */
  elementsBundleCode?: string
  /** Three.js CDN version (default '0.183.0') */
  threeVersion?: string
  /** GSAP CDN version (default '3.12.5') */
  gsapVersion?: string
  /** Required for capture-* modes */
  capture?: {
    width: number
    height: number
    duration: number
    fps: number
    /** Seek time for thumbnail capture (default 0.5s) */
    thumbnailTime?: number
    /** Output format for capture-video mode (default 'webm') */
    format?: 'webm' | 'mp4'
    /**
     * Capture only frames `[startFrame, endFrame)` of the composition
     * (capture-video mode). The output file is an independent segment: it
     * starts on a keyframe and its timestamps begin at 0, so a host can
     * render disjoint ranges (distributed or resumable rendering) and
     * concatenate the segments externally. Defaults to the full
     * `[0, ceil(duration * fps))`. Frames are still *evaluated* at their
     * global composition time — only the output timestamps are local.
     */
    range?: { startFrame: number; endFrame: number }
    /**
     * Explicit encoder settings (capture-video mode). When omitted, the
     * format defaults apply (`avc` for mp4, `vp9` for webm, QUALITY_HIGH
     * bitrate). Range-based workflows should pin these so every segment of
     * one render shares a single encoder configuration.
     */
    encoder?: {
      codec?: 'avc' | 'hevc' | 'vp8' | 'vp9' | 'av1'
      /** Bits per second (default: mediabunny's QUALITY_HIGH). */
      bitrate?: number
    }
    /**
     * PUT the finished capture bytes to this URL instead of embedding them
     * as base64 in `__renderComplete.data` (capture-video mode). On success
     * `__renderComplete` is `{ success: true, uploaded: true, size }`; if
     * the upload fails the bytes are embedded as usual with an `uploadError`
     * field, so the render is never lost. Avoids marshalling large outputs
     * through strings.
     */
    uploadUrl?: string
  }
  /** URLs to generate <link rel="modulepreload"> hints for */
  preloadModuleUrls?: string[]
  /** Additional importmap entries (e.g. for external packages) */
  additionalImportmapEntries?: Record<string, string>
  /**
   * Which tween backend supplies `deps.gsap` (default 'gsap').
   *
   * - `'gsap'`: real GSAP via the CDN importmap — current behavior.
   * - `'vos'`: the deterministic @vosjs/tween recorder/sampler; requires
   *   `tweenBundleCode`. No GSAP is imported by the template. The `gsap`
   *   importmap entry is still emitted so legacy compiled artifacts that
   *   `import gsap from 'gsap'` keep resolving (their `ctx.gsap` still comes
   *   from deps, so they run on the vos backend regardless).
   */
  tweenEngine?: 'gsap' | 'vos'
  /** IIFE string for the vos tween runtime (from @vosjs/tween/bundle) */
  tweenBundleCode?: string
}

/**
 * Generate a unified HTML template for vos animation rendering.
 *
 * - `playback`: Browser iframe player. Code loaded via blob URL.
 * - `capture-video`: Server-side deterministic video capture via mediabunny (WebCodecs).
 * - `capture-thumbnail`: Server-side single-frame capture to WebP.
 */
export function generateRenderTemplate(
  animationCode: string,
  options: RenderTemplateOptions,
): string {
  const {
    mode,
    editor = false,
    elementsBundleCode,
    threeVersion = '0.183.0',
    gsapVersion = '3.12.5',
    capture,
    preloadModuleUrls = [],
    additionalImportmapEntries = {},
    tweenEngine = 'gsap',
    tweenBundleCode,
  } = options

  if (tweenEngine === 'vos' && !tweenBundleCode) {
    throw new Error(
      "tweenEngine 'vos' requires tweenBundleCode (import { tweenRuntimeCode } from '@vosjs/tween/bundle')",
    )
  }

  const isCapture = mode === 'capture-video' || mode === 'capture-thumbnail'

  // Build importmap entries
  const threeModuleUrl = threeUrl(threeVersion)
  const gsapModuleUrl = gsapUrl(gsapVersion)
  const importmapEntries: Record<string, string> = {
    three: threeModuleUrl,
    'three/addons/': threeAddonsPrefix(threeVersion),
    gsap: gsapModuleUrl,
  }

  // Include all registered external packages in importmap.
  // Unused entries have zero cost — no HTTP requests until actually imported.
  for (const entry of Object.values(ADDON_REGISTRY)) {
    if (
      entry.category === 'external' &&
      entry.importSpecifier &&
      entry.cdnUrl
    ) {
      importmapEntries[entry.importSpecifier] = entry.cdnUrl(threeVersion)
    }
  }

  // Merge any caller-provided entries (overrides registry defaults)
  Object.assign(importmapEntries, additionalImportmapEntries)

  if (mode === 'capture-video') {
    importmapEntries['mediabunny'] = 'https://esm.sh/mediabunny@1.27.3'
  }

  const importmap = JSON.stringify({ imports: importmapEntries }, null, 6)

  // Styles differ slightly between playback (viewport-filling) and capture (fixed size)
  const styles = isCapture
    ? `* { margin: 0; padding: 0; box-sizing: border-box; }
        body { width: ${capture!.width}px; height: ${capture!.height}px; overflow: hidden; background: #000; }
        canvas { display: block; }`
    : `body { margin: 0; overflow: hidden; background: #000; }
        canvas { display: block; width: 100vw; height: 100vh; }`

  // Elements System injection
  const elementsBlock = elementsBundleCode
    ? `
        // Vos Element System (bundled IIFE)
        ${elementsBundleCode}
        window.__vos__ = window.__vos__ || {};
        window.__vos__.elements = __vosElementsFactory.createVosElements(THREE);`
    : `window.__vos__ = window.__vos__ || {};`

  // Mode-specific module body
  let moduleBody: string
  if (mode === 'playback') {
    moduleBody = generatePlaybackBody(elementsBlock, editor)
  } else if (mode === 'capture-video') {
    moduleBody = generateCaptureVideoBody(
      animationCode,
      capture!,
      elementsBlock,
    )
  } else {
    moduleBody = generateCaptureThumbnailBody(
      animationCode,
      capture!,
      elementsBlock,
    )
  }

  // For capture modes, add a global error handler so __renderComplete is
  // always set — even if CDN imports fail or the module script throws at
  // the top level (outside the per-mode try/catch).
  const globalErrorHandler = isCapture
    ? `
    <script>
        window.addEventListener('error', function(e) {
            if (!window.__renderComplete) {
                window.__renderComplete = { success: false, error: 'Global error: ' + (e.message || String(e)) };
            }
        });
        window.addEventListener('unhandledrejection', function(e) {
            if (!window.__renderComplete) {
                window.__renderComplete = { success: false, error: 'Unhandled rejection: ' + (e.reason?.message || String(e.reason)) };
            }
        });
    </script>`
    : ''

  // Preload hints: preconnect + modulepreload for critical paths. The gsap
  // preload is skipped on the vos backend (the importmap entry stays for
  // legacy artifacts, but nothing fetches it up front).
  // modulepreload MUST come after the importmap script: a modulepreload seen
  // first counts as module activity and makes Chromium <133 reject the map
  // ("Failed to resolve module specifier" on every bare import). Only the
  // preconnect may precede the map.
  const preconnectHint = `    <link rel="preconnect" href="${CDN_ORIGIN}" crossorigin="anonymous">`
  const preloadHints = [
    `<link rel="modulepreload" href="${threeModuleUrl}">`,
    ...(tweenEngine === 'gsap'
      ? [`<link rel="modulepreload" href="${gsapModuleUrl}">`]
      : []),
    ...preloadModuleUrls.map(
      (url) => `<link rel="modulepreload" href="${url}">`,
    ),
  ]
    .map((h) => `    ${h}`)
    .join('\n')

  const dracoPath = dracoDecoderPath(threeVersion)

  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        ${styles}
    </style>
${preconnectHint}
    <script type="importmap">
      ${importmap}
    </script>
${preloadHints}
    <script>
        window.__THREE_DRACO_PATH__ = '${dracoPath}';
    </script>${globalErrorHandler}
</head>
<body>
    <script type="module">
        import * as THREE from 'three';
${
  tweenEngine === 'gsap'
    ? `        import gsap from 'gsap';
        const __gsapDep = () => gsap;`
    : `        // vos tween backend: deps.gsap is a deterministic recorder facade
        // (@vosjs/tween) — no GSAP import. Fresh recorder per LOAD.
        ${tweenBundleCode}
        const __gsapDep = () => globalThis.__vosTween.createTweenRecorder();
        const gsap = __gsapDep();`
}

${moduleBody}
    </script>
</body>
</html>`
}

// ---------------------------------------------------------------------------
// Mode: playback
// ---------------------------------------------------------------------------

// The consolidated playback bridge: the single host<->iframe protocol, owned by the
// engine (previously a host-side script that could drift from the engine). The document
// boots EMPTY and waits for a LOAD message carrying the user program (+ data). This lets
// the host edit without reloading the document. Typed contract: see ./bridge.ts
// (VosBridgeCommand / VosBridgeEvent, protocol v${VOS_BRIDGE_PROTOCOL}).
//   - LOAD     { code | url, data?, autoplay? } -> warm program swap, preserving transport
//   - SET_DATA { data }                         -> live ctx.data swap (no re-init)
//   - PLAY / PAUSE / SEEK { value } / SEEK_TIME { value } / PLAY_SPEED { value }
//   - SET_DURATION { value }                    -> retime (only if program supports it)
//   - editor mode: GET_ELEMENT_RECTS / HIT_TEST / SET_ELEMENT_PROPS (ephemeral)
// Backward compatible: if window.USER_CODE_BLOB_URL is baked (legacy), it auto-loads.
function generatePlaybackBody(elementsBlock: string, editor: boolean): string {
  return `${elementsBlock}

        window.$fx_controlled = true;

        const __post = (msg) => { try { window.parent.postMessage(msg, '*'); } catch (e) {} };

        const __deps = () => {
            const width = window.innerWidth;
            const height = window.innerHeight;
            // Quality override allows lower resolution for performance
            const pixelRatio = window.__vos__?.qualityOverride ?? Math.min(window.devicePixelRatio ?? 1, 2);
            return {
                THREE,
                gsap: __gsapDep(),
                resolution: {
                    width, height, pixelRatio,
                    drawingBufferWidth: Math.floor(width * pixelRatio),
                    drawingBufferHeight: Math.floor(height * pixelRatio),
                },
            };
        };

        const __finiteDuration = (tl) => {
            if (!tl) return 0;
            let d = tl.duration();
            if (!isFinite(d) || d <= 0) d = tl.totalDuration();
            if (!isFinite(d) || d <= 0) d = 0;
            return d;
        };

        // Accept a module given as code string, blob: URL, http(s) URL, or data: URL.
        const __importModule = async (codeOrUrl) => {
            let url = codeOrUrl;
            let revoke = false;
            if (typeof codeOrUrl === 'string' &&
                codeOrUrl.indexOf('blob:') !== 0 &&
                codeOrUrl.indexOf('http') !== 0 &&
                codeOrUrl.indexOf('data:') !== 0) {
                url = URL.createObjectURL(new Blob([codeOrUrl], { type: 'text/javascript' }));
                revoke = true;
            }
            try {
                const mod = await import(url);
                if (!mod.initVos) throw new Error("User module must export 'initVos' function.");
                return mod.initVos;
            } finally {
                if (revoke) setTimeout(() => { try { URL.revokeObjectURL(url); } catch (e) {} }, 0);
            }
        };

        let __epoch = 0;        // guards against stale async work after a newer LOAD
        let __current = null;   // current VosResult
        let __data = null;      // last applied ctx.data

        const __attachProgress = (tl, myEpoch) => {
            if (!tl) return;
            const existing = tl.eventCallback('onUpdate');
            tl.eventCallback('onUpdate', () => {
                if (existing) existing();
                if (myEpoch !== __epoch) return;
                // Seconds are the transport currency; progress kept for legacy hosts.
                __post({ type: 'UPDATE', progress: tl.progress(), time: tl.time(), duration: __finiteDuration(tl) });
            });
        };

        // Warm load / swap. Preserves transport (playhead, playing, rate) across swaps so
        // editing the program does not flash or replay from 0.
        const __load = async (payload) => {
            const myEpoch = ++__epoch;

            // snapshot transport from the outgoing instance
            let prev = null;
            if (__current && __current.timeline) {
                const tl = __current.timeline;
                prev = { time: tl.time(), paused: tl.paused(), rate: tl.timeScale() };
            }
            if (__current && __current.cleanup) { try { __current.cleanup(); } catch (e) {} }
            __current = null;

            const data = (payload && payload.data != null) ? payload.data : __data;
            __data = data;

            let initVos;
            try {
                initVos = await __importModule(payload.code != null ? payload.code : payload.url);
            } catch (e) { __post({ type: 'ERROR', error: String((e && e.message) || e) }); return; }
            if (myEpoch !== __epoch) return;

            const deps = __deps();
            if (data != null) deps.data = data;

            let result;
            try {
                result = await initVos(document.body, deps);
            } catch (e) { __post({ type: 'ERROR', error: String((e && e.message) || e) }); return; }
            if (myEpoch !== __epoch) { try { result.cleanup && result.cleanup(); } catch (e) {} return; }

            __current = result;
            window.$fx = result;

            if (result.assetsReady && typeof result.assetsReady.then === 'function') {
                try { await result.assetsReady; } catch (e) {}
                if (myEpoch !== __epoch) return;
            }

            const tl = result.timeline;
            if (tl) tl.pause();
            __attachProgress(tl, myEpoch);
            __post({ type: 'READY', duration: __finiteDuration(tl), canSetDuration: !!result.setDuration });

            if (tl) {
                if (prev) {
                    // warm swap: restore where the user was
                    tl.timeScale(prev.rate);
                    const dur = __finiteDuration(tl);
                    tl.seek(dur > 0 ? Math.min(prev.time, dur) : 0, false);
                    if (!prev.paused) tl.play();
                } else if (payload && payload.autoplay) {
                    tl.play();
                }
            }
        };

        window.addEventListener('message', (e) => {
            const msg = e.data || {};
            switch (msg.type) {
                case 'LOAD': __load(msg); break;
                case 'SET_DATA':
                    __data = msg.data;
                    if (__current && __current.setData) __current.setData(msg.data);
                    break;
                case 'PLAY':
                    if (window.__vos__?.setGlobalPaused) window.__vos__.setGlobalPaused(false);
                    if (__current && __current.timeline) __current.timeline.play();
                    break;
                case 'PAUSE':
                    if (window.__vos__?.setGlobalPaused) window.__vos__.setGlobalPaused(true);
                    if (__current && __current.timeline) __current.timeline.pause();
                    break;
                case 'SEEK':
                    if (window.__vos__?.setGlobalPaused) window.__vos__.setGlobalPaused(true);
                    if (__current && __current.timeline) __current.timeline.progress(msg.value);
                    break;
                case 'SEEK_TIME': {
                    if (window.__vos__?.setGlobalPaused) window.__vos__.setGlobalPaused(true);
                    const tl = __current && __current.timeline;
                    if (tl) {
                        const dur = __finiteDuration(tl);
                        tl.seek(Math.max(0, Math.min(Number(msg.value) || 0, dur)), false);
                    }
                    break;
                }
                case 'PLAY_SPEED':
                    if (__current && __current.timeline) __current.timeline.timeScale(msg.value);
                    break;
                case 'SET_DURATION': {
                    if (__current && __current.setDuration) {
                        __current.setDuration(msg.value);
                        const tl = __current.timeline;
                        if (tl) __post({ type: 'UPDATE', progress: tl.progress(), time: tl.time(), duration: __finiteDuration(tl) });
                    }
                    break;
                }${editorMessageCases(editor)}
            }
        });
${editorExtension(editor)}
        // Legacy boot: code baked via window.USER_CODE_BLOB_URL auto-loads (+autoplays,
        // matching the previous standalone behavior). New hosts send a LOAD message.
        if (window.USER_CODE_BLOB_URL) {
            __load({ url: window.USER_CODE_BLOB_URL, autoplay: true });
        }
        __post({ type: 'BRIDGE_READY', protocol: ${VOS_BRIDGE_PROTOCOL}, editor: ${editor} });`
}

// ---------------------------------------------------------------------------
// Editor-mode bridge extension (playback + { editor: true } only)
//
// Element picking and ephemeral property overrides for host-side editors:
// selection chrome lives in the HOST's DOM (crisper, easier to style); the
// player only answers geometry questions and previews prop gestures. Durable
// element edits are config/document patches committed by the host (T3).
// ---------------------------------------------------------------------------

function editorMessageCases(editor: boolean): string {
  if (!editor) return ''
  return `
                case 'GET_ELEMENT_RECTS':
                    __post({ type: 'ELEMENT_RECTS', requestId: msg.requestId ?? null, rects: __editorApi.getRects() });
                    break;
                case 'HIT_TEST':
                    __post({ type: 'HIT_RESULT', requestId: msg.requestId ?? null, id: __editorApi.hitTest(msg.x, msg.y) });
                    break;
                case 'SET_ELEMENT_PROPS':
                    __editorApi.setProps(msg.id, msg.props);
                    break;`
}

function editorExtension(editor: boolean): string {
  if (!editor) return ''
  return `
        const __editorApi = (() => {
            const raycaster = new THREE.Raycaster();
            const ndc = new THREE.Vector2();
            const v3 = new THREE.Vector3();

            const canvasRect = () => {
                const canvas = document.querySelector('canvas');
                return canvas ? canvas.getBoundingClientRect()
                    : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
            };

            // Element instances of the running program: [{ id, inst, order }] in
            // config order (Map preserves insertion order).
            const instances = () => {
                const out = [];
                if (__current && __current.elements) {
                    let order = 0;
                    __current.elements.forEach((inst, id) => {
                        if (inst && inst.mesh) out.push({ id, inst, order: order++ });
                    });
                }
                return out;
            };

            // Project a mesh's local bounding box through the overlay camera into
            // viewport CSS px. Corner projection is robust to animated transforms
            // (scale/rotation via the props proxy) — no pixel-space assumptions.
            const meshRect = (mesh, cam, rect) => {
                if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
                const bb = mesh.geometry.boundingBox;
                mesh.updateWorldMatrix(true, false);
                let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                for (let ci = 0; ci < 8; ci++) {
                    v3.set(ci & 1 ? bb.max.x : bb.min.x, ci & 2 ? bb.max.y : bb.min.y, ci & 4 ? bb.max.z : bb.min.z);
                    v3.applyMatrix4(mesh.matrixWorld).project(cam);
                    const px = rect.left + ((v3.x + 1) / 2) * rect.width;
                    const py = rect.top + ((1 - v3.y) / 2) * rect.height;
                    if (px < minX) minX = px; if (px > maxX) maxX = px;
                    if (py < minY) minY = py; if (py > maxY) maxY = py;
                }
                return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
            };

            const getRects = () => {
                const cam = __current && __current.overlayCamera;
                if (!cam) return [];
                cam.updateMatrixWorld();
                const rect = canvasRect();
                return instances().map(({ id, inst }) => ({
                    id,
                    ...meshRect(inst.mesh, cam, rect),
                    visible: inst.mesh.visible !== false,
                }));
            };

            const hitTest = (x, y) => {
                const cam = __current && __current.overlayCamera;
                if (!cam) return null;
                cam.updateMatrixWorld();
                const rect = canvasRect();
                ndc.set(((x - rect.left) / rect.width) * 2 - 1, -(((y - rect.top) / rect.height) * 2 - 1));
                raycaster.setFromCamera(ndc, cam);
                const byMesh = new Map();
                const meshes = [];
                for (const { id, inst, order } of instances()) {
                    if (inst.mesh.visible === false) continue;
                    byMesh.set(inst.mesh, { id, z: (inst.config && inst.config.zIndex) ?? 100, order });
                    meshes.push(inst.mesh);
                }
                // Topmost wins: overlay groups render in ascending zIndex with depth
                // cleared between groups, so pick by (zIndex, config order) — ray
                // distance is meaningless across cleared depth.
                let best = null;
                for (const hit of raycaster.intersectObjects(meshes, false)) {
                    const m = byMesh.get(hit.object);
                    if (m && (!best || m.z > best.z || (m.z === best.z && m.order > best.order))) best = m;
                }
                return best ? best.id : null;
            };

            // Ephemeral gesture preview via the element props proxy. Does NOT
            // survive a LOAD — the durable edit is the host's config patch.
            const setProps = (id, props) => {
                const inst = __current && __current.elements && __current.elements.get(id);
                if (inst && inst.props && props) Object.assign(inst.props, props);
            };

            window.addEventListener('resize', () => {
                __post({ type: 'ELEMENT_RECTS', requestId: null, rects: getRects() });
            });

            return { getRects, hitTest, setProps };
        })();`
}

// ---------------------------------------------------------------------------
// Mode: capture-video (deterministic via mediabunny)
// Uses mediabunny's CanvasSource for frame-by-frame WebCodecs encoding,
// matching the same pattern as the client-side videoExport.ts.
// Requires secure context (https:// origin) for WebCodecs APIs.
// The server achieves this via page.route() + page.goto('https://...').
// ---------------------------------------------------------------------------

function generateCaptureVideoBody(
  animationCode: string,
  capture: NonNullable<RenderTemplateOptions['capture']>,
  elementsBlock: string,
): string {
  const { width, height, duration, fps, format = 'webm' } = capture
  const transformedCode = transformModuleCode(animationCode, 'server')

  const totalFrames = Math.ceil(duration * fps)
  const startFrame = capture.range?.startFrame ?? 0
  const endFrame = capture.range?.endFrame ?? totalFrames
  if (capture.range) {
    if (
      !Number.isInteger(startFrame) ||
      !Number.isInteger(endFrame) ||
      startFrame < 0 ||
      endFrame <= startFrame ||
      endFrame > totalFrames
    ) {
      throw new Error(
        `capture.range must satisfy 0 <= startFrame < endFrame <= ${totalFrames} ` +
          `(ceil(duration * fps)); got [${startFrame}, ${endFrame})`,
      )
    }
  }

  // Format-specific configuration. Encoder settings may be pinned explicitly
  // so multi-segment renders share one configuration.
  const isMp4 = format === 'mp4'
  const codec = capture.encoder?.codec ?? (isMp4 ? 'avc' : 'vp9')
  const bitrate =
    capture.encoder?.bitrate !== undefined
      ? String(capture.encoder.bitrate)
      : 'QUALITY_HIGH'
  const formatSetup = `const { Output, CanvasSource, BufferTarget, ${isMp4 ? 'Mp4OutputFormat' : 'WebMOutputFormat'}, QUALITY_HIGH } = await import('mediabunny');
            const output = new Output({
              format: new ${isMp4 ? 'Mp4OutputFormat' : 'WebMOutputFormat'}(),
              target: new BufferTarget(),
            });
            const videoSource = new CanvasSource(canvas, {
              codec: ${JSON.stringify(codec)},
              bitrate: ${bitrate},
            });`
  const mimeType = isMp4 ? 'video/mp4' : 'video/webm'

  return `
        // Make THREE and gsap available globally for animation code
        window.THREE = THREE;
        window.gsap = gsap;

${elementsBlock}

        // Deterministic capture: compositions must SEEK their videos, never
        // play them (same contract as the client-side exporter).
        window.__vos__.isPaused = true;

        // Override window dimensions
        Object.defineProperty(window, 'innerWidth', { value: ${width}, configurable: true });
        Object.defineProperty(window, 'innerHeight', { value: ${height}, configurable: true });

        // Animation code (transformed) — await the async IIFE so initVos is ready
        try {
          await ${transformedCode}
        } catch (codeError) {
          console.error('Animation code error:', codeError);
          window.__renderComplete = { success: false, error: 'Animation code error: ' + codeError.message };
        }

        // Main capture function
        async function main() {
          try {
            const deps = {
              THREE,
              gsap,
              resolution: {
                width: ${width},
                height: ${height},
                pixelRatio: 1,
                drawingBufferWidth: ${width},
                drawingBufferHeight: ${height}
              }
            };

            // Initialize animation
            const initFn = window.initVos || window.initAnimation;
            if (!initFn) {
              throw new Error('Animation must export initVos or initAnimation');
            }

            const result = await initFn(document.body, deps);
            if (result.assetsReady) await result.assetsReady;
            const { timeline, cleanup } = result;

            // Pause initially
            timeline.pause();
            timeline.seek(0, false);

            // Find canvas
            const canvas = document.querySelector('canvas');
            if (!canvas) {
              throw new Error('No canvas found');
            }

            // Set exact dimensions
            canvas.width = ${width};
            canvas.height = ${height};
            canvas.style.width = '${width}px';
            canvas.style.height = '${height}px';

            const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');

            // Setup mediabunny output
            ${formatSetup}

            output.addVideoTrack(videoSource, { frameRate: ${fps} });
            await output.start();

            // Frames [startFrame, endFrame) — evaluated at global composition
            // time, captured with segment-local timestamps (the file starts
            // at t=0 regardless of where the range sits on the timeline).
            const startFrame = ${startFrame};
            const endFrame = ${endFrame};
            const wvr = () => (window.__vos__.waitForVideosReady ? window.__vos__.waitForVideosReady() : null);
            const pendingDecodes = () => (window.__vos__.pendingDecodes ? window.__vos__.pendingDecodes.size : 0);

            for (let frame = startFrame; frame < endFrame; frame++) {
              const time = frame / ${fps};
              timeline.seek(time, false);
              // Two-phase video settle (same as the client exporter): wait for
              // seeked decodes, render, then re-check decodes the render
              // itself triggered.
              await wvr();
              await new Promise(r => requestAnimationFrame(r));
              if (pendingDecodes() > 0) {
                await wvr();
                await new Promise(r => requestAnimationFrame(r));
              }
              if (gl) gl.finish();

              await videoSource.add((frame - startFrame) / ${fps}, 1 / ${fps});
              window.__renderProgress = { framesDone: frame - startFrame + 1, totalFrames: endFrame - startFrame };
            }

            await output.finalize();

            const buffer = output.target.buffer;
            if (!buffer) {
              throw new Error('Export failed: output buffer is null');
            }

            // Cleanup before the (potentially slow) result handoff
            if (cleanup) cleanup();

            const uploadUrl = ${JSON.stringify(capture.uploadUrl ?? null)};
            let uploadError = null;
            if (uploadUrl) {
              try {
                const res = await fetch(uploadUrl, {
                  method: 'PUT',
                  headers: { 'Content-Type': '${mimeType}' },
                  body: buffer,
                });
                if (!res.ok) throw new Error('HTTP ' + res.status);
                window.__renderComplete = { success: true, uploaded: true, size: buffer.byteLength };
                return;
              } catch (e) {
                // Fall back to embedding so the render is never lost; the
                // host reads uploadError and decides.
                uploadError = String((e && e.message) || e);
              }
            }

            // Convert to base64
            const bytes = new Uint8Array(buffer);
            let binary = '';
            for (let i = 0; i < bytes.length; i++) {
              binary += String.fromCharCode(bytes[i]);
            }
            const base64Data = 'data:${mimeType};base64,' + btoa(binary);

            // Signal completion (built fully before assignment — hosts poll
            // __renderComplete and must never observe a half-written result)
            const complete = {
              success: true,
              data: base64Data,
              size: bytes.length
            };
            if (uploadError) complete.uploadError = uploadError;
            window.__renderComplete = complete;

          } catch (error) {
            console.error('Render error:', error);
            window.__renderComplete = {
              success: false,
              error: error.message
            };
          }
        }

        // Only run main if animation code loaded successfully
        if (!window.__renderComplete) main();`
}

// ---------------------------------------------------------------------------
// Mode: capture-thumbnail (single frame to WebP)
// ---------------------------------------------------------------------------

function generateCaptureThumbnailBody(
  animationCode: string,
  capture: NonNullable<RenderTemplateOptions['capture']>,
  elementsBlock: string,
): string {
  const { width, height } = capture
  const thumbnailTime = capture.thumbnailTime ?? 0.5
  const transformedCode = transformModuleCode(animationCode, 'server')

  return `
        // Make THREE and gsap available globally for animation code
        window.THREE = THREE;
        window.gsap = gsap;

${elementsBlock}

        // Override window dimensions
        Object.defineProperty(window, 'innerWidth', { value: ${width}, configurable: true });
        Object.defineProperty(window, 'innerHeight', { value: ${height}, configurable: true });

        // Animation code (transformed) — await the async IIFE so initVos is ready
        try {
          await ${transformedCode}
        } catch (codeError) {
          console.error('Animation code error:', codeError);
          window.__renderComplete = { success: false, error: 'Animation code error: ' + codeError.message };
        }

        // Main thumbnail capture function
        async function main() {
          try {
            const deps = {
              THREE,
              gsap,
              resolution: {
                width: ${width},
                height: ${height},
                pixelRatio: 1,
                drawingBufferWidth: ${width},
                drawingBufferHeight: ${height}
              }
            };

            // Initialize animation
            const initFn = window.initVos || window.initAnimation;
            if (!initFn) {
              throw new Error('Animation must export initVos or initAnimation');
            }

            const result = await initFn(document.body, deps);
            if (result.assetsReady) await result.assetsReady;
            const { timeline, cleanup } = result;

            // Seek to thumbnail time
            timeline.pause();
            timeline.seek(${thumbnailTime}, false);

            // Wait for render
            await new Promise(r => requestAnimationFrame(r));

            // Find canvas and ensure GPU is done
            const canvas = document.querySelector('canvas');
            if (!canvas) {
              throw new Error('No canvas found');
            }

            const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
            if (gl) gl.finish();

            // Capture as WebP
            const dataUrl = canvas.toDataURL('image/webp', 0.85);

            // Cleanup
            if (cleanup) cleanup();

            // Signal completion
            window.__renderComplete = {
              success: true,
              data: dataUrl
            };

          } catch (error) {
            console.error('Thumbnail error:', error);
            window.__renderComplete = {
              success: false,
              error: error.message
            };
          }
        }

        // Only run main if animation code loaded successfully
        if (!window.__renderComplete) main();`
}
