---
'@vosjs/core': minor
'@vosjs/studio-core': patch
---

Default the tween backend to `'vos'`

`generateRenderTemplate` and `compileVosConfig` now default `tweenEngine` to
`'vos'`, and `tweenBundleCode` defaults to `tweenRuntimeCode` from
`@vosjs/tween` (already a dependency of `@vosjs/core`), so the deterministic
recorder and sampler need nothing passed. A default render page no longer
imports GSAP, no longer preloads it, and fetches nothing for it.

Every renderer in this repo already passed `'vos'` explicitly; this makes the
default match what they ship, and what the determinism guarantee assumes.

Compatibility: the `gsap` import-map entry is still emitted, so a program
compiled before this change keeps resolving its own `import gsap from 'gsap'`.
Hosts that drive playback with real GSAP can opt back in with
`tweenEngine: 'gsap'` on both calls. Passing an empty `tweenBundleCode` with
the vos backend still throws.

`@vosjs/studio-core` only widens its `@vosjs/core` peer range to admit the
minor; it does not use this API.
