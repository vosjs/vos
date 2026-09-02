import { timelineRuntimeCode } from '@vosjs/timeline/bundle'
import { OVERLAY_FONT_FACES } from '../overlayText'
import { CARD_FOV, CARD_Z } from '../stage'
import { OVERLAY_LINE_HEIGHT, OVERLAY_TRANSITION_DUR } from '../types'

/**
 * The studio's program: the SHARED layers (text/image/video overlay clips, the
 * 3D prop pool) as ONE engine stack entry (`config.stack`, @vosjs/core ≥0.21)
 * that runs after the anchor's program on the same ctx — same scene, camera,
 * overlayScene, renderer, master clock — with its OWN `ctx.data` and its own
 * error boundary. The same entry rides every anchor: a recording's card
 * program and a user's own config alike.
 *
 * Everything here is CONSTANT text: a layer edit is `SET_DATA { target }` on
 * this entry, never a program change (the liveEdit invariant). The paint code
 * is the take editor's compositor, moved out of its main program unchanged;
 * it reads only what an entry is given — the renderer size, the output
 * clock (`ctx.time` on an entry IS the output time), the shared
 * `window.__vos__` caches and `globalThis.__vosTimeline` — never the anchor's
 * card geometry.
 *
 * The overlay layer mounts in `ctx.overlayScene` (the engine's 2D group,
 * rendered after every 3D group under the ortho `overlayCamera`), sized to that
 * camera's bounds, so it fills the frame on any anchor whatever its camera.
 * Props mount in `ctx.scene` at renderOrder 1.5 (between a recording's card and
 * its cam bubble) on the ANCHOR's camera: a perspective camera anywhere, or an
 * orthographic one (a program's `fullscreen` preset), where the prop group
 * carries the camera pose and a pixel-aspect squash. Lights: the entry adds
 * its pair when its data says `lights` (the recording anchor), and lazily,
 * once, when a program's scene turns out to have none (a shader program).
 */

export const STUDIO_ENTRY_ID = 'vosso.studio'

export interface StudioEntry {
  id: string
  data: Record<string, unknown>
  setup: string
  createContent: string
  onFrame: string
}

export function studioEntry(data: Record<string, unknown>): StudioEntry {
  return {
    id: STUDIO_ENTRY_ID,
    data,
    setup: STUDIO_SETUP,
    createContent: STUDIO_CONTENT,
    onFrame: STUDIO_FRAME,
  }
}

// Fonts, overlay media and prop assets warm-load here so the first captured
// frame is complete (preview/export parity). The timeline runtime is installed
// when the anchor's program did not (a user's config has no reason to).
export const STUDIO_SETUP = `async (ctx) => {
  if (!globalThis.__vosTimeline) { ${timelineRuntimeCode} }
  const ns = (window.__vos__ = window.__vos__ || {})
  // The transport's pause state (the engine's video-renderer contract): the
  // bridge toggles it through setGlobalPaused ONLY when something installed
  // it. The card program does; a bare program has no element renderers and
  // installs nothing, so without this the audio scheduler below read
  // isPaused as undefined, never "playing", and a soundtrack on a program
  // was silent in the studio while the offline export mix carried it.
  if (ns.isPaused === undefined) ns.isPaused = true
  if (!ns.setGlobalPaused) ns.setGlobalPaused = (p) => { ns.isPaused = p }
  const cache = ns.videoCache || (ns.videoCache = new Map())
  const load = async (src, muted) => {
    let v = cache.get(src)
    if (v) return v
    v = document.createElement('video')
    v.src = src
    v.crossOrigin = 'anonymous'
    v.muted = muted
    v.playsInline = true
    v.preload = 'auto'
    await new Promise((res, rej) => {
      v.oncanplay = () => res()
      // The MediaError rides along: code 4 is an unreadable/unsupported source
      // (a dead blob URL, a 404), code 3 a decode failure, code 2 a network
      // stall. A bare "failed to load" gave the fleet log nothing to act on.
      v.onerror = () => rej(new Error('[voila] video failed to load' + (v.error ? ' (' + v.error.code + (v.error.message ? ': ' + v.error.message : '') + ')' : '')))
      v.load()
    })
    cache.set(src, v)
    return v
  }
  const loadImage = (src) => {
    const hit = cache.get(src)
    if (hit) return Promise.resolve(hit)
    return new Promise((res, rej) => {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => { cache.set(src, img); res(img) }
      img.onerror = () => rej(new Error('[voila] image failed to load'))
      img.src = src
    })
  }
  // Text-overlay fonts (compositor v2): the house faces from the CDN, loaded
  // ONLY when the doc has overlays. Awaiting here means the first captured frame
  // already has the faces (preview/export parity). Capped + fail-open: a CDN
  // failure degrades to the stack's system fallbacks, never a dead LOAD.
  const olv = ctx.data.overlays
  if (olv && olv.length && typeof FontFace !== 'undefined') {
    try {
      const faces = ctx.data.overlayFonts || ${JSON.stringify(OVERLAY_FONT_FACES)}
      const loads = faces.map((f) => {
        const ff = new FontFace(f.family, 'url(' + f.url + ')', { weight: String(f.weight) })
        document.fonts.add(ff)
        return ff.load()
      })
      await Promise.race([
        Promise.all(loads).catch(() => {}),
        new Promise((res) => setTimeout(res, 4000)),
      ])
    } catch (e) { console.warn('[voila] overlay fonts failed to load', e) }
  }
  // Media overlays (V1b): warm-load through the shared cache so the first
  // frame draws complete. Fail-open per clip (a bad key just doesn't draw).
  for (const oc of (ctx.data.overlays || [])) {
    if (oc.kind !== 'image' && oc.kind !== 'video') continue
    try {
      if (oc.kind === 'image') await loadImage(oc.key)
      else await load(oc.key, true)
    } catch (e) { console.warn('[voila] overlay media failed to load', oc.key, e) }
  }
  // GLB object assets (V3b): load via the engine's GLTFLoader addon into a
  // shared cache, bbox-NORMALIZED (norm = 1/maxDim) so transform3d.scale means
  // the same thing for every model. Fail-open per key — a bad model just
  // doesn't render (the prop pool skips unloaded keys).
  const objs = ctx.data.objects || []
  const objCache = ns.objCache || (ns.objCache = new Map())
  for (const oc of objs) {
    if (!oc.asset || oc.asset.kind !== 'gltf' || !oc.asset.key || objCache.has(oc.asset.key)) continue
    try {
      const GL = ctx.loaders && ctx.loaders.GLTFLoader
      if (!GL) { console.warn('[voila] GLTFLoader unavailable'); continue }
      const gltf = await new Promise((res, rej) => new GL().load(oc.asset.key, res, undefined, rej))
      const box = new ctx.THREE.Box3().setFromObject(gltf.scene)
      const size = new ctx.THREE.Vector3()
      box.getSize(size)
      const center = new ctx.THREE.Vector3()
      box.getCenter(center)
      const maxDim = Math.max(size.x, size.y, size.z) || 1
      objCache.set(oc.asset.key, { scene: gltf.scene, norm: 1 / maxDim, center: center })
    } catch (e) { console.warn('[voila] glb failed to load', oc.asset.key, e) }
  }
  // 3D-text typefaces: FontLoader JSONs into a shared cache, keyed by
  // URL. Awaited here so frame 0 is complete on cold loads (export/chunk
  // parity); live SET_DATA additions lazy-load in ON_FRAME instead. Fail-open
  // per URL — the prop pool skips unloaded typefaces.
  const fontCache = ns.fontCache || (ns.fontCache = new Map())
  for (const oc of objs) {
    if (!oc.asset || oc.asset.kind !== 'text3d' || !oc.asset.url || fontCache.has(oc.asset.url)) continue
    try {
      const FL = ctx.loaders && ctx.loaders.FontLoader
      if (!FL) { console.warn('[voila] FontLoader unavailable'); continue }
      const font = await new Promise((res, rej) => new FL().load(oc.asset.url, res, undefined, rej))
      fontCache.set(oc.asset.url, font)
    } catch (e) { console.warn('[voila] typeface failed to load', oc.asset.url, e) }
  }
  // Audio clips (music/SFX): pre-decode into a shared cache so first play is
  // instant. The AudioContext starts suspended (autoplay policy) — onFrame
  // resumes it on the first play. Failures degrade to a silent clip.
  const clips = ctx.data.audio || []
  if (clips.length && window.AudioContext) {
    const actx = ns.audioCtx || (ns.audioCtx = new window.AudioContext())
    const bufs = ns.audioBuffers || (ns.audioBuffers = new Map())
    const pend = ns.audioPending || (ns.audioPending = new Set())
    await Promise.all(clips.map(async (c) => {
      if (bufs.has(c.key) || pend.has(c.key)) return
      pend.add(c.key)
      try {
        const res = await fetch(c.key)
        bufs.set(c.key, await actx.decodeAudioData(await res.arrayBuffer()))
      } catch (e) {
        console.warn('[voila] audio decode failed', c.key, e)
      } finally {
        pend.delete(c.key)
      }
    }))
  }
}`

