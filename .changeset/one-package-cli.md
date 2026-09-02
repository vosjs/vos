---
'@vosjs/cli': minor
---

One package, every verb. The take pipeline and the vos.so verbs that shipped as `@vosso/vos-plugin` (record, plan, digest, frames, deliver, brand, validate, actions, open, fetch, push, pull, login, duplicate, folder, asset, recipe) now live inside `@vosjs/cli`: `npm i -D @vosjs/cli` is the whole install, `vos help` lists them under the engine verbs, and the delegate-on-unknown seam, the plugin manifest handshake and the "install the plugin" error path are gone. The three libraries under them publish as `@vosjs/studio-core`, `@vosjs/render-core` and `@vosjs/shared`. `@vosso/vos-plugin` ships once more as a forwarding shim that says so.
