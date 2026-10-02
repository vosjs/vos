---
'@vosjs/core': minor
'@vosjs/cli': minor
---

A program declares the files it uses, by name. `config.assets` (`{ name: { ref, kind? } }`) is the manifest; a function reads `ctx.assets.<name>` and an element, object or font names one as `"$assets.<name>"`. A file typed into a function as a URL is invisible to every host: it cannot be served to a render page on another origin, brought along when the program is copied, or known to be in use. A declared one can.

**Core.** The URL a program sees is resolved nearest first: `deps.assets` handed to `initVos` for the surface (`capture.assets` on a capture page), then the default baked at compile time through the new `resolveAssetRef` compile option, then the `ref` as written. `lintVosAssets` (`@vosjs/core/lint`) reports a `"$assets"` string that names nothing, a function that reads an undeclared name, and a declared file nothing reads. A program with no manifest compiles as before, with `ctx.assets` an empty object.

**CLI.** `vos render`, `vos still`, `vos preview` and `vos compare` serve a manifest's local files to the page from disk and read a hosted one with your key. `vos push` uploads the local files and stores the program naming them `asset:<id>`; the config on disk keeps its paths. `vos fetch --media` brings a program's hosted files home under `assets/`. `vos check` gains the declared-file lints, including a hosted file named in code instead of the manifest.
