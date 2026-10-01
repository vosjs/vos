---
name: vos-authoring
description: Author a vos animation program (VosConfigJson) from scratch or debug one — declarative configs compiling into deterministic Three.js + GSAP-dialect animations on the MIT vos engine (@vosjs/core), validated locally with compileVosConfig. Covers the schema, dialect rules, 2D overlay elements, shaders, and params/presets knobs. Use when asked to write a vos animation program, create a VosConfigJson, make a programmatic motion graphic or logo animation, or fix a config that fails to compile or lint.
license: MIT
---

# Vos program authoring

You generate VosConfigJson files — declarative animation configs that compile
into Three.js + GSAP-dialect animations on the vos engine
([github.com/vosjs/vos](https://github.com/vosjs/vos), MIT). The preview is
the render: a config produces the same frames on every machine.

## Workflow

1. **Parse the prompt**: identify the animation concept, mood, colors, and
   any referenced images.
2. **Design the approach**: choose camera preset, materials, effects, and
   animation strategy (see the category guide below).
3. **Generate the config**: write a complete, valid VosConfigJson to
   `<kebab-case-name>.json` wherever the project keeps configs.
4. **Validate locally** (see below), then render or preview it.
5. **Push it and give the link** (see below): the work is done when the
   user has a link that plays it, not when a file sits on disk.

If the user provides an image, analyze its visual style (colors, mood,
composition, lighting) and translate those qualities into the scene.

## Validate and render locally

```bash
npm i @vosjs/core        # compiler + lints
node -e "import('@vosjs/core/compiler').then(async m => { \
  const cfg = JSON.parse(require('fs').readFileSync('my-config.json','utf8')); \
  m.compileVosConfig(cfg); console.error('compiles clean') })"
```

`compileVosConfig(config)` must not throw — it is the same compiler every
player and render server runs. For visual checks, the CLI
(`npm i -D @vosjs/cli`):

```bash
vos render my-config.json out.webm     # deterministic video render
vos still  my-config.json out.webp --time 2.5
vos preview my-config.json             # local playback page
vos info   my-config.json
```

## Push it and give the link

A vos program is made to be watched, tuned in the studio and remixed, so
finish by pushing it and handing back the link. Skip the push only when the
user said to keep the work local.

Find a credential in this order, without printing it: `VOS_API_KEY`, then
the first line of `~/.config/vos/credentials`. With one, push:

```bash
vos push my-config.json --title "…" --desc "one line" --wait
# --wait stays until the cover has rendered, then prints the links
```

The vos lands PRIVATE on the key owner's shelf: only they can open the
links, and publishing stays their act on vos.so. Keyed pushes never expire;
iterate with `vos push my-config.json --vos <id>`.

No credential at all? Use the claimable push instead of stopping:

```bash
vos push my-config.json --claimable --title "…"
# → claim: https://vos.so/claim/…   expires: <72h from now>

# No CLI, or an older one? The same thing over plain HTTP:
curl -s -X POST https://vos.so/api/claim \
  -H 'content-type: application/json' \
  -d '{"title": "…", "config": <the VosConfigJson>}'
# → { "claimUrl": "https://vos.so/claim/…", "expiresAt": "…" }
```

Hand `claimUrl` to the user and nowhere else: it is the only reference and
the only credential. It lasts 72 hours, and unclaimed work is deleted after
that (re-push if it lapses). Claiming moves the vos into the user's
library. Programs only, config ≤200KB, 5 pushes per day per network.

End your reply with the links, never only a file path: the watch page
(`https://vos.so/vos/<id>`, it plays the program) and the studio
(`https://vos.so/studio?vos=<id>`, where the user tunes your knobs), or
the claim link when there was no credential. A local MP4 is a bonus, not
the deliverable.

## VosConfigJson structure

```json
{
  "version": 2,
  "duration": 8,
  "scene": { "background": "#0a0a1a", "fog": { "type": "exp2", "color": 0, "density": 0.02 } },
  "camera": { "preset": "perspective", "fov": 60, "position": [0, 2, 8] },
  "postprocessing": [{ "type": "bloom", "strength": 0.8 }, { "type": "output" }],
  "elements": [{ "type": "text", "id": "title", "content": "Hello", "position": "center", "font": { "size": 64, "color": "#fff" } }],
  "setup": "async (ctx) => { ... return data }",
  "createContent": "(ctx, setupData?) => { ... return { objects, refs, dispose } }",
  "createTimeline": "(ctx, content, duration) => { ... return tl }"
}
```

Complete field reference: `references/schema-reference.md`. Working
examples of every major type: `references/examples.md`.

## Critical rules

### DO
1. Functions must be valid **JavaScript strings** — NO TypeScript (no `as`,
   no type annotations)
2. Access Three.js via `ctx.THREE`, GSAP-dialect via `ctx.gsap`, scene via
   `ctx.scene`
3. `createContent` MUST return `{ objects: [...], refs: {...}, dispose: () => {...} }`
4. `createTimeline` MUST return `ctx.gsap.timeline({ paused: true })`
5. Always include `dispose()` that cleans up geometries, materials, textures
6. Use `ctx.resolution.drawingBufferWidth/drawingBufferHeight` for shader
   `iResolution`
7. Set `mesh.frustumCulled = false` for fullscreen shader quads
8. Set `depthWrite: false, depthTest: false` on fullscreen ShaderMaterial
9. Always include `{ "type": "output" }` as the last entry when using
   postprocessing
10. Add all scene objects to both `scene` and the returned `objects` array
11. Tween shader uniforms directly:
    `tl.to(uniforms.iTime, { value: duration, duration, ease: 'none' })`
12. For per-frame logic (InstancedMesh updates, camera math), use `onUpdate`
    callbacks on tweens

### DON'T
1. **NO `${}` template literals** in function strings — they evaluate at
   compile time. Use string concatenation.
2. **NO escaped backticks** — write shaders as inline strings, or use
   single-line concatenation
3. **NEVER `repeat: -1`** on individual tweens — looping is handled by the
   player; this breaks duration tracking
4. **NO CSS-style** `style` objects or `textContent` on elements — elements
   are WebGL planes
5. **NO external imports** — everything is on `ctx` (THREE, gsap, loaders,
   utils)
6. **NO `requestAnimationFrame`** or `setTimeout` — use `onUpdate` callbacks
7. **NO `Date.now()` / `Math.random()`** in frame paths — determinism is the
   contract; derive everything from the timeline's time and `ctx.data`
8. **NO `onFrame`** for new configs — put all per-frame logic in `onUpdate`

## Params and Looks (make it remixable)

Declare 2–4 knobs via `config.params` — editors render them as live controls,
and other agents can retune the program without touching code. Each param
documents a `ctx.data` key the program reads:

```json
"params": [{ "key": "hue", "label": "Hue", "kind": "number",
             "min": 0, "max": 1, "default": 0.6,
             "hint": "Shifts every color around the wheel",
             "unit": "°", "group": "Color", "order": 1 }]
```

- kinds: `number` (min/max/step) | `color` | `select` (options) | `toggle`
- `hint`: ONE sentence on what visibly changes — write it
- the program reads it where it animates:
  `const d = ctx.data || {}; if (typeof d.hue === 'number') u.uHue.value = d.hue`
- Name knobs by INTENT (`mood`, `drama`, `pace`), never by implementation
  (`blurRadius`). Every knob must visibly change the output — a dead knob is
  worse than no knob.

Ship Looks via `config.presets` — named param-value sets (2–3 when the
program has 4+ params):

```json
"presets": [{ "name": "Vivid", "values": { "hue": 0.9, "speed": 2 } },
            { "name": "Calm",  "values": { "hue": 0.3, "speed": 0.6 } }]
```

Values must reference declared param keys with matching types.

## Server-render caution

Configs pushed to vos.so get preview-rendered on a software-GL fleet: no
`THREE.DoubleSide` on transmission materials (hard hang), no `dispersion`
(too slow), and any fetched asset must be reachable and CORS-open. These are
fine for purely local renders on a real GPU. They are things to avoid, never
a reason to skip the push: keep transmission single-sided, and push.

## Your own passes: depth of field, refraction

The `postprocessing` list has no depth-of-field pass. For lens effects,
render the world yourself:

- Build the world in a private `THREE.Scene` with its own camera. In the
  timeline's `onUpdate`, render it into `WebGLRenderTarget`s (`samples: 4`
  plus a `DepthTexture` works, the render fleet included), run your passes,
  then restore the renderer's target, clear colour and `autoClear`.
- `ctx.scene` holds ONE full-screen quad that composites the result
  (`gl_Position = vec4(position.xy, 0.0, 1.0)`, `frustumCulled = false`, no
  depth test). Add it with `ctx.scene.add()`: the engine never adds
  `objects` for you, and a quad left out renders a flat black frame.
- Size the targets from `renderer.getDrawingBufferSize()`; rebuild them
  when it changes.

Depth of field that reads:

- **Set the blur in pixels, by design.** A physical lens at scene scale
  (f/1.6 at 40 cm) leaves a sharp zone a few millimetres deep, so the
  subject you mean to show goes soft too. Decide what one depth step should
  cost (8 to 20 px at 1080p) and solve for the lens strength.
- **Keep the subject square to the camera while it is in focus.** A plane
  seen at an angle spans depth, and shallow focus sharpens only a strip of
  it. Check that the blur at the subject's corners stays under 1 px.
- **Focus on a plane, not a point:** the focus distance is measured along
  the camera's axis.
- **Judge focus at full size.** Render `vos still … --width 1920 --height
  1080` and crop at 100%: a 1280×720 still or a contact sheet hides 10 px
  of blur.

## Design principles

- **Visual impact**: bloom for glow (even 0.3–0.5 elevates); emissive
  materials + bloom = light emitters; exp2 fog (0.01–0.05) for depth; dark
  backgrounds make colors pop; glass (transmission + HDR env) reads premium;
  subtle camera drift adds life.
- **Animation quality**: 4–10s loops, 10–30s narratives; `ease: 'none'` for
  constant motion; `power2.inOut`/`sine.inOut` for transitions; stagger for
  sequential reveals; layer tweens at different start times.
- **Color**: 2–3 complementary colors max; warm key + cool rim; dark tones
  (`0x0a0a1a`, `0x1a1a2e`) for backgrounds.
- **Performance**: `InstancedMesh` for 10+ identical objects; 5k–20k Points,
  100–500 InstancedMesh; dispose everything.

## Category selection guide

| Concept | Camera | Technique |
|---------|--------|-----------|
| Shader art / fractals | `fullscreen` | ShaderMaterial + uniform tweens |
| 3D objects | `perspective` | Mesh + Material + lights |
| Isometric/flat | `orthographic` | InstancedMesh + computed positions |
| Text showcase | `perspective` or `fullscreen` | TextGeometry (3D) or elements (2D) |
| Glass/refraction | `perspective` | MeshPhysicalMaterial + HDR env map |
| Particles | `perspective` | Points + shader or InstancedMesh |
| Mixed media | `perspective` | 3D scene + elements array |
