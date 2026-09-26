# VosConfigJson Examples

Complete, working examples covering all major animation types. Use these as templates when generating new configs.

---

## 1. Fullscreen Shader — Rainbow Plasma

Simple fragment shader with `iTime` and `iResolution` uniforms. Demonstrates the fullscreen shader pattern.

```json
{
  "version": 2,
  "duration": 10,
  "camera": { "preset": "fullscreen" },
  "createContent": "(ctx) => { const { THREE, scene, resolution } = ctx; const uniforms = { iTime: { value: 0 }, iResolution: { value: new THREE.Vector3(resolution.drawingBufferWidth, resolution.drawingBufferHeight, 1) } }; const material = new THREE.ShaderMaterial({ uniforms, vertexShader: 'void main() { gl_Position = vec4(position, 1.0); }', fragmentShader: 'precision highp float; uniform float iTime; uniform vec3 iResolution; void main() { vec2 uv = gl_FragCoord.xy / iResolution.xy; vec3 col = 0.5 + 0.5 * cos(iTime + uv.xyx * 6.28 + vec3(0,2,4)); gl_FragColor = vec4(col, 1.0); }', depthWrite: false, depthTest: false }); const geometry = new THREE.PlaneGeometry(2, 2); const mesh = new THREE.Mesh(geometry, material); mesh.frustumCulled = false; scene.add(mesh); return { objects: [mesh], refs: { uniforms, geometry, material }, dispose: () => { geometry.dispose(); material.dispose(); } }; }",
  "createTimeline": "(ctx, content, duration) => { const tl = ctx.gsap.timeline({ paused: true }); tl.to(content.refs.uniforms.iTime, { value: duration, duration, ease: 'none' }); return tl; }"
}
```

**Key patterns**: fullscreen camera, PlaneGeometry(2,2), frustumCulled=false, depthWrite/depthTest=false, direct uniform tween.

---

## 2. 3D Scene with Bloom — Rotating Emissive Spheres

Colored spheres with emissive materials and bloom post-processing. Shows 3D scene + elements + postprocessing.

```json
{
  "version": 2,
  "duration": 8,
  "scene": { "background": "#0a0a1a", "fog": { "type": "exp2", "color": 657946, "density": 0.03 } },
  "camera": { "preset": "perspective", "fov": 60, "position": [0, 2, 8] },
  "postprocessing": [
    { "type": "bloom", "strength": 0.8, "radius": 0.4, "threshold": 0.3 },
    { "type": "output" }
  ],
  "elements": [
    { "type": "text", "id": "title", "content": "BLOOM", "position": "center", "font": { "size": 72, "color": "#ffffff", "weight": "bold", "family": "Inter, system-ui, sans-serif" }, "opacity": 0 }
  ],
  "createContent": "(ctx) => { const { THREE, scene } = ctx; const group = new THREE.Group(); const colors = [0xff6b6b, 0x4ecdc4, 0xffe66d]; const spheres = []; for (let i = 0; i < 3; i++) { const geo = new THREE.SphereGeometry(0.5, 32, 32); const mat = new THREE.MeshStandardMaterial({ color: colors[i], emissive: colors[i], emissiveIntensity: 0.5 }); const s = new THREE.Mesh(geo, mat); s.position.x = (i - 1) * 2.5; group.add(s); spheres.push(s); } scene.add(group); const light = new THREE.PointLight(0xffffff, 2, 20); light.position.set(0, 5, 5); scene.add(light); const ambient = new THREE.AmbientLight(0xffffff, 0.3); scene.add(ambient); return { objects: [group, light, ambient], refs: { spheres, group }, dispose: () => { spheres.forEach(s => { s.geometry.dispose(); s.material.dispose(); }); } }; }",
  "createTimeline": "(ctx, content, duration) => { const { gsap, elements } = ctx; const tl = gsap.timeline({ paused: true }); const title = elements.get('title'); if (title) { tl.fromTo(title.props, { opacity: 0, scale: 0.8 }, { opacity: 1, scale: 1, duration: 1.5, ease: 'power2.out' }, 0.5); } tl.to(content.refs.group.rotation, { y: Math.PI * 2, duration, ease: 'none' }, 0); content.refs.spheres.forEach((s, i) => { tl.to(s.position, { y: 1.5, duration: duration / 2, ease: 'sine.inOut', yoyo: true, repeat: 1 }, i * 0.2); }); return tl; }"
}
```

