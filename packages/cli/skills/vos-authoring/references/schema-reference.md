# VosConfigJson Schema Reference

Complete API reference for generating VosConfigJson configs.

## Top-Level Fields

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `version` | `number` | Yes | — | Always `2` |
| `duration` | `number` | Yes | — | Animation duration in seconds (typically 4-30) |
| `scene` | `SceneConfig` | No | — | Background color and fog |
| `camera` | `CameraConfig` | Yes | — | Camera preset and parameters |
| `postprocessing` | `PostprocessingEffect[]` | No | — | Global post-processing effects |
| `perLayerEffects` | `PostprocessingEffect[]` | No | — | Effects for objects with matching zIndex |
| `dynamicLayers` | `boolean` | No | `false` | Rebuild render groups when zIndex changes at runtime |
| `elements` | `ElementConfig[]` | No | — | 2D overlay elements |
| `setup` | `string` | No | — | Async function for loading assets |
| `createContent` | `string` | Yes | — | Function that builds scene content |
| `createTimeline` | `string` | Yes | — | Function that creates GSAP timeline |
| `onFrame` | `string` | No | — | Per-frame update callback (prefer onUpdate in timeline) |

---

## Scene Config

```json
{
  "scene": {
    "background": "#1a1a2e",
    "fog": { "type": "exp2", "color": 0, "density": 0.02 }
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `background` | `number \| string` | Hex color: `0x1a1a2e` or `"#1a1a2e"` |
| `fog.type` | `"exp2" \| "linear"` | Fog falloff type |
| `fog.color` | `number \| string` | Fog color |
| `fog.density` | `number` | Exp2 fog density (0.01-0.1 typical) |
| `fog.near` | `number` | Linear fog start distance |
| `fog.far` | `number` | Linear fog end distance |

---

## Camera Config

### Perspective
```json
{ "preset": "perspective", "fov": 60, "position": [0, 2, 8], "lookAt": [0, 0, 0], "near": 0.1, "far": 1000 }
```

### Orthographic
```json
{ "preset": "orthographic", "zoom": 80, "position": [20, 20, 20], "lookAt": [0, 0, 0] }
```

### Fullscreen (for shaders/2D)
```json
{ "preset": "fullscreen" }
```
Creates `OrthographicCamera(-1, 1, 1, -1, 0, 1)` for clip-space rendering.

---

## Post-Processing Effects

Always end the array with `{ "type": "output" }`.

### Bloom
```json
{ "type": "bloom", "strength": 1.0, "radius": 0.5, "threshold": 0 }
```
| Param | Default | Description |
|-------|---------|-------------|
| `strength` | 1.0 | Glow intensity |
| `radius` | 0.5 | Glow spread |
| `threshold` | 0 | Brightness cutoff (0 = everything glows) |

### Glitch
```json
{ "type": "glitch", "goWild": false }
```

### Film Grain
```json
{ "type": "filmGrain", "intensity": 0.5 }
```

### Dot Screen
```json
{ "type": "dotScreen", "scale": 1.0 }
```

### Output (required last)
```json
{ "type": "output" }
```

---

## Per-Layer Effects

Apply effects selectively to objects grouped by `userData.zIndex`:

**Config:**
```json
{
  "perLayerEffects": [
    { "type": "bloom", "strength": 1.2, "radius": 0.4, "threshold": 0.2 },
    { "type": "output" }
  ]
}
```

**In createContent:**
```javascript
sphere.userData.zIndex = 50
sphere.userData.postprocessing = [
  { type: 'bloom', strength: 1.2, radius: 0.4, threshold: 0.2 },
  { type: 'output' }
]
```

Objects without `userData.zIndex` stay on the default layer (no per-layer effects applied).

---

## VosContext (ctx)

### Available in ALL functions

| Property | Type | Description |
|----------|------|-------------|
| `ctx.THREE` | `THREE` | Three.js library (r160+) |
| `ctx.resolution` | `Resolution` | `{ width, height, pixelRatio, drawingBufferWidth, drawingBufferHeight }` |

### Available in setup

| Property | Type | Description |
|----------|------|-------------|
| `ctx.loaders` | `object` | Loader constructors (see Loaders section) |
| `ctx.utils` | `object` | Utility constructors (see Utils section) |

### Available in createContent and createTimeline

| Property | Type | Description |
|----------|------|-------------|
| `ctx.gsap` | `gsap` | GSAP animation library |
| `ctx.scene` | `THREE.Scene` | Main scene |
| `ctx.camera` | `THREE.Camera` | Configured camera |
| `ctx.renderer` | `THREE.WebGLRenderer` | WebGL renderer |
| `ctx.elements` | `Map` | Element instances: `.get(id)` returns `{ props, segments? }` |
| `ctx.composer` | `EffectComposer` | Available when postprocessing is defined |

---

## Function Signatures

### setup (optional)
```javascript
"async (ctx) => { /* load assets */ return { font, envMap, model } }"
```
- Load fonts, textures, models, HDR maps using `ctx.loaders`
- Return data object — passed as `setupData` to `createContent`

### createContent (required)
```javascript
"(ctx, setupData?) => { /* build scene */ return { objects, refs, dispose } }"
```
- Create meshes, lights, materials. Add to `ctx.scene`.
- Return:
  - `objects`: `THREE.Object3D[]` — all objects added to scene (for cleanup)
  - `refs`: `object` — named references passed to `createTimeline`
  - `dispose`: `() => void` — cleanup function for geometries/materials/textures

### createTimeline (required)
```javascript
"(ctx, content, duration) => { /* animate */ return tl }"
```
- `content` is the return value of `createContent`
- Create timeline: `ctx.gsap.timeline({ paused: true })`
- Access refs via `content.refs`
- Return the timeline

---

## Loaders (via ctx.loaders)

### Constructors
| Loader | Usage |
|--------|-------|
| `new ctx.loaders.FontLoader()` | `.load(url, callback)` or wrap in Promise |
| `new ctx.loaders.GLTFLoader()` | `.loadAsync(url)` returns `{ scene, animations }` |
| `new ctx.loaders.DRACOLoader()` | DRACO mesh decompression |
| `new ctx.loaders.HDRLoader()` | `.loadAsync(url)` returns HDR texture |
| `new ctx.loaders.EXRLoader()` | `.loadAsync(url)` returns EXR texture |
| `new ctx.loaders.TextureLoader()` | `.loadAsync(url)` returns Texture |
| `new ctx.loaders.CubeTextureLoader()` | `.load([urls])` returns CubeTexture |

### Pre-configured Instances
| Instance | Description |
|----------|-------------|
| `ctx.loaders.gltf` | GLTFLoader with DRACO decoder auto-attached |
| `ctx.loaders.draco` | DRACOLoader with decoder path pre-set |

### Loading Patterns

**Font (callback-based):**
```javascript
const font = await new Promise((resolve) => {
  new ctx.loaders.FontLoader().load(
    'https://cdn.jsdelivr.net/npm/three@0.183.0/examples/fonts/helvetiker_bold.typeface.json',
    resolve
  )
})
```

**HDR Environment:**
```javascript
const hdr = await new ctx.loaders.HDRLoader().loadAsync('https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/royal_esplanade_1k.hdr')
hdr.mapping = ctx.THREE.EquirectangularReflectionMapping
return { envMap: hdr }
// In createContent: ctx.scene.environment = setupData.envMap
```

**GLTF Model:**
```javascript
const gltf = await ctx.loaders.gltf.loadAsync(url)
return { model: gltf.scene, animations: gltf.animations }
```

---

## Utilities (via ctx.utils)

| Utility | Usage |
|---------|-------|
| `ctx.utils.TextGeometry` | `new ctx.utils.TextGeometry('TEXT', { font, size, height, bevelEnabled, ... })` |
| `ctx.utils.MeshSurfaceSampler` | `new ctx.utils.MeshSurfaceSampler(mesh).build()` then `.sample(vec3)` |
| `ctx.utils.BufferGeometryUtils` | `.mergeGeometries([geo1, geo2])`, `.computeMorphedAttributes()` |

### TextGeometry Parameters
```javascript
new ctx.utils.TextGeometry('TEXT', {
  font: loadedFont,
  size: 10,
  height: 2,          // extrude depth
  curveSegments: 12,
  bevelEnabled: true,
  bevelThickness: 1,
  bevelSize: 0.5,
  bevelSegments: 8
})
```

---

## Elements (2D Overlays)

Elements are 2D content rendered as textured planes in the WebGL scene. They are NOT HTML — no CSS properties.

### Common Fields (all types)

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `type` | `"text" \| "image" \| "svg" \| "video"` | Yes | — | Element type |
| `position` | `string \| {x, y}` | Yes | — | Position preset or coordinates |
| `id` | `string` | No | — | ID for referencing in createTimeline |
| `anchor` | `string` | No | `"center"` | Anchor point for positioning |
| `zIndex` | `number` | No | `100` | Layer order (higher = on top of 3D) |
| `opacity` | `number` | No | `1` | Opacity 0-1 |
| `transform` | `Transform` | No | — | 3D transform overrides |

### Position Presets
`"center"`, `"top-left"`, `"top-center"`, `"top-right"`, `"center-left"`, `"center-right"`, `"bottom-left"`, `"bottom-center"`, `"bottom-right"`

Or pixel/percentage: `{ "x": 100, "y": 50 }` / `{ "x": "50%", "y": "25%" }`

### Transform
```json
{ "translateX": 0, "translateY": 0, "translateZ": 0, "rotation": 0, "scale": 1, "scaleX": 1, "scaleY": 1 }
```

### Text Element
```json
{
  "type": "text",
  "id": "title",
  "content": "Hello World",
  "position": "center",
  "font": { "family": "Inter, system-ui, sans-serif", "size": 64, "weight": "bold", "color": "#ffffff", "letterSpacing": -2, "lineHeight": 1.2, "align": "center" },
  "stroke": { "color": "#000000", "width": 2 },
  "shadow": { "color": "rgba(0,0,0,0.5)", "blur": 10, "offsetX": 2, "offsetY": 2 },
  "split": { "type": "chars" }
}
```

### Image Element
```json
{
  "type": "image",
  "src": "https://example.com/img.png",
  "position": "center",
  "size": { "width": 400, "height": "auto", "fit": "contain" },
  "filters": { "brightness": 1, "contrast": 1, "saturate": 1, "blur": 0, "hueRotate": 0, "grayscale": 0 },
  "borderRadius": 10
}
```

### SVG Element
```json
{
  "type": "svg",
  "src": "<svg>...</svg>",
  "position": "center",
  "size": { "width": 200, "height": "auto" },
  "colors": { "#000": "#fff" }
}
```

### Video Element
```json
{
  "type": "video",
  "id": "myVideo",
  "src": "https://example.com/video.mp4",
  "position": "center",
  "size": { "width": 640, "height": "auto", "fit": "cover" },
  "loop": true,
  "muted": true,
  "playbackRate": 1,
  "startTime": 0
}
```

---

## Animatable Element Properties

Access via `ctx.elements.get(id)`:

| Property | Type | Description |
|----------|------|-------------|
| `props.x` | `number` | X position offset |
| `props.y` | `number` | Y position offset |
| `props.z` | `number` | Z depth |
| `props.opacity` | `number` | Opacity 0-1 |
| `props.scale` | `number` | Uniform scale |
| `props.scaleX` | `number` | Horizontal scale |
| `props.scaleY` | `number` | Vertical scale |
| `props.rotation` | `number` | Z rotation (degrees) |
| `props.rotationX` | `number` | X rotation (degrees) |
| `props.rotationY` | `number` | Y rotation (degrees) |
| `props.fontSize` | `number` | Text font size |
| `props.letterSpacing` | `number` | Text letter spacing |

### Video-specific
| Property | Type | Description |
|----------|------|-------------|
| `props.currentTime` | `number` | Playback position in seconds |
| `props.playing` | `boolean` | Whether video is playing |
| `props.startOffset` | `number` | Playback start offset |
| `props.duration` | `number` | Video duration (read-only) |

### Split Text Segments

When `split` is configured, `el.segments` is an array of `ElementProps` — one per char/word/line:
```javascript
const el = ctx.elements.get('title')
if (el?.segments) {
  el.segments.forEach((seg, i) => {
    tl.fromTo(seg, { opacity: 0, y: 50 }, { opacity: 1, y: 0, duration: 0.5 }, i * 0.05)
  })
}
```

---

## Common Material Recipes

### Glass / Crystal
```javascript
new THREE.MeshPhysicalMaterial({
  color: 0xffffff,
  transmission: 1.0,
  roughness: 0.0,
  ior: 1.5,
  thickness: 2.0,
  dispersion: 4.0,     // Rainbow effects
  clearcoat: 1.0,
  envMapIntensity: 1.5,
  side: THREE.DoubleSide
})
// Requires: scene.environment = hdrTexture
// Local renders only: for configs pushed to vos.so, drop `dispersion` and
// never DoubleSide a transmission material (the server fleet renders on
// software GL — see the SKILL.md server-render caution).
```

### Emissive Glow (with bloom)
```javascript
new THREE.MeshStandardMaterial({
  color: 0xff6b6b,
  emissive: 0xff6b6b,
  emissiveIntensity: 0.5
})
// Add bloom postprocessing for visible glow
```

### Wireframe
```javascript
new THREE.MeshBasicMaterial({ color: 0xff00cc, wireframe: true, transparent: true, opacity: 0.3 })
```

### Premium Solid
```javascript
new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.1, clearcoat: 1.0, clearcoatRoughness: 0.1 })
```

---

## Common Geometry Recipes

### Fullscreen Shader Quad
```javascript
const geometry = new THREE.PlaneGeometry(2, 2)
const material = new THREE.ShaderMaterial({
  uniforms: { iTime: { value: 0 }, iResolution: { value: new THREE.Vector3(resolution.drawingBufferWidth, resolution.drawingBufferHeight, 1) } },
  vertexShader: 'void main() { gl_Position = vec4(position, 1.0); }',
  fragmentShader: '/* your GLSL */',
  depthWrite: false, depthTest: false
})
const mesh = new THREE.Mesh(geometry, material)
mesh.frustumCulled = false
```

### Rounded Box (ExtrudeGeometry)
```javascript
const shape = new THREE.Shape()
const w = 0.8, d = 0.8, r = 0.1, x = -w/2, y = -d/2
shape.moveTo(x + r, y)
shape.lineTo(x + w - r, y)
shape.quadraticCurveTo(x + w, y, x + w, y + r)
shape.lineTo(x + w, y + d - r)
shape.quadraticCurveTo(x + w, y + d, x + w - r, y + d)
shape.lineTo(x + r, y + d)
shape.quadraticCurveTo(x, y + d, x, y + d - r)
shape.lineTo(x, y + r)
shape.quadraticCurveTo(x, y, x + r, y)
const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.8, bevelEnabled: true, bevelSegments: 2, bevelSize: r, bevelThickness: r })
geometry.center()
```

### Canvas Texture
```javascript
const canvas = document.createElement('canvas')
const c = canvas.getContext('2d')
canvas.width = 2048; canvas.height = 1200
c.fillStyle = '#080808'
c.fillRect(0, 0, canvas.width, canvas.height)
c.font = 'bold 110px Inter, system-ui, sans-serif'
c.fillStyle = '#cccccc'
c.textAlign = 'center'
c.fillText('TEXT', canvas.width / 2, canvas.height / 2)
const texture = new THREE.CanvasTexture(canvas)
texture.colorSpace = THREE.SRGBColorSpace
```
