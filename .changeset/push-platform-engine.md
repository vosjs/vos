---
'@vosjs/studio-core': minor
'@vosjs/cli': minor
---

`DOC_FEATURES` in `@vosjs/studio-core` lists the document fields a host's lowering must understand, each with the release that first renders it (`docFeatures`, `featuresNewerThan`, `compareVersions`), and `bakeDocFeatures(doc, version)` returns a copy with the newer ones said in what that release reads (an anchored caption at the start it plays at, its `{elapsed}` filled; a loudness target as its gain).

`vos push <take>` reads which studio-core the platform renders with (`GET <origin>/api/engine`) before anything uploads, and refuses (exit 2) a take that uses a newer field, which the platform's studio would draw wrong when it opens the take, and every version saved there would keep: `this take uses caption anchors (studio-core 0.43.0); vos.so renders with 0.42.4, …`. `--bake` sends a copy with every such field the take uses baked, whatever the platform answered (behind, current, or nothing), and leaves `doc.json` alone. A platform that cannot say (no such endpoint, a refusal, no answer within 2 s) is warned of and pushed to.

`vos join` no longer leaves a file handle open on a clip it copies without remuxing.