**Key patterns**: emissive materials + bloom, PointLight + AmbientLight, group rotation, element fade-in.

---

## 3. Glass Text — MeshPhysicalMaterial + HDR

3D text with glass material. Demonstrates setup phase, font loading, HDR environment maps, and MeshPhysicalMaterial.

```json
{
  "version": 2,
  "duration": 10,
  "scene": { "background": 0 },
  "camera": { "preset": "perspective", "fov": 35, "position": [0, 0, 80] },
  "postprocessing": [
    { "type": "bloom", "strength": 0.3, "radius": 0.5, "threshold": 0.8 },
    { "type": "output" }
  ],
  "setup": "async (ctx) => { const [font, hdr] = await Promise.all([ new Promise((resolve) => new ctx.loaders.FontLoader().load('https://cdn.jsdelivr.net/npm/three@0.183.0/examples/fonts/helvetiker_bold.typeface.json', resolve)), new ctx.loaders.HDRLoader().loadAsync('https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/royal_esplanade_1k.hdr') ]); hdr.mapping = ctx.THREE.EquirectangularReflectionMapping; return { font, envMap: hdr }; }",
  "createContent": "(ctx, setupData) => { const { THREE, scene, utils } = ctx; scene.environment = setupData.envMap; const group = new THREE.Group(); scene.add(group); const geometry = new utils.TextGeometry('VOS', { font: setupData.font, size: 15, height: 2, curveSegments: 32, bevelEnabled: true, bevelThickness: 3, bevelSize: 1.5, bevelSegments: 16 }); geometry.center(); const material = new THREE.MeshPhysicalMaterial({ color: 0xffffff, transmission: 1.0, roughness: 0.0, ior: 1.6, thickness: 10.0, dispersion: 4.0, clearcoat: 1.0, envMapIntensity: 1.5, side: THREE.DoubleSide }); const mesh = new THREE.Mesh(geometry, material); group.add(mesh); const light = new THREE.DirectionalLight(0xffffff, 2.0); light.position.set(0, 50, -50); scene.add(light); return { objects: [group, light], refs: { group, mesh }, dispose: () => { geometry.dispose(); material.dispose(); setupData.envMap.dispose(); } }; }",
  "createTimeline": "(ctx, content, duration) => { const { gsap, camera } = ctx; const tl = gsap.timeline({ paused: true }); tl.to(content.refs.group.rotation, { y: Math.PI * 0.1, x: Math.PI * 0.05, duration, ease: 'sine.inOut', yoyo: true, repeat: 1 }, 0); tl.fromTo(camera.position, { z: 70, x: -10 }, { z: 60, x: 10, duration, ease: 'none', yoyo: true, repeat: 1 }, 0); return tl; }"
}
```

**Key patterns**: setup + createContent handoff, FontLoader + HDRLoader parallel loading, TextGeometry, MeshPhysicalMaterial with transmission/dispersion.

---

## 4. Particle Text — MeshSurfaceSampler + Custom Shader

Particles sampled from text surface that assemble from scattered positions. Shows MeshSurfaceSampler, custom vertex/fragment shaders on Points.

