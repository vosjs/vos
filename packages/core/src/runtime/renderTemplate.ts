import {
  CDN_ORIGIN,
  dracoDecoderPath,
  gsapUrl,
  threeAddonsPrefix,
  threeUrl,
} from '../addons/cdn'
import { ADDON_REGISTRY } from '../addons/registry'
import { transformModuleCode } from './transformModuleCode'

export interface RenderTemplateOptions {
  mode: 'playback' | 'capture-video' | 'capture-thumbnail'
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
  }
  /** URLs to generate <link rel="modulepreload"> hints for */
  preloadModuleUrls?: string[]
  /** Additional importmap entries (e.g. for external packages) */
  additionalImportmapEntries?: Record<string, string>
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
    elementsBundleCode,
    threeVersion = '0.183.0',
    gsapVersion = '3.12.5',
    capture,
    preloadModuleUrls = [],
    additionalImportmapEntries = {},
  } = options

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
    moduleBody = generatePlaybackBody(elementsBlock)
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

  // Preload hints: preconnect + modulepreload for critical paths
  const preloadHints = [
    `<link rel="preconnect" href="${CDN_ORIGIN}" crossorigin="anonymous">`,
    `<link rel="modulepreload" href="${threeModuleUrl}">`,
    `<link rel="modulepreload" href="${gsapModuleUrl}">`,
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
${preloadHints}
    <script type="importmap">
      ${importmap}
    </script>
    <script>
        window.__THREE_DRACO_PATH__ = '${dracoPath}';
    </script>${globalErrorHandler}
</head>
<body>
    <script type="module">
        import * as THREE from 'three';
        import gsap from 'gsap';

${moduleBody}
    </script>
</body>
</html>`
}

// ---------------------------------------------------------------------------
// Mode: playback
// ---------------------------------------------------------------------------

function generatePlaybackBody(elementsBlock: string): string {
  return `${elementsBlock}

        // Helper to load the user module dynamically
        const loadUserModule = async (blobUrl) => {
            try {
                const module = await import(blobUrl);
                if (!module.initVos) {
                    throw new Error("User module must export 'initVos' function.");
                }
                return module.initVos;
            } catch (err) {
                console.error("Failed to load user module:", err);
                throw err;
            }
        };

        const main = async () => {
            // Create resolution config for playback
            const width = window.innerWidth;
            const height = window.innerHeight;
            // Quality override allows lower resolution for performance
            const pixelRatio = window.__vos__?.qualityOverride ?? Math.min(window.devicePixelRatio ?? 1, 2);
            const drawingBufferWidth = Math.floor(width * pixelRatio);
            const drawingBufferHeight = Math.floor(height * pixelRatio);

            const deps = {
                THREE,
                gsap,
                resolution: { width, height, pixelRatio, drawingBufferWidth, drawingBufferHeight }
            };

            try {
                if (!window.USER_CODE_BLOB_URL) {
                    throw new Error("USER_CODE_BLOB_URL not defined.");
                }

                const initVos = await loadUserModule(window.USER_CODE_BLOB_URL);
                const result = await initVos(document.body, deps);

                window.$fx = result; // Expose to the bridge

                if (!window.$fx_controlled) {
                     if (result.timeline) result.timeline.play();
                }

            } catch(e) { console.error(e); }
        };

        main();`
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

  // Format-specific configuration
  const isMp4 = format === 'mp4'
  const formatSetup = isMp4
    ? `const { Output, CanvasSource, BufferTarget, Mp4OutputFormat, QUALITY_HIGH } = await import('mediabunny');
            const output = new Output({
              format: new Mp4OutputFormat(),
              target: new BufferTarget(),
            });
            const videoSource = new CanvasSource(canvas, {
              codec: 'avc',
              bitrate: QUALITY_HIGH,
            });`
    : `const { Output, CanvasSource, BufferTarget, WebMOutputFormat, QUALITY_HIGH } = await import('mediabunny');
            const output = new Output({
              format: new WebMOutputFormat(),
              target: new BufferTarget(),
            });
            const videoSource = new CanvasSource(canvas, {
              codec: 'vp9',
              bitrate: QUALITY_HIGH,
            });`
  const mimeType = isMp4 ? 'video/mp4' : 'video/webm'

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

            const totalFrames = Math.ceil(${duration} * ${fps});

            for (let frame = 0; frame < totalFrames; frame++) {
              const time = frame / ${fps};
              timeline.seek(time, false);
              await new Promise(r => requestAnimationFrame(r));
              if (gl) gl.finish();

              await videoSource.add(time, 1 / ${fps});
            }

            await output.finalize();

            const buffer = output.target.buffer;
            if (!buffer) {
              throw new Error('Export failed: output buffer is null');
            }

            // Convert to base64
            const bytes = new Uint8Array(buffer);
            let binary = '';
            for (let i = 0; i < bytes.length; i++) {
              binary += String.fromCharCode(bytes[i]);
            }
            const base64Data = 'data:${mimeType};base64,' + btoa(binary);

            // Cleanup
            if (cleanup) cleanup();

            // Signal completion
            window.__renderComplete = {
              success: true,
              data: base64Data,
              size: bytes.length
            };

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
