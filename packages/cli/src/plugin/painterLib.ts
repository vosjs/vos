/**
 * The painter starter (`vos port scaffold`): the maths every port re-wrote,
 * as one block of plain JavaScript the scaffold writes into a program's
 * `createContent` and returns as `content.refs.lib`, so `createTimeline` and
 * `onFrame` share one definition. Written from the maths, never from another
 * engine's source:
 *
 * - `spring({ frame, fps, config, from, to, delay })`: a damped harmonic
 *   oscillator released from rest, solved in closed form (under-, critically
 *   and over-damped), with Remotion's signature and defaults (damping 10,
 *   mass 1, stiffness 100). Held to Remotion's own values in the tests.
 * - `springTo(tl, target, { key: [from, to] }, at, { fps, config, frames })`:
 *   a spring ON THE TIMELINE, as one linear step per frame, exact at every
 *   frame, because the tween dialect takes named eases only.
 * - `interpolate(input, inputRange, outputRange, { extrapolateLeft,
 *   extrapolateRight, easing })`: any number of stops.
 * - `bezier(x1, y1, x2, y2)`: an easing function (Remotion's `Easing.bezier`).
 * - `noise2D(seed, x, y)`, `noise3D(seed, x, y, z)`: seeded simplex noise in
 *   [-1, 1] (Gustavson's construction). The same character as
 *   `@remotion/noise`, not its values: a blob is matched by eye, never byte.
 * - `random(seed)` and `rng(seed)`: a seeded value and a seeded generator.
 */