```json
{
  "version": 2,
  "duration": 10,
  "scene": { "fog": { "type": "exp2", "color": 0, "density": 0.01 } },
  "camera": { "preset": "perspective", "fov": 45, "position": [0, 0, 150] },
  "postprocessing": [
    { "type": "bloom", "strength": 1, "radius": 0.5, "threshold": 0 },
    { "type": "output" }
  ],
  "setup": "async (ctx) => { const font = await new Promise((resolve) => { new ctx.loaders.FontLoader().load('https://cdn.jsdelivr.net/npm/three@0.183.0/examples/fonts/helvetiker_bold.typeface.json', resolve) }); return { font }; }",
  "createContent": "(ctx, setupData) => { const { THREE, scene, utils } = ctx; const textGeo = new utils.TextGeometry('HELLO', { font: setupData.font, size: 10, height: 2, bevelEnabled: false }); textGeo.center(); const tempMesh = new THREE.Mesh(textGeo, new THREE.MeshBasicMaterial()); const sampler = new utils.MeshSurfaceSampler(tempMesh).build(); const count = 15000; const positions = new Float32Array(count * 3); const randomPos = new Float32Array(count * 3); const tempVec = new THREE.Vector3(); for (let i = 0; i < count; i++) { sampler.sample(tempVec); positions[i*3] = tempVec.x; positions[i*3+1] = tempVec.y; positions[i*3+2] = tempVec.z; const r = 80 + Math.random() * 80; const theta = Math.random() * Math.PI * 2; const phi = Math.acos(Math.random() * 2 - 1); randomPos[i*3] = r * Math.sin(phi) * Math.cos(theta); randomPos[i*3+1] = r * Math.sin(phi) * Math.sin(theta); randomPos[i*3+2] = r * Math.cos(phi); } const mat = new THREE.ShaderMaterial({ uniforms: { progress: { value: 0 }, color: { value: new THREE.Color(0x00aaff) } }, vertexShader: 'attribute vec3 randomPos; uniform float progress; varying float vAlpha; void main() { vec3 pos = mix(randomPos, position, smoothstep(0.0, 1.0, progress)); vec4 mv = modelViewMatrix * vec4(pos, 1.0); gl_PointSize = 2.0 * (80.0 / -mv.z); gl_Position = projectionMatrix * mv; vAlpha = 0.3 + 0.7 * progress; }', fragmentShader: 'uniform vec3 color; varying float vAlpha; void main() { vec2 c = 2.0 * gl_PointCoord - 1.0; if (dot(c,c) > 1.0) discard; gl_FragColor = vec4(color, vAlpha * (1.0 - dot(c,c))); }', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }); const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(positions, 3)); geo.setAttribute('randomPos', new THREE.BufferAttribute(randomPos, 3)); const points = new THREE.Points(geo, mat); scene.add(points); return { objects: [points], refs: { points, mat, uniforms: mat.uniforms, textGeo, geo }, dispose: () => { textGeo.dispose(); geo.dispose(); mat.dispose(); } }; }",
  "createTimeline": "(ctx, content, duration) => { const tl = ctx.gsap.timeline({ paused: true }); tl.to(content.refs.uniforms.progress, { value: 1, duration: duration * 0.4, ease: 'power2.out' }, 0); tl.to(content.refs.points.rotation, { y: 0.3, duration, ease: 'none' }, 0); tl.to(content.refs.uniforms.progress, { value: 0, duration: duration * 0.2, ease: 'power2.in' }, duration * 0.8); return tl; }"
}
```

**Key patterns**: MeshSurfaceSampler, BufferAttribute for custom vertex data, custom vertex/fragment shaders, additive blending, progress-driven assembly.

---

## 5. InstancedMesh Grid — Dynamic Wave Animation

Isometric grid of cubes with wave animation. Shows InstancedMesh, per-instance transforms/colors via onUpdate.

```json
{
  "version": 2,
  "duration": 8,
  "scene": { "background": 328965 },
  "camera": { "preset": "orthographic", "zoom": 80, "position": [20, 20, 20], "lookAt": [0, 0, 0] },
  "createContent": "(ctx) => { const { THREE, scene } = ctx; const geometry = new THREE.BoxGeometry(0.8, 0.8, 0.8); const material = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.1, clearcoat: 1.0 }); const size = 12; const mesh = new THREE.InstancedMesh(geometry, material, size * size); scene.add(mesh); const ambient = new THREE.AmbientLight(0x222222, 1); scene.add(ambient); const dir = new THREE.DirectionalLight(0xffaa77, 2); dir.position.set(10, 20, 10); scene.add(dir); const dummy = new THREE.Object3D(); const color = new THREE.Color(); return { objects: [mesh, ambient, dir], refs: { mesh, dummy, color, size }, dispose: () => { geometry.dispose(); material.dispose(); } }; }",
  "createTimeline": "(ctx, content, duration) => { const { mesh, dummy, color, size } = content.refs; const state = { t: 0 }; const tl = ctx.gsap.timeline({ paused: true }); tl.to(state, { t: Math.PI * 2, duration, ease: 'none', onUpdate: () => { let i = 0; for (let x = 0; x < size; x++) { for (let z = 0; z < size; z++) { const xPos = x - size/2 + 0.5; const zPos = z - size/2 + 0.5; const d = Math.sqrt(xPos*xPos + zPos*zPos); const h = (Math.sin(d*0.5 - state.t*2) + Math.sin((xPos+zPos)*0.3 + state.t)) * 1.5 + 4; dummy.position.set(xPos, 0, zPos); dummy.scale.set(1, h, 1); dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix); color.setHSL(0.6 + Math.sin(d*0.5 - state.t*2)*0.1, 0.5, 0.5); mesh.setColorAt(i, color); i++; } } mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true; }}); return tl; }"
}
```