export const STUDIO_CONTENT = `(ctx) => {
  const THREE = ctx.THREE
  const gl = ctx.renderer && ctx.renderer.domElement
  const res = ctx.resolution
  const W0 = Math.max(2, Math.floor((gl && gl.width) || res.drawingBufferWidth || res.width || 1280))
  const H0 = Math.max(2, Math.floor((gl && gl.height) || res.drawingBufferHeight || res.height || 720))
  // The overlay layer: one canvas on a plane that fills the engine's 2D
  // overlay camera, above every element and every 3D group.
  const canvas = document.createElement('canvas')
  canvas.width = W0
  canvas.height = H0
  const c2d = canvas.getContext('2d')
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.generateMipmaps = false
  const ocam = ctx.overlayCamera
  const pw = ocam ? ocam.right - ocam.left : W0
  const ph = ocam ? ocam.top - ocam.bottom : H0
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(pw, ph),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false })
  )
  mesh.frustumCulled = false
  mesh.renderOrder = 1e6
  ;(ctx.overlayScene || ctx.scene).add(mesh)
  // Object clips: a world-space group (per-mesh renderOrder 1.5; meshes
  // depth-test among THEMSELVES). Lights only where the data asks: the
  // recording anchor's card program has none of its own.
  const objGroup = new THREE.Group()
  ctx.scene.add(objGroup)
  const objects = [mesh, objGroup]
  if (ctx.data && ctx.data.lights) {
    const amb = new THREE.AmbientLight(0xffffff, 0.75)
    const dir = new THREE.DirectionalLight(0xffffff, 1.4)
    dir.position.set(2, 3, 4)
    ctx.scene.add(amb)
    ctx.scene.add(dir)
    objects.push(amb, dir)
  }
  return {
    objects: objects,
    refs: {
      ov: { canvas: canvas, c2d: c2d, texture: texture, mesh: mesh, pw: pw, ph: ph },
      objects: { group: objGroup, pool: new Map() },
    },
  }
}`

