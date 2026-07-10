---
'@vosjs/core': minor
'@vosjs/tween': minor
---

Selectable tween backend (`tweenEngine: 'gsap' | 'vos'`).

- `@vosjs/core`: `generateRenderTemplate` accepts `tweenEngine` +
  `tweenBundleCode` — in vos mode the template imports no GSAP (the importmap
  entry remains for legacy artifacts), inlines the @vosjs/tween runtime, and
  supplies `deps.gsap` as a fresh deterministic recorder per LOAD.
  `compileVosConfig` accepts `{ tweenEngine }` to omit the (shadowed) gsap
  import from compiled modules. Compiled artifacts stay backend-agnostic:
  `ctx.gsap` always comes from `deps.gsap`, so either artifact runs under
  either host backend.
- `@vosjs/tween`: new `@vosjs/tween/bundle` export (`tweenRuntimeCode` IIFE
  defining `globalThis.__vosTween`) and the remaining master-timeline
  transport surface — `paused()`, `repeat()` (`-1` loops the play driver),
  `kill()`, getter forms of `timeScale()` / `eventCallback()`.