**Key patterns**: orthographic camera, InstancedMesh, dummy.updateMatrix(), setMatrixAt/setColorAt, instanceMatrix.needsUpdate.

---

## 6. Split Text Animation over Shader Background

Per-character rotation animation with a GLSL background. Shows split text segments, element animation, and mixed shader + 2D.

```json
{
  "version": 2,
  "duration": 4,
  "scene": { "background": 0 },
  "camera": { "preset": "fullscreen" },
  "elements": [
    { "id": "title", "type": "text", "content": "ANIMATE", "position": "center", "font": { "family": "Inter, system-ui, sans-serif", "size": 100, "weight": "bold", "color": "#ffffff", "letterSpacing": -3 }, "split": { "type": "chars" }, "opacity": 1 }
  ],
  "createContent": "(ctx) => { const { THREE, scene, resolution } = ctx; const geo = new THREE.PlaneGeometry(2, 2); const mat = new THREE.ShaderMaterial({ uniforms: { iTime: { value: 0 }, iResolution: { value: new THREE.Vector3(resolution.drawingBufferWidth, resolution.drawingBufferHeight, 1) } }, vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }', fragmentShader: 'uniform float iTime; varying vec2 vUv; void main() { vec2 uv = vUv; float t = iTime * 0.5; vec3 col = vec3(0.05 + 0.03 * sin(uv.x * 10.0 + t), 0.02 + 0.02 * sin(uv.y * 8.0 - t), 0.1 + 0.05 * sin((uv.x + uv.y) * 6.0 + t * 0.5)); gl_FragColor = vec4(col, 1.0); }', depthWrite: false }); const mesh = new THREE.Mesh(geo, mat); mesh.renderOrder = -1; scene.add(mesh); return { objects: [mesh], refs: { geo, mat, uniforms: mat.uniforms }, dispose: () => { geo.dispose(); mat.dispose(); } }; }",
  "createTimeline": "(ctx, content, duration) => { const { gsap, elements } = ctx; const tl = gsap.timeline({ paused: true }); tl.to(content.refs.uniforms.iTime, { value: duration * 2, duration, ease: 'none' }, 0); const title = elements.get('title'); if (title && title.segments) { title.segments.forEach((charProps, i) => { tl.fromTo(charProps, { rotationX: -90, opacity: 0 }, { rotationX: 0, opacity: 1, duration: 0.6, ease: 'back.out(1.7)' }, 0.3 + i * 0.08); }); } return tl; }"
}
```

**Key patterns**: split text with `type: "chars"`, per-segment animation with stagger, shader background with renderOrder=-1.

---

## 7. Synthwave Drive — Wireframe Grid + Gradient Sun

Retro synthwave aesthetic with wireframe grid floor, shader sun, mountains, and fog. Shows stylized scene construction.

```json
{
  "version": 2,
  "duration": 4,
  "scene": { "fog": { "type": "exp2", "color": 1706798, "density": 0.02 } },
  "camera": { "preset": "perspective", "fov": 60, "position": [0, 3, 10] },
  "postprocessing": [
    { "type": "bloom", "strength": 1.2, "radius": 0, "threshold": 0 },
    { "type": "output" }
  ],
  "createContent": "(ctx) => { const { THREE, scene, renderer } = ctx; renderer.toneMapping = THREE.ACESFilmicToneMapping; const sunGeo = new THREE.CircleGeometry(15, 64); const sunMat = new THREE.ShaderMaterial({ uniforms: { color1: { value: new THREE.Color(0xffdd00) }, color2: { value: new THREE.Color(0xff00cc) }, time: { value: 0 } }, vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }', fragmentShader: 'uniform vec3 color1; uniform vec3 color2; uniform float time; varying vec2 vUv; void main() { float y = vUv.y; vec3 color = mix(color2, color1, y); float stripe = mod(y * 20.0 - time * 0.5, 1.0); if(y < 0.5 && stripe < 0.4) discard; gl_FragColor = vec4(color, 1.0); }', transparent: true }); const sun = new THREE.Mesh(sunGeo, sunMat); sun.position.set(0, 5, -60); scene.add(sun); const floorGeo = new THREE.PlaneGeometry(200, 200, 40, 40); const floorMat = new THREE.MeshBasicMaterial({ color: 0xff00cc, wireframe: true, transparent: true, opacity: 0.3 }); const floor = new THREE.Mesh(floorGeo, floorMat); floor.rotation.x = -Math.PI / 2; floor.position.y = -1; scene.add(floor); return { objects: [sun, floor], refs: { sun, sunMat, floor, sunGeo, floorGeo, floorMat }, dispose: () => { sunGeo.dispose(); sunMat.dispose(); floorGeo.dispose(); floorMat.dispose(); } }; }",
  "createTimeline": "(ctx, content, duration) => { const { gsap } = ctx; const { floor, sunMat } = content.refs; const state = { t: 0 }; const tl = gsap.timeline({ paused: true }); tl.to(state, { t: 1, duration, ease: 'none', onUpdate: () => { floor.position.z = (state.t * 20) % 5; sunMat.uniforms.time.value = state.t * 10; ctx.camera.position.x = Math.sin(state.t * Math.PI * 2) * 0.5; }}); return tl; }"
}
```