export const PAINTER_LIB = `    // THE PAINTER STARTER (vos port): the maths every port re-wrote, in one
    // place: content.refs.lib in createTimeline and onFrame.
    const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)
    const hashSeed = (seed) => {
      if (typeof seed === 'number') return seed | 0
      let h = 2166136261
      for (const ch of String(seed)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
      return h | 0
    }
    const rng = (seed) => {
      let s = hashSeed(seed)
      return () => {
        s = (s + 0x6d2b79f5) | 0
        let r = Math.imul(s ^ (s >>> 15), 1 | s)
        r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r
        return ((r ^ (r >>> 14)) >>> 0) / 4294967296
      }
    }
    const random = (seed) => rng(seed)()
    // interpolate(input, [a, b, ...], [x, y, ...], { extrapolateLeft, extrapolateRight, easing })
    const interpolate = (input, inR, outR, opts = {}) => {
      let i = 1
      while (i < inR.length - 1 && input > inR[i]) i++
      const a = inR[i - 1], b = inR[i]
      let t = b === a ? 0 : (input - a) / (b - a)
      if (t < 0) {
        if (opts.extrapolateLeft === 'clamp') t = 0
        else if (opts.extrapolateLeft === 'identity') return input
      }
      if (t > 1) {
        if (opts.extrapolateRight === 'clamp') t = 1
        else if (opts.extrapolateRight === 'identity') return input
      }
      const e = opts.easing ? opts.easing(t) : t
      return outR[i - 1] + (outR[i] - outR[i - 1]) * e
    }
    // bezier(x1, y1, x2, y2): a CSS cubic-bezier as an easing function.
    const bezier = (x1, y1, x2, y2) => {
      const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx
      const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by
      const sx = (t) => ((ax * t + bx) * t + cx) * t
      const sy = (t) => ((ay * t + by) * t + cy) * t
      const dx = (t) => (3 * ax * t + 2 * bx) * t + cx
      return (x) => {
        if (x <= 0) return 0
        if (x >= 1) return 1
        let t = x
        for (let k = 0; k < 8; k++) {
          const d = dx(t)
          if (Math.abs(d) < 1e-6) break
          const t2 = t - (sx(t) - x) / d
          if (t2 < 0 || t2 > 1) break
          t = t2
        }
        let lo = 0, hi = 1
        if (Math.abs(sx(t) - x) > 1e-6) {
          t = x
          for (let k = 0; k < 40; k++) {
            if (sx(t) < x) lo = t; else hi = t
            t = (lo + hi) / 2
          }
        }
        return sy(t)
      }
    }
    // spring({ frame, fps, config: { damping, mass, stiffness, overshootClamping }, from, to, delay })
    const springUnit = (t, config = {}) => {
      const m = config.mass ?? 1, k = config.stiffness ?? 100, c = config.damping ?? 10
      const w0 = Math.sqrt(k / m), z = c / (2 * Math.sqrt(k * m))
      if (t <= 0) return 0
      // A damping ratio of 1 or more settles CRITICALLY at the natural
      // frequency, as Remotion's spring does (measured to 1e-16 across
      // overdamped configs; true overdamped motion would crawl, and
      // \`damping: 200\` is the smooth spring sources reach for).
      if (z >= 1) return 1 - Math.exp(-w0 * t) * (1 + w0 * t)
      const wd = w0 * Math.sqrt(1 - z * z)
      return 1 - Math.exp(-z * w0 * t) * (Math.cos(wd * t) + ((z * w0) / wd) * Math.sin(wd * t))
    }
    // The frames a spring takes to settle within half a percent and stay there.
    const springFrames = (fps, config = {}) => {
      let last = 0
      for (let f = 0; f <= fps * 10; f++)
        if (Math.abs(springUnit(f / fps, config) - 1) >= 0.005) last = f
      return last + 1
    }
    // durationInFrames stretches the spring so it settles on that frame, and
    // past it the value IS \`to\` (as Remotion's does, measured).
    const spring = ({ frame, fps, config = {}, from = 0, to = 1, delay = 0, durationInFrames }) => {
      const f = Math.max(0, frame - delay)
      if (durationInFrames && f > durationInFrames) return to
      const scale = durationInFrames ? springFrames(fps, config) / durationInFrames : 1
      let x = springUnit((f * scale) / fps, config)
      if (config.overshootClamping && x > 1) x = 1
      return from + (to - from) * x
    }
    // springTo(tl, target, { x: [from, to] }, at, { fps, config, frames }): the
    // spring on the timeline, one linear step per frame; returns its end time.
    const springTo = (tl, target, props, at, opts = {}) => {
      const fps = opts.fps || 30
      const frames = opts.frames ?? springFrames(fps, opts.config)
      const keys = Object.keys(props)
      const start = {}
      for (const k of keys) start[k] = props[k][0]
      tl.set(target, start, at)
      for (let f = 1; f <= frames; f++) {
        const s = f === frames ? 1 : spring({ frame: f, fps, config: opts.config })
        const v = { duration: 1 / fps, ease: 'none' }
        for (const k of keys) v[k] = props[k][0] + (props[k][1] - props[k][0]) * s
        tl.to(target, v, at + (f - 1) / fps)
      }
      return at + frames / fps
    }
    // Seeded simplex noise in [-1, 1] (Gustavson's construction).
    const grad3 = [[1,1,0],[-1,1,0],[1,-1,0],[-1,-1,0],[1,0,1],[-1,0,1],[1,0,-1],[-1,0,-1],[0,1,1],[0,-1,1],[0,1,-1],[0,-1,-1]]
    const perms = new Map()
    const perm = (seed) => {
      const key = String(seed)
      let p = perms.get(key)
      if (!p) {
        const r = rng(seed)
        const base = Array.from({ length: 256 }, (_, i) => i)
        for (let i = 255; i > 0; i--) {
          const j = Math.floor(r() * (i + 1))
          const t = base[i]; base[i] = base[j]; base[j] = t
        }
        p = new Uint8Array(512)
        for (let i = 0; i < 512; i++) p[i] = base[i & 255]
        perms.set(key, p)
      }
      return p
    }
    const noise2D = (seed, x, y) => {
      const p = perm(seed)
      const F2 = 0.5 * (Math.sqrt(3) - 1), G2 = (3 - Math.sqrt(3)) / 6
      const s = (x + y) * F2
      const i = Math.floor(x + s), j = Math.floor(y + s)
      const t = (i + j) * G2
      const x0 = x - (i - t), y0 = y - (j - t)
      const i1 = x0 > y0 ? 1 : 0, j1 = x0 > y0 ? 0 : 1
      const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2
      const x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2
      const ii = i & 255, jj = j & 255
      const corner = (gi, cx, cy) => {
        const tt = 0.5 - cx * cx - cy * cy
        if (tt < 0) return 0
        const g = grad3[gi % 12]
        return tt * tt * tt * tt * (g[0] * cx + g[1] * cy)
      }
      return 70 * (corner(p[ii + p[jj]], x0, y0) + corner(p[ii + i1 + p[jj + j1]], x1, y1) + corner(p[ii + 1 + p[jj + 1]], x2, y2))
    }
    const noise3D = (seed, x, y, z) => {
      const p = perm(seed)
      const F3 = 1 / 3, G3 = 1 / 6
      const s = (x + y + z) * F3
      const i = Math.floor(x + s), j = Math.floor(y + s), k = Math.floor(z + s)
      const t = (i + j + k) * G3
      const x0 = x - (i - t), y0 = y - (j - t), z0 = z - (k - t)
      let i1, j1, k1, i2, j2, k2
      if (x0 >= y0) {
        if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0 }
        else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1 }
        else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1 }
      } else {
        if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1 }
        else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1 }
        else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0 }
      }
      const ii = i & 255, jj = j & 255, kk = k & 255
      const corner = (gi, cx, cy, cz) => {
        const tt = 0.6 - cx * cx - cy * cy - cz * cz
        if (tt < 0) return 0
        const g = grad3[gi % 12]
        return tt * tt * tt * tt * (g[0] * cx + g[1] * cy + g[2] * cz)
      }
      return 32 * (
        corner(p[ii + p[jj + p[kk]]], x0, y0, z0) +
        corner(p[ii + i1 + p[jj + j1 + p[kk + k1]]], x0 - i1 + G3, y0 - j1 + G3, z0 - k1 + G3) +
        corner(p[ii + i2 + p[jj + j2 + p[kk + k2]]], x0 - i2 + 2 * G3, y0 - j2 + 2 * G3, z0 - k2 + 2 * G3) +
        corner(p[ii + 1 + p[jj + 1 + p[kk + 1]]], x0 - 1 + 3 * G3, y0 - 1 + 3 * G3, z0 - 1 + 3 * G3))
    }
    const lib = { clamp, interpolate, bezier, spring, springFrames, springTo, noise2D, noise3D, random, rng }`
