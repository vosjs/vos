---
'@vosjs/cli': minor
---

The take pipeline's verbs are promoted to the top level: `vos create / record / plan / frames / open / validate` delegate to the separately installed `@vosso/cli` (previously `@vosso/voila-cli`, which remains an install fallback), and `vos render` is now polymorphic — a take directory (recognized by its `doc.json`) renders through the take pipeline, anything else renders as an engine config. `vos voila <verb>` keeps working as a hidden alias and prints a one-line pointer at the new spelling. The `vos orbit` and `vos riff` stubs are removed: both are unknown commands again (3D showcase renders as a plain vos config; the remix contract stays at vos.so/llms-remix.txt).