**Key patterns**: wireframe material, shader-based gradient sun with stripe discard, infinite scroll via modulo, camera sway.

---

## 8. Per-Layer Bloom — Selective Effects

Orbiting spheres with bloom on specific layers while background stays clean. Shows per-layer effects and zIndex system.

```json
{
  "version": 2,
  "duration": 8,
  "scene": { "background": 657946 },
  "camera": { "preset": "perspective", "fov": 60, "position": [0, 0, 12], "lookAt": [0, 0, 0] },
  "postprocessing": [
    { "type": "filmGrain", "intensity": 0.3 },
    { "type": "output" }
  ],
  "perLayerEffects": [
    { "type": "bloom", "strength": 1.2, "radius": 0.4, "threshold": 0.2 },
    { "type": "output" }
  ],
  "elements": [
    { "id": "label", "type": "text", "content": "LAYERS", "position": "center", "zIndex": 25, "font": { "family": "Inter, system-ui, sans-serif", "size": 72, "weight": "bold", "color": "#ffffff" }, "opacity": 0.9 }
  ],
  "createContent": "(ctx) => { const { THREE, scene } = ctx; const icoGeo = new THREE.IcosahedronGeometry(3.5, 1); const icoMat = new THREE.MeshBasicMaterial({ color: 0x334455, wireframe: true }); const ico = new THREE.Mesh(icoGeo, icoMat); scene.add(ico); const sphereGeo = new THREE.SphereGeometry(0.25, 16, 16); const COUNT = 10; const spheres = []; for (let i = 0; i < COUNT; i++) { const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color().setHSL(i / COUNT, 1, 0.6) }); const sphere = new THREE.Mesh(sphereGeo, mat); sphere.userData.zIndex = 50; if (i === 0) { sphere.userData.postprocessing = [{ type: 'bloom', strength: 1.2, radius: 0.4, threshold: 0.2 }, { type: 'output' }]; } scene.add(sphere); spheres.push(sphere); } return { objects: [ico, ...spheres], refs: { ico, spheres }, dispose: () => { icoGeo.dispose(); icoMat.dispose(); sphereGeo.dispose(); } }; }",
  "createTimeline": "(ctx, content, duration) => { const { gsap, elements } = ctx; const { spheres, ico } = content.refs; const COUNT = spheres.length; const tl = gsap.timeline({ paused: true }); const state = { t: 0 }; tl.to(state, { t: duration, duration, ease: 'none', onUpdate: () => { for (let i = 0; i < COUNT; i++) { const angle = (i / COUNT) * Math.PI * 2 + state.t * 0.8; spheres[i].position.set(Math.cos(angle) * 4, Math.sin(angle * 2) * 1.5, Math.sin(angle) * 4); } }}, 0); tl.to(ico.rotation, { y: Math.PI * 2, x: Math.PI * 0.3, duration, ease: 'none' }, 0); const label = elements.get('label'); if (label) { tl.from(label.props, { opacity: 0, scale: 0.7, duration: 1.2, ease: 'power2.out' }, 0.5); } return tl; }"
}
```

**Key patterns**: perLayerEffects config, userData.zIndex + userData.postprocessing on first object, separate global filmGrain + per-layer bloom.

---

## 9. Neon Torus Knot — Simple 3D with Glow

Minimal 3D scene with a rotating TorusKnot and bloom glow. Good starting template for simple 3D animations.

