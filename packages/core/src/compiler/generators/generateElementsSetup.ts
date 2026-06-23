/**
 * Generate elements setup code for the animation template.
 *
 * The actual element rendering logic lives in the elements module
 * (apps/web/src/lib/vos/elements/), bundled via esbuild and injected
 * into the master template as window.__vos__.elements.
 */

/**
 * Generate elements setup code
 */
export function generateElementsSetup(config: any): string {
  const elements = config.elements
  if (!elements || elements.length === 0) {
    return `
  // No elements defined - create empty overlay layer
  const overlayScene = new THREE.Scene();
  const overlayCamera = new THREE.OrthographicCamera(-width/2, width/2, height/2, -height/2, -1000, 1000);
  const renderGroups = [
    { type: '3d', zIndex: 0, scene: scene },
    { type: '2d', zIndex: 100, scene: overlayScene },
  ];
  const elements = new Map();
`
  }

  // Serialize elements config
  const elementsJson = JSON.stringify(elements, null, 2).replace(/\n/g, '\n  ')

  return `
  // Initialize __vos__ namespace for video sync
  window.__vos__ = window.__vos__ || {};
  window.__vos__.videoCallbacks = window.__vos__.videoCallbacks || new Set();
  window.__vos__.isPaused = true;

  window.__vos__.setGlobalPaused = (paused) => {
    window.__vos__.isPaused = paused;
    window.__vos__.videoCallbacks.forEach(cb => cb());
  };

  window.__vos__.waitForVideosReady = async () => {
    if (!window.__vos__?.elements) return;
    // Video readiness is handled by the element system's asset cache
  };

  // 2D Overlay Layer — build per-zIndex overlay scenes
  const overlayCamera = new THREE.OrthographicCamera(
    -width / 2, width / 2, height / 2, -height / 2, -1000, 1000
  );

  // Elements config
  const elementsConfig = ${elementsJson};

  // Build overlay scenes keyed by unique zIndex
  const elementZIndices = [...new Set(elementsConfig.map(e => e.zIndex ?? 100))].sort((a, b) => a - b);
  const overlayScenes = {};
  for (const z of elementZIndices) {
    overlayScenes[z] = new THREE.Scene();
  }

  // Render groups: 3D first, then 2D groups in zIndex order
  const renderGroups = [
    { type: '3d', zIndex: 0, scene: scene },
    ...elementZIndices.map(z => ({ type: '2d', zIndex: z, scene: overlayScenes[z] })),
  ];

  // Backward-compat alias
  const overlayScene = overlayScenes[elementZIndices[0]];

  // Render elements via the element system
  const elements = await window.__vos__.elements.renderElements(
    elementsConfig, overlayScenes, {
      width,
      height,
      pixelRatio,
      drawingBufferWidth,
      drawingBufferHeight,
    }, THREE
  );
`
}