// The studio compositor. Deterministic: a pure function of ctx.time (the
// OUTPUT clock) + this entry's ctx.data. One `var` scope, ol*/ob* prefixed.
export const STUDIO_FRAME = `(ctx, content, dt) => {
  var r = content.refs
  // Stub-context tests build only the flat { c2d, canvas, texture }: fall
  // back to it like the card program does, so they drive this entry too.
  var ov = r.ov || r
  if (!ov || !ov.c2d) return
  var ovC = ov.c2d
  var res = ctx.resolution
  var gl = ctx.renderer && ctx.renderer.domElement
  var W = Math.max(2, Math.floor((gl && gl.width) || res.drawingBufferWidth || res.width || ov.canvas.width))
  var H = Math.max(2, Math.floor((gl && gl.height) || res.drawingBufferHeight || res.height || ov.canvas.height))
  // Resize: the backing canvas follows the renderer (dispose the texture so
  // THREE reallocates at the new dims), the plane follows the overlay camera.
  if (ov.canvas.width !== W || ov.canvas.height !== H) {
    ov.canvas.width = W; ov.canvas.height = H
    if (ov.texture && ov.texture.dispose) ov.texture.dispose()
    ov.sig = null
  }
  var ocam = ctx.overlayCamera
  if (ocam && ov.mesh && ctx.THREE) {
    var opw = ocam.right - ocam.left, oph = ocam.top - ocam.bottom
    if (opw !== ov.pw || oph !== ov.ph) {
      if (ov.mesh.geometry && ov.mesh.geometry.dispose) ov.mesh.geometry.dispose()
      ov.mesh.geometry = new ctx.THREE.PlaneGeometry(opw, oph)
      ov.pw = opw; ov.ph = oph
    }
  }
  var d = ctx.data || {}
  var TL = globalThis.__vosTimeline
  var t = ctx.time || 0
  var s = H / 1080 // scale design-px controls to comp px
  var ns = window.__vos__ || {}
  var playing = ns.isPaused === false

  // --- audio clips (music/SFX): Web Audio scheduler against the transport ---
  // Buffer sources are one-shot: (re)schedule everything on play / clip-data change
  // (SET_DATA) / drift; kill everything on pause. Seeks arrive paused (bridge forces
  // it), so scrubbing is silent like the video seek path. Export forces isPaused=true,
  // so none of this runs there — the export mixes offline from the same env points.
  var clips = d.audio || []
  var actx = ns.audioCtx
  if (!actx && clips.length && window.AudioContext) actx = ns.audioCtx = new window.AudioContext()
  if (actx) {
    var AS = ns.audioSched || (ns.audioSched = { on: false, nodes: [], sig: '', t0: 0, at0: 0, last: 0 })
    var bufs = ns.audioBuffers || (ns.audioBuffers = new Map())
    var pend = ns.audioPending || (ns.audioPending = new Set())
    // Clips added after LOAD (SET_DATA) decode lazily; completion clears the
    // signature so the next playing frame reschedules with the new buffer.
    for (var di = 0; di < clips.length; di++) {
      ;(function (cc) {
        if (bufs.has(cc.key) || pend.has(cc.key)) return
        pend.add(cc.key)
        fetch(cc.key)
          .then(function (res) { return res.arrayBuffer() })
          .then(function (ab) { return actx.decodeAudioData(ab) })
          .then(function (b) { bufs.set(cc.key, b); AS.sig = '' })
          .catch(function (e) { console.warn('[voila] audio decode failed', cc.key, e) })
          .then(function () { pend.delete(cc.key) })
      })(clips[di])
    }
    // Duck multiplier curve (output-time points, merged in by useComposition).
    var dEnv = d.duckEnv || []
    // Cheap change signature for the duck curve (full stringify would run 60×/s
    // over hundreds of points) — length + endpoints tracks every real change.
    var dSig = dEnv.length ? dEnv.length + ':' + dEnv[0].g + ',' + dEnv[dEnv.length - 1].t + ',' + dEnv[dEnv.length - 1].g : '0'
    var sig = JSON.stringify(clips) + '#' + dSig
    // Envelope value at output time tt (linear interp; def outside/empty).
    var auEnvAt = function (env, tt, def) {
      if (!env.length) return def
      if (tt <= env[0].t) return env[0].g
      if (tt >= env[env.length - 1].t) return env[env.length - 1].g
      for (var ii = 1; ii < env.length; ii++) {
        if (tt <= env[ii].t) {
          var A = env[ii - 1], B = env[ii]
          return A.g + (B.g - A.g) * ((tt - A.t) / Math.max(1e-9, B.t - A.t))
        }
      }
      return def
    }
    var kill = function () {
      for (var ki = 0; ki < AS.nodes.length; ki++) {
        try { if (AS.nodes[ki].stop) AS.nodes[ki].stop() } catch (e) {}
        try { AS.nodes[ki].disconnect() } catch (e) {}
      }
      AS.nodes = []
    }
    var drift = AS.on ? Math.abs((actx.currentTime - AS.at0) - (t - AS.t0)) : 0
    if (!playing && AS.on) { kill(); AS.on = false }
    var needSched = playing && (!AS.on || sig !== AS.sig ||
      (drift > 0.08 && actx.currentTime - AS.last > 0.25))
    if (needSched) {
      kill()
      if (actx.state === 'suspended') { try { actx.resume() } catch (e) {} }
      var now = actx.currentTime
      AS.on = true; AS.sig = sig; AS.t0 = t; AS.at0 = now; AS.last = now
      // NOTE: ON_FRAME is one var scope — locals here are prefixed (au*) so they
      // can't shadow the compositor's c/cur/etc used later in the function.
      for (var ai = 0; ai < clips.length; ai++) {
        var au = clips[ai]
        var auSpan = au.out - au.in
        var auLen = au.len || auSpan
        var auEnd = au.start + auLen
        if (auSpan <= 0 || auEnd <= t + 0.001) continue
        var auBuf = bufs.get(au.key)
        if (!auBuf) continue
        var auSrc = actx.createBufferSource()
        auSrc.buffer = auBuf
        var auGain = actx.createGain()
        auSrc.connect(auGain)
        var auTail = auGain
        // Duck under speech: a second gain stage driven by the shared curve.
        if (au.duck && dEnv.length) {
          var auDuck = actx.createGain()
          auGain.connect(auDuck); auDuck.connect(actx.destination)
          auDuck.gain.setValueAtTime(auEnvAt(dEnv, t, 1), now)
          for (var qi = 0; qi < dEnv.length; qi++) {
            if (dEnv[qi].t > t && dEnv[qi].t <= auEnd) auDuck.gain.linearRampToValueAtTime(dEnv[qi].g, now + (dEnv[qi].t - t))
          }
          auTail = auDuck
        } else {
          auGain.connect(actx.destination)
        }
        // Envelope points (output-time, baked by the lowering) → audio-clock times.
        var env = au.env || []
        auGain.gain.setValueAtTime(auEnvAt(env, t, au.gain != null ? au.gain : 1), now)
        for (var ri = 0; ri < env.length; ri++) {
          if (env[ri].t > t) auGain.gain.linearRampToValueAtTime(env[ri].g, now + (env[ri].t - t))
        }
        // Looping: native Web Audio loop over the source span fills the placed length.
        var auOff = au.in + Math.max(0, t - au.start)
        if (au.loop) {
          auSrc.loop = true
          auSrc.loopStart = au.in
          auSrc.loopEnd = au.out
          auOff = au.in + (Math.max(0, t - au.start) % auSpan)
        }
        auSrc.start(now + Math.max(0, au.start - t), auOff, auEnd - Math.max(t, au.start))
        AS.nodes.push(auSrc); AS.nodes.push(auGain); if (auTail !== auGain) AS.nodes.push(auTail)
      }
    }
  }

  function rr(x, y, w, h, rd, cx) {
    var cc = cx || ovC
    if (cc.roundRect) { cc.beginPath(); cc.roundRect(x, y, w, h, rd) }
    else { cc.beginPath(); cc.rect(x, y, w, h) }
  }

  // Text overlays: visibility signature + "a transition is animating".
  // During a hold the drawn pixels are static, so the signature alone drives
  // redraws (position/text/style edits change it — live SET_DATA); during
  // enter/exit windows alpha/offset change per-frame, so olAnim forces redraw.
  var ols = d.overlays || []
  var olTD = ${OVERLAY_TRANSITION_DUR}
  var olAnim = false, olVisSig = ''
  for (var oi = 0; oi < ols.length; oi++) {
    var ol0 = ols[oi]
    if (t < ol0.start || t > ol0.start + ol0.dur) continue
    olVisSig += ol0.id + ':' + (ol0.text || ol0.key) + ':' + ol0.x + ',' + ol0.y + ',' + ol0.scale + ',' + ol0.rot + ',' + (ol0.fs || ol0.w) + ',' + (ol0.color || ol0.radius) + ',' + (ol0.opacity == null ? 1 : ol0.opacity) + (ol0.fx ? ',' + ol0.fx.k + ol0.fx.u + ol0.fx.d + ol0.fx.st : '') + (ol0.mw ? ',w' + ol0.mw : '') + ';'
    // fx widens the entrance window to the whole staggered span (tt);
    // without fx it is the legacy enter transition window.
    var olEW = ol0.fx ? ol0.fx.tt : olTD
    if (t < ol0.start + olEW || t > ol0.start + ol0.dur - olTD) olAnim = true
    // Pose keyframes: a clip with a motion track animates its transform
    // over its whole life, so it must repaint every visible frame — the
    // signature alone would freeze it between edits (the olVisSig trap).
    if (ol0.track) olAnim = true
    // Video overlays advance every frame; images redraw until decoded.
    if (ol0.kind === 'video') olAnim = true
    else if (ol0.kind === 'image') {
      var olEl0 = ns.videoCache && ns.videoCache.get(ol0.key)
      if (!(olEl0 && olEl0.complete && olEl0.naturalWidth)) olAnim = true
    }
  }
  var ovSig = W + 'x' + H + '|' + olVisSig
  var ovDirty = ov.sig !== ovSig || ov.active || olAnim
  if (ovDirty) {
  ovC.clearRect(0, 0, W, H)
  // --- text overlays (compositor v2): OUTPUT-anchored clips, styles resolved
  // at lowering (fs/weight/stack/color/shadow are plain values — no registry),
  // drawn ABOVE the cam bubble in screen space. Enter/exit are pure f(t): fade
  // and rise over the transition window; center-anchored multi-line text with a
  // legibility shadow. ol.x/ol.y are FRACTIONS of the frame [0..1] (the zoom
  // cx/cy convention) so positions survive aspect-ratio changes; font size is
  // design px × s (H-relative — stable across aspects). Geometry MIRRORS
  // overlayText.ts overlayRect/overlayFontString (change together — the
  // on-canvas picking depends on it). Locals ol-prefixed (one var scope).
  for (var oj = 0; oj < ols.length; oj++) {
    var ol = ols[oj]
    var olT = t - ol.start
    if (olT < 0 || olT > ol.dur) continue
    var olA = 1, olYof = 0, olScl = 1, olBlur = 0
    if (ol.fx && ol.fx.u === 'block') {
      // fx owns the entrance; block unit = the legacy presets generalized
      // (fade/rise identical math, plus pop/blur/typewriter at clip level).
      if (olT < ol.fx.dur && ol.fx.k !== 'typewriter') {
        var olU2 = Math.max(0, olT / ol.fx.dur)
        var olE2 = 1 - Math.pow(1 - olU2, 3)
        if (ol.fx.k === 'pop') {
          olA = Math.min(1, olU2 * 2)
          // easeOutBack on the RAW progress (olE2 is already eased).
          olScl = 1 + 2.70158 * Math.pow(olU2 - 1, 3) + 1.70158 * Math.pow(olU2 - 1, 2)
        } else {
          olA = olE2
          if (ol.fx.k === 'rise') olYof = (1 - olE2) * 24 * s
          if (ol.fx.k === 'blur') olBlur = (1 - olE2) * ol.fs * ol.scale * s * 0.12
        }
      }
      if (ol.fx.k === 'typewriter' && olT < ol.fx.dur) olA = 0
    } else if (!ol.fx && ol.enter !== 'none' && olT < olTD) {
      var olU = olT / olTD
      olU = 1 - Math.pow(1 - olU, 3)
      olA = olU
      if (ol.enter === 'rise') olYof = (1 - olU) * 24 * s
    }
    if (ol.exit !== 'none' && ol.dur - olT < olTD) {
      var olV = (ol.dur - olT) / olTD
      olV = 1 - Math.pow(1 - olV, 3)
      olA = Math.min(olA, olV)
      if (ol.exit === 'rise') olYof = -(1 - olV) * 24 * s
    }
    // Pose keyframes: sample the clip-local [x, y, scale, rot, opacity]
    // track at olT; absent = the static transform. Pose opacity is a
    // MULTIPLIER on the entrance/exit alpha.
    var olPose = null
    if (ol.track && ol.track.keyframes && ol.track.keyframes.length) olPose = TL.sample(ol.track, olT, TL.lerpArray)
    var olMX = olPose ? olPose[0] : ol.x
    var olMY = olPose ? olPose[1] : ol.y
    var olMS = olPose ? olPose[2] : ol.scale
    var olMR = olPose ? olPose[3] : ol.rot
    if (olPose) olA *= Math.max(0, Math.min(1, olPose[4]))
    if (olA <= 0.004) continue
    if (ol.kind === 'image' || ol.kind === 'video') {
      // Media overlay: lazy-acquire through the shared cache (SET_DATA-added
      // clips load without a LOAD — the backgroundMedia pattern), sync video
      // to CLIP-LOCAL time (pure f(t)), draw a rounded media card centered on
      // the fraction anchor. Muted always — soundtracks belong to doc.audio.
      var olEl = ns.videoCache ? ns.videoCache.get(ol.key) : null
      if (!olEl && ns.videoCache) {
        if (ol.kind === 'image') {
          olEl = new Image()
          olEl.crossOrigin = 'anonymous'
          olEl.src = ol.key
        } else {
          olEl = document.createElement('video')
          olEl.crossOrigin = 'anonymous'
          olEl.muted = true
          olEl.playsInline = true
          olEl.preload = 'auto'
          olEl.src = ol.key
          olEl.load()
        }
        ns.videoCache.set(ol.key, olEl)
      }
      if (!olEl) continue
      var olIsImg = ol.kind === 'image'
      if (!olIsImg && olEl.play) {
        var olDur = olEl.duration || 0
        var olMT = olT
        if (ol.loop && olDur > 0) olMT = olT % olDur
        else if (olDur > 0) olMT = Math.min(olT, olDur - 0.001)
        try {
          if (playing) {
            if (olEl.playbackRate !== 1) olEl.playbackRate = 1
            var olDrift = Math.abs(olEl.currentTime - olMT)
            if (olDur > 0 && !olEl.seeking && olDrift > 0.3 && (!ol.loop || olDur - olDrift > 0.3)) olEl.currentTime = olMT
            if (!ol.loop && olDur > 0 && olT >= olDur) { if (!olEl.paused) olEl.pause() }
            else if (olEl.paused) { var olP = olEl.play(); if (olP && olP.catch) olP.catch(function () {}) }
          } else {
            if (!olEl.paused) olEl.pause()
            var olTarget = Math.min(olMT, olEl.duration || olMT)
            // Coalesce scrub seeks (the backgroundMedia pattern): re-assigning
            // currentTime aborts the in-flight seek, so a per-frame scrub keeps
            // a remote source seeking forever. Defer until 'seeked' lands.
            if (olEl.readyState >= 1 && !olEl.seeking && Math.abs(olEl.currentTime - olTarget) > 0.02) {
              if (ns.pendingDecodes) {
                var olDp = new Promise(function (resolve) {
                  var olDone = function () { olEl.removeEventListener('seeked', olDone); resolve() }
                  olEl.addEventListener('seeked', olDone)
                  setTimeout(olDone, 250)
                })
                ns.pendingDecodes.add(olDp)
                olDp.finally(function () { ns.pendingDecodes.delete(olDp) })
              }
              olEl.currentTime = olTarget
            }
          }
        } catch (e) {}
      }
      // Video readiness is STICKY through seeks (the cam-bubble pattern):
      // readyState dips below HAVE_CURRENT_DATA while a scrub seek is in
      // flight, and this layer repaints every frame a video clip is visible —
      // gating each frame on it would blink the clip out for the whole drag.
      // After the first decoded frame, keep drawing: Chrome paints the
      // element's retained frame mid-seek.
      if (!olIsImg && olEl.readyState >= 2) olEl.__vosHasFrame = true
      var olReady = olIsImg ? !!(olEl.complete && olEl.naturalWidth) : !!(olEl.readyState >= 2 || olEl.__vosHasFrame)
      if (!olReady) continue
      var olNW = (olIsImg ? olEl.naturalWidth : olEl.videoWidth) || 16
      var olNH = (olIsImg ? olEl.naturalHeight : olEl.videoHeight) || 9
      var olDW = ol.w * W * olMS
      var olDH = olDW * (olNH / olNW)
      var olRad = Math.min((ol.radius || 0) * s, olDH / 2)
      ovC.save()
      ovC.globalAlpha = olA * (ol.opacity == null ? 1 : ol.opacity)
      ovC.translate(olMX * W, olMY * H + olYof)
      if (olMR) ovC.rotate(olMR * Math.PI / 180)
      // Card shadow (absent = 'soft', the baked look docs predating the field render;
      // 'strong' floats harder; 'none' is the flat cutout), then the media
      // clipped to rounded corners, then an optional border stroke drawn
      // OVER the edge — outside the clip, or half the stroke vanishes.
      var olShadow = ol.shadow || 'soft'
      if (olShadow !== 'none') {
        ovC.save()
        ovC.shadowColor = olShadow === 'strong' ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.35)'
        ovC.shadowBlur = (olShadow === 'strong' ? 48 : 24) * s
        ovC.shadowOffsetY = (olShadow === 'strong' ? 16 : 8) * s
        ovC.fillStyle = '#000'
        rr(-olDW / 2, -olDH / 2, olDW, olDH, olRad, ovC); ovC.fill()
        ovC.restore()
      }
      ovC.save()
      rr(-olDW / 2, -olDH / 2, olDW, olDH, olRad, ovC); ovC.clip()
      try { ovC.drawImage(olEl, -olDW / 2, -olDH / 2, olDW, olDH) } catch (e) {}
      ovC.restore()
      if (ol.border && ol.border.width > 0) {
        ovC.strokeStyle = ol.border.color || '#ffffff'
        ovC.lineWidth = ol.border.width * s
        rr(-olDW / 2, -olDH / 2, olDW, olDH, olRad, ovC); ovC.stroke()
      }
      ovC.restore()
      continue
    }
    var olPx = ol.fs * olMS * s
    // Live style edits: SET_DATA never re-runs SETUP, so an override face
    // arriving mid-session lazy-loads here (fail-open; frames repaint as it
    // lands). Cold loads (export) awaited the full list in SETUP already.
    if (ol.face && typeof FontFace !== 'undefined') {
      var ofSet = window.__voilaFontSet || (window.__voilaFontSet = {})
      var ofKey = ol.face.f + '|' + ol.face.w
      if (!ofSet[ofKey]) {
        ofSet[ofKey] = 1
        try {
          var ofFace = new FontFace(ol.face.f, 'url(' + ol.face.u + ')', { weight: String(ol.face.w) })
          document.fonts.add(ofFace)
          ofFace.load().catch(function () {})
        } catch (e) {}
      }
    }
    ovC.save()
    ovC.globalAlpha = olA
    ovC.translate(olMX * W, olMY * H + olYof)
    if (olMR) ovC.rotate(olMR * Math.PI / 180)
    // Block-unit fx entrance (pop scale / blur) — clip-level, about the anchor.
    if (olScl !== 1) ovC.scale(olScl, olScl)
    if (olBlur > 0.05) ovC.filter = 'blur(' + olBlur.toFixed(2) + 'px)'
    // Style overrides ride ctx.data (sty/ls/lh/align/stroke baked only when
    // non-default — parity — but READ unconditionally: every knob is a live
    // SET_DATA by construction).
    ovC.font = (ol.sty ? ol.sty + ' ' : '') + ol.weight + ' ' + olPx + 'px ' + ol.stack
    ovC.textAlign = 'center'
    ovC.textBaseline = 'middle'
    ovC.letterSpacing = ((ol.ls || 0) * olMS * s) + 'px'
    var olLines = ol.lines || ['']
    // maxWidth wrap (ol.mw = frame-width fraction): greedy over word tokens
    // (/\\S+\\s*/ — the SAME tokenization fx uses, trailing spaces kept, so
    // unit sequences stay byte-identical) at measured widths. MIRRORS
    // wrapOverlayLines in overlayText.ts — change together. A token wider
    // than the budget gets its own line; explicit \\n lines wrap independently.
    if (ol.mw) {
      var olWMax = ol.mw * W
      var olWrapped = []
      for (var olwl = 0; olwl < olLines.length; olwl++) {
        var olWLine = olLines[olwl]
        if (!olWLine || ovC.measureText(olWLine).width <= olWMax) {
          olWrapped.push(olWLine)
          continue
        }
        var olToks = olWLine.match(/\\S+\\s*/g) || [olWLine]
        var olCur = ''
        for (var olti = 0; olti < olToks.length; olti++) {
          if (!olCur) { olCur = olToks[olti]; continue }
          if (ovC.measureText(olCur + olToks[olti]).width <= olWMax) {
            olCur += olToks[olti]
          } else {
            olWrapped.push(olCur)
            olCur = olToks[olti]
          }
        }
        if (olCur) olWrapped.push(olCur)
      }
      olLines = olWrapped.length ? olWrapped : ['']
    }
    var olLH = olPx * (ol.lh || ${OVERLAY_LINE_HEIGHT})
    var olY0 = -((olLines.length - 1) * olLH) / 2
    // Per-line widths: needed by the pill, by left/right alignment (lines
    // draw centered; alignment is an x offset against the widest line), and
    // by per-unit fx (units place by prefix advance from the line's left edge).
    var olFx = ol.fx && ol.fx.units.length ? ol.fx : null
    // With wrap active, baked per-line unit arrays regroup onto the WRAPPED
    // lines. Wrapping never reorders: word/char units consume in flat order
    // by string length (wrapped lines are token concatenations); 'line'
    // units become one per wrapped line. Flat delay order is unchanged.
    if (olFx && ol.mw) {
      var olFlat = []
      for (var olfi = 0; olfi < olFx.units.length; olfi++) {
        for (var olfj = 0; olfj < olFx.units[olfi].length; olfj++) {
          olFlat.push(olFx.units[olfi][olfj])
        }
      }
      var olRe = []
      if (olFx.u === 'line') {
        for (var olri = 0; olri < olLines.length; olri++) olRe.push([olLines[olri]])
      } else {
        var olFk = 0
        for (var olri2 = 0; olri2 < olLines.length; olri2++) {
          var olNeed = olLines[olri2].length
          var olArr = []
          var olGot = 0
          while (olFk < olFlat.length && olGot < olNeed) {
            olArr.push(olFlat[olFk])
            olGot += olFlat[olFk].length
            olFk++
          }
          olRe.push(olArr)
        }
      }
      var olReN = 0
      for (var olrn = 0; olrn < olRe.length; olrn++) olReN += olRe[olrn].length
      olFx = { k: olFx.k, u: olFx.u, d: olFx.d, st: olFx.st, dur: olFx.dur, tt: olFx.tt, units: olRe, n: olReN }
    }
    var olLWs = null, olMaxW = 0
    if (ol.box || ol.align || olFx) {
      olLWs = []
      for (var olwi = 0; olwi < olLines.length; olwi++) {
        var olw = ovC.measureText(olLines[olwi]).width
        olLWs.push(olw)
        if (olw > olMaxW) olMaxW = olw
      }
    }
    // Background pill (ol.box, baked design px at fs): drawn BEFORE the text
    // and before the legibility shadow config, so the pill never inherits the
    // text shadow. Geometry mirrors overlayRect's inflation — change together.
    if (ol.box) {
      var obPX = ol.box.px * olMS * s
      var obPY = ol.box.py * olMS * s
      var obFullW = olMaxW + obPX * 2
      var obFullH = olLines.length * olLH + obPY * 2
      var obR = Math.min(ol.box.r * olMS * s, obFullH / 2)
      ovC.save()
      ovC.globalAlpha = olA * ol.box.o
      ovC.fillStyle = ol.box.c
      rr(-obFullW / 2, -obFullH / 2, obFullW, obFullH, obR, ovC)
      ovC.fill()
      ovC.restore()
    }
    if (ol.shadow > 0) {
      ovC.shadowColor = 'rgba(0,0,0,' + ol.shadow + ')'
      ovC.shadowBlur = olPx * 0.25
      ovC.shadowOffsetY = olPx * 0.04
    }
    ovC.fillStyle = ol.color
    if (!olFx) {
      for (var ok = 0; ok < olLines.length; ok++) {
        var olXof = 0
        if (ol.align && olLWs) {
          olXof = ol.align === 'left'
            ? (olLWs[ok] - olMaxW) / 2
            : (olMaxW - olLWs[ok]) / 2
        }
        var olLY = olY0 + ok * olLH
        if (ol.stroke) {
          ovC.strokeStyle = ol.stroke.c
          ovC.lineWidth = ol.stroke.w * olMS * s
          ovC.lineJoin = 'round'
          ovC.strokeText(olLines[ok], olXof, olLY)
        }
        ovC.fillText(olLines[ok], olXof, olLY)
      }
    } else {
      // Per-unit entrance: units draw LEFT-aligned at prefix advances
      // measured from the full line (exact bar cross-unit kerning), so the
      // settled frame matches the non-fx layout. Per-unit progress is pure
      // f(t): delay = order(index)·st, eased over dur; typewriter is a step
      // reveal. Stroke-under-fill per unit; pill/shadow config above apply.
      ovC.textAlign = 'left'
      var olIdx = 0
      for (var ok2 = 0; ok2 < olFx.units.length; ok2++) {
        var olUs = olFx.units[ok2]
        var olLW2 = olLWs ? olLWs[ok2] : 0
        var olLY2 = olY0 + ok2 * olLH
        var olXof2 = 0
        if (ol.align) {
          olXof2 = ol.align === 'left'
            ? (olLW2 - olMaxW) / 2
            : (olMaxW - olLW2) / 2
        }
        var olXb = olXof2 - olLW2 / 2
        var olPref = '', olPW = 0
        for (var ou = 0; ou < olUs.length; ou++, olIdx++) {
          var olOrd = olFx.d === 1
            ? (olFx.n - 1 - olIdx)
            : olFx.d === 2
              ? Math.abs(olIdx - (olFx.n - 1) / 2)
              : olIdx
          var olT2 = olT - olOrd * olFx.st
          var olNext = olPref + olUs[ou]
          var olNW = ovC.measureText(olNext).width
          var olUW = olNW - olPW
          var olUX = olXb + olPW
          var olUA = 1, olUu = 1
          if (olFx.k === 'typewriter') {
            olUA = olT2 >= 0 ? 1 : 0
          } else {
            olUu = Math.max(0, Math.min(1, olT2 / olFx.dur))
            var olUE = 1 - Math.pow(1 - olUu, 3)
            olUA = olFx.k === 'pop' ? Math.min(1, olUu * 2) : olUE
          }
          var olUnit = olUs[ou]
          olPref = olNext
          olPW = olNW
          if (olUA <= 0.004) continue
          ovC.save()
          ovC.globalAlpha = olA * olUA
          if (olUu < 1) {
            if (olFx.k === 'rise') {
              ovC.translate(0, (1 - (1 - Math.pow(1 - olUu, 3))) * 24 * s)
            } else if (olFx.k === 'pop') {
              var olPS = 1 + 2.70158 * Math.pow(olUu - 1, 3) + 1.70158 * Math.pow(olUu - 1, 2)
              ovC.translate(olUX + olUW / 2, olLY2)
              ovC.scale(olPS, olPS)
              ovC.translate(-(olUX + olUW / 2), -olLY2)
            } else if (olFx.k === 'blur') {
              ovC.filter = 'blur(' + ((1 - olUu) * olPx * 0.12).toFixed(2) + 'px)'
            }
          }
          if (ol.stroke) {
            ovC.strokeStyle = ol.stroke.c
            ovC.lineWidth = ol.stroke.w * olMS * s
            ovC.lineJoin = 'round'
            ovC.strokeText(olUnit, olUX, olLY2)
          }
          ovC.fillText(olUnit, olUX, olLY2)
          ovC.restore()
        }
      }
    }
    ovC.restore()
  }
  ov.sig = ovSig
  ov.active = olVisSig !== ''
  if (ov.texture) ov.texture.needsUpdate = true
  }

  // --- object clips: reconcile a mesh pool against d.objects — the
  // interpreter pattern in 3D. Add/remove/asset-change are live SET_DATA
  // (create/dispose here); transforms + span fades + animation are pure f(t).
  // Frame-fraction position maps onto the frustum plane at the object's depth
  // (stage.ts math); scale is a fraction of the frame height at the CARD depth
  // (closer objects render bigger — the perspective cue). Locals ob*.
  var obC = r.objects
  var THREE3 = ctx.THREE
  if (obC && obC.group && obC.pool && THREE3) {
    var obs = d.objects || []
    var obSeen = {}
    var obTan = Math.tan(${CARD_FOV} * Math.PI / 180 / 2)
    var obRefH = 2 * Math.abs(${CARD_Z}) * obTan // frame height at the reference depth
    var obAspect = W / H
    // The anchor's camera: a prop sits on THAT camera's frustum plane
    // at its depth, at the frame fraction it was placed at, so the host's
    // picking rect (the same fraction) holds on any anchor. The recording's
    // camera (the origin, looking down -z, CARD_FOV) reduces this to the
    // constants its card program shares; a user program's camera can be
    // anywhere, and its lights light the props. Scale stays "a fraction of
    // the frame height at the reference depth" because obRefH follows the
    // camera's fov.
    var obCam = ctx.camera && ctx.camera.isPerspectiveCamera && ctx.camera.quaternion ? ctx.camera : null
    // An ORTHOGRAPHIC anchor camera (a program's \`fullscreen\` preset is
    // OrthographicCamera(-1, 1, 1, -1, 0, 1); the generic ortho preset spans
    // width/zoom): the prop sits on the camera's own box at mid-depth, at the
    // frame fraction, scaled against the box's height. The perspective
    // constants put it metres behind a far plane of 1, which is how a prop on
    // a shader program drew its picking box and nothing else.
    var obOrtho = !obCam && ctx.camera && ctx.camera.isOrthographicCamera && ctx.camera.quaternion ? ctx.camera : null
    var obB = null
    if (obCam || obOrtho) {
      var obBCam = obCam || obOrtho
      obB = obC.basis || (obC.basis = { f: new THREE3.Vector3(), r: new THREE3.Vector3(), u: new THREE3.Vector3(), q: new THREE3.Quaternion(), e: new THREE3.Euler() })
      obB.f.set(0, 0, -1).applyQuaternion(obBCam.quaternion)
      obB.r.set(1, 0, 0).applyQuaternion(obBCam.quaternion)
      obB.u.set(0, 1, 0).applyQuaternion(obBCam.quaternion)
    }
    var obOW = 0, obOH = 0, obOCX = 0, obOCY = 0, obOD = 0
    if (obCam) {
      obTan = Math.tan(obCam.fov * Math.PI / 180 / 2)
      obRefH = 2 * Math.abs(${CARD_Z}) * obTan
    } else if (obOrtho) {
      var obOZ = obOrtho.zoom || 1
      obOW = (obOrtho.right - obOrtho.left) / obOZ
      obOH = (obOrtho.top - obOrtho.bottom) / obOZ
      obOCX = (obOrtho.right + obOrtho.left) / 2 / obOZ
      obOCY = (obOrtho.top + obOrtho.bottom) / 2 / obOZ
      obOD = obOrtho.near + (obOrtho.far - obOrtho.near) * 0.5
      obRefH = obOH
      // The box's units are not square on the canvas (the fullscreen preset
      // is -1..1 both ways over 16:9), so a sphere would draw as an ellipse.
      // The correction is a camera-space squash AFTER the prop's own
      // rotation: the group is aligned with the camera and scaled on its x
      // by the pixel aspect, and ortho props are placed in the group's
      // local space.
      var obAX = (obOW * H) / (obOH * W)
      obC.group.position.copy(obOrtho.position)
      obC.group.quaternion.copy(obOrtho.quaternion)
      obC.group.scale.set(obAX, 1, 1)
    }
    // A program's scene lights its own props, when it has lights at all: a
    // shader program has none, and an unlit MeshStandardMaterial is black.
    // Once, when the first prop appears: add the entry's pair only if no light
    // is in the scene (the recording's card program carries its own).
    if (obs.length && !obC.lit && ctx.scene && ctx.scene.traverse) {
      obC.lit = true
      var obHasLight = false
      ctx.scene.traverse(function (obN0) { if (obN0.isLight) obHasLight = true })
      if (!obHasLight) {
        var obAmb = new THREE3.AmbientLight(0xffffff, 0.75)
        var obDir = new THREE3.DirectionalLight(0xffffff, 1.4)
        obDir.position.set(2, 3, 4)
        obC.group.add(obAmb)
        obC.group.add(obDir)
      }
    }
    for (var bi = 0; bi < obs.length; bi++) {
      var ob = obs[bi]
      var obIsGltf = ob.asset.kind === 'gltf'
      var obIsT3 = ob.asset.kind === 'text3d'
      if (obIsGltf && !(ns.objCache && ns.objCache.get(ob.asset.key))) continue // not loaded (yet)
      if (obIsT3 && !(ns.fontCache && ns.fontCache.get(ob.asset.url))) {
        // Live SET_DATA additions never re-run SETUP — lazy-load the
        // typeface once (fail-open) and skip the clip until it lands.
        var obT3P = ns.fontPending || (ns.fontPending = {})
        if (!obT3P[ob.asset.url] && ctx.loaders && ctx.loaders.FontLoader) {
          obT3P[ob.asset.url] = 1
          try {
            new ctx.loaders.FontLoader().load(ob.asset.url, (function (obT3U) {
              return function (obT3F) {
                var obT3C = ns.fontCache || (ns.fontCache = new Map())
                obT3C.set(obT3U, obT3F)
              }
            })(ob.asset.url), undefined, function () {})
          } catch (e) {}
        }
        continue
      }
      obSeen[ob.id] = true
      var obSig = obIsGltf ? 'gltf|' + ob.asset.key
        : obIsT3 ? 'text3d|' + JSON.stringify(ob.asset)
        : ob.asset.shape + '|' + ob.asset.color
      var obE = obC.pool.get(ob.id)
      if (obE && obE.sig !== obSig) {
        obC.group.remove(obE.mesh)
        if (obE.mesh.traverse) obE.mesh.traverse(function (obN4) {
          if (obN4.geometry && obN4.geometry.dispose) obN4.geometry.dispose()
          if (obN4.material && obN4.material.dispose) obN4.material.dispose()
        })
        if (obE.mesh.geometry) obE.mesh.geometry.dispose()
        if (obE.mesh.material) obE.mesh.material.dispose()
        obE = null
      }
      if (!obE && obIsGltf) {
        // Clone the cached scene with CLONED materials (fade opacity must not
        // leak across instances); normalize scale via the cached bbox factor.
        var obSrc = ns.objCache.get(ob.asset.key)
        var obRoot = obSrc.scene.clone(true)
        obRoot.traverse(function (obN) {
          if (obN.isMesh) {
            obN.material = obN.material.clone()
            obN.material.transparent = true
            obN.renderOrder = 1.5
          }
        })
        obC.group.add(obRoot)
        obE = { mesh: obRoot, sig: obSig, norm: obSrc.norm, gltf: true }
        obC.pool.set(ob.id, obE)
      }
      if (!obE && obIsT3 && ctx.utils && ctx.utils.TextGeometry) {
        // Extruded text from the cached typeface. Geometry is centered and
        // bbox-normalized (norm = 1/maxDim, the GLB convention) so
        // transform3d.scale means the same thing for every asset kind.
        // Materials come pre-resolved from lowering (plain params, single-
        // sided by default — the SwiftShader-safe shape).
        var obT3Font = ns.fontCache.get(ob.asset.url)
        var obT3Geo = new ctx.utils.TextGeometry(ob.asset.text, {
          font: obT3Font,
          size: 1,
          depth: ob.asset.depth,
          curveSegments: 8,
          bevelEnabled: !!ob.asset.bevel,
          bevelThickness: 0.02,
          bevelSize: 0.015,
          bevelSegments: 2,
        })
        obT3Geo.computeBoundingBox()
        obT3Geo.center()
        var obT3Box = obT3Geo.boundingBox
        var obT3Max = Math.max(
          obT3Box.max.x - obT3Box.min.x,
          obT3Box.max.y - obT3Box.min.y,
          obT3Box.max.z - obT3Box.min.z,
        ) || 1
        var obT3Mat = ob.asset.mat.type === 'physical'
          ? new THREE3.MeshPhysicalMaterial(ob.asset.mat.params)
          : new THREE3.MeshStandardMaterial(ob.asset.mat.params)
        obT3Mat.transparent = true
        var obT3Mesh = new THREE3.Mesh(obT3Geo, obT3Mat)
        obT3Mesh.renderOrder = 1.5
        obC.group.add(obT3Mesh)
        // baseA: presets may be translucent (glass) — the span fade
        // multiplies onto it instead of stomping it to 1 during holds.
        obE = {
          mesh: obT3Mesh,
          sig: obSig,
          norm: 1 / obT3Max,
          baseA: ob.asset.mat.params.opacity == null ? 1 : ob.asset.mat.params.opacity,
        }
        obC.pool.set(ob.id, obE)
      }
      if (!obE && !obIsT3) {
        var obGeo = ob.asset.shape === 'sphere' ? new THREE3.SphereGeometry(0.55, 32, 20)
          : ob.asset.shape === 'torus' ? new THREE3.TorusGeometry(0.45, 0.18, 20, 40)
          : ob.asset.shape === 'knot' ? new THREE3.TorusKnotGeometry(0.4, 0.13, 80, 14)
          : new THREE3.BoxGeometry(0.9, 0.9, 0.9)
        var obMat = new THREE3.MeshStandardMaterial({
          color: ob.asset.color, metalness: 0.55, roughness: 0.35, transparent: true,
        })
        var obMesh = new THREE3.Mesh(obGeo, obMat)
        obMesh.renderOrder = 1.5
        obC.group.add(obMesh)
        obE = { mesh: obMesh, sig: obSig }
        obC.pool.set(ob.id, obE)
      }
      if (!obE) continue // text3d without the TextGeometry util — skip
      var obM = obE.mesh
      // Span gate with soft edge fades (OUTPUT-anchored, like overlays).
      var obA = 1
      if (ob.span) {
        var obT = t - ob.span.start
        if (obT < 0 || obT > ob.span.duration) { obM.visible = false; continue }
        var obTD = ${OVERLAY_TRANSITION_DUR}
        if (obT < obTD) obA = obT / obTD
        if (ob.span.duration - obT < obTD) obA = Math.min(obA, (ob.span.duration - obT) / obTD)
      }
      obM.visible = true
      if (obE.gltf) {
        var obA2 = obA
        obM.traverse(function (obN2) { if (obN2.isMesh) obN2.material.opacity = obA2 })
      } else {
        obM.material.opacity = obA * (obE.baseA == null ? 1 : obE.baseA)
      }
      // Pose keyframes: a clip-local [x,y,z,rx,ry,rz,scale] track over
      // the full 3D transform; spin/float presets compose ADDITIVELY on top
      // of the sampled pose (they are offsets, poses are the base).
      var obPose = null
      if (ob.track && ob.track.keyframes && ob.track.keyframes.length) obPose = TL.sample(ob.track, t - (ob.span ? ob.span.start : 0), TL.lerpArray)
      var obPX = obPose ? obPose[0] : ob.x
      var obPY = obPose ? obPose[1] : ob.y
      var obPZ = obPose ? obPose[2] : ob.z
      var obPRX = obPose ? obPose[3] : ob.rx
      var obPRY = obPose ? obPose[4] : ob.ry
      var obPRZ = obPose ? obPose[5] : ob.rz
      var obPS = obPose ? obPose[6] : ob.scale
      var obDist = Math.abs(${CARD_Z}) - obPZ // z is toward the camera
      var obPlaneH = 2 * obDist * obTan
      var obY = -(obPY - 0.5) * obPlaneH
      if (ob.anim === 'float') obY += Math.sin(t * (Math.PI * 2 / 5)) * obRefH * 0.012
      var obX = (obPX - 0.5) * obPlaneH * obAspect
      var obRy = obPRY * Math.PI / 180
      if (ob.anim === 'spin') obRy += t * 0.9
      if (obOrtho) {
        // Group-local (the group carries the camera pose and the aspect squash).
        obM.position.set((obOCX + (obPX - 0.5) * obOW) / obAX, obOCY - (obPY - 0.5) * obOH, -obOD)
        obB.e.set(obPRX * Math.PI / 180, obRy, obPRZ * Math.PI / 180)
        obM.quaternion.setFromEuler(obB.e)
      } else if (obB) {
        obM.position.copy(obCam.position).addScaledVector(obB.f, obDist).addScaledVector(obB.r, obX).addScaledVector(obB.u, obY)
        obB.e.set(obPRX * Math.PI / 180, obRy, obPRZ * Math.PI / 180)
        obM.quaternion.copy(obCam.quaternion).multiply(obB.q.setFromEuler(obB.e))
      } else {
        obM.position.set(obX, obY, ${CARD_Z} + obPZ)
        obM.rotation.set(obPRX * Math.PI / 180, obRy, obPRZ * Math.PI / 180)
      }
      obM.scale.setScalar(obPS * obRefH * (obE.norm || 1))
    }
    // Dispose props no longer in the data (live removal).
    obC.pool.forEach(function (obE2, obId) {
      if (!obSeen[obId]) {
        obC.group.remove(obE2.mesh)
        obE2.mesh.traverse
          ? obE2.mesh.traverse(function (obN3) {
              if (obN3.geometry && obN3.geometry.dispose) obN3.geometry.dispose()
              if (obN3.material && obN3.material.dispose) obN3.material.dispose()
            })
          : null
        if (obE2.mesh.geometry) obE2.mesh.geometry.dispose()
        if (obE2.mesh.material) obE2.mesh.material.dispose()
        obC.pool.delete(obId)
      }
    })
  }

}`