```json
{
  "version": 2,
  "duration": 6,
  "scene": { "background": "#050510" },
  "camera": { "preset": "perspective", "fov": 50, "position": [0, 0, 6] },
  "postprocessing": [
    { "type": "bloom", "strength": 1.5, "radius": 0.4, "threshold": 0.1 },
    { "type": "output" }
  ],
  "createContent": "(ctx) => { const { THREE, scene } = ctx; const geo = new THREE.TorusKnotGeometry(1.2, 0.4, 128, 32); const mat = new THREE.MeshStandardMaterial({ color: 0x00ffaa, emissive: 0x00ffaa, emissiveIntensity: 0.8, roughness: 0.3 }); const mesh = new THREE.Mesh(geo, mat); scene.add(mesh); const light = new THREE.PointLight(0xffffff, 1, 20); light.position.set(3, 3, 3); scene.add(light); const ambient = new THREE.AmbientLight(0x111122, 1); scene.add(ambient); return { objects: [mesh, light, ambient], refs: { mesh }, dispose: () => { geo.dispose(); mat.dispose(); } }; }",
  "createTimeline": "(ctx, content, duration) => { const tl = ctx.gsap.timeline({ paused: true }); tl.to(content.refs.mesh.rotation, { x: Math.PI * 2, y: Math.PI, duration, ease: 'none' }, 0); tl.to(ctx.camera.position, { x: 2, z: 5, duration: duration / 2, ease: 'sine.inOut', yoyo: true, repeat: 1 }, 0); return tl; }"
}
```

**Key patterns**: TorusKnotGeometry, emissive + bloom for neon glow, simple rotation + camera drift.

---

## 10. Mixed Media — 3D + Image Element

3D scene with an image element overlay. Shows mixing 3D objects with 2D image elements.

```json
{
  "version": 2,
  "duration": 6,
  "scene": { "background": "#0d0d1a" },
  "camera": { "preset": "perspective", "fov": 50, "position": [0, 0, 8] },
  "postprocessing": [
    { "type": "bloom", "strength": 0.6, "radius": 0.3, "threshold": 0.4 },
    { "type": "output" }
  ],
  "elements": [
    { "type": "text", "id": "heading", "content": "MIXED\nMEDIA", "position": { "x": "25%", "y": "50%" }, "font": { "size": 56, "color": "#ffffff", "weight": "bold", "family": "Inter, system-ui, sans-serif", "lineHeight": 1.1 }, "opacity": 0 },
    { "type": "text", "id": "sub", "content": "3D + 2D elements combined", "position": { "x": "25%", "y": "65%" }, "font": { "size": 16, "color": "#888888" }, "opacity": 0 }
  ],
  "createContent": "(ctx) => { const { THREE, scene } = ctx; const group = new THREE.Group(); group.position.x = 2; const geo1 = new THREE.IcosahedronGeometry(1.5, 0); const mat1 = new THREE.MeshStandardMaterial({ color: 0x6366f1, emissive: 0x6366f1, emissiveIntensity: 0.3, wireframe: true }); const wire = new THREE.Mesh(geo1, mat1); group.add(wire); const geo2 = new THREE.SphereGeometry(1, 32, 32); const mat2 = new THREE.MeshStandardMaterial({ color: 0x818cf8, emissive: 0x818cf8, emissiveIntensity: 0.2 }); const solid = new THREE.Mesh(geo2, mat2); group.add(solid); scene.add(group); const light = new THREE.PointLight(0x8b5cf6, 3, 15); light.position.set(2, 3, 4); scene.add(light); const ambient = new THREE.AmbientLight(0x1a1a2e, 2); scene.add(ambient); return { objects: [group, light, ambient], refs: { group, wire }, dispose: () => { geo1.dispose(); mat1.dispose(); geo2.dispose(); mat2.dispose(); } }; }",
  "createTimeline": "(ctx, content, duration) => { const { gsap, elements } = ctx; const tl = gsap.timeline({ paused: true }); tl.to(content.refs.group.rotation, { y: Math.PI * 2, duration, ease: 'none' }, 0); tl.to(content.refs.wire.rotation, { x: Math.PI, duration, ease: 'none' }, 0); const heading = elements.get('heading'); const sub = elements.get('sub'); if (heading) { tl.fromTo(heading.props, { opacity: 0, x: -30 }, { opacity: 1, x: 0, duration: 1, ease: 'power2.out' }, 0.5); } if (sub) { tl.fromTo(sub.props, { opacity: 0 }, { opacity: 0.8, duration: 1, ease: 'power2.out' }, 1); } return tl; }"
}
```

**Key patterns**: elements positioned with percentages, multiline text with `\n`, 3D group offset + text on the side, staggered text reveal.
