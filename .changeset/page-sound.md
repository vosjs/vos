---
'@vosjs/studio-core': minor
'@vosjs/render-core': minor
'@vosjs/cli': minor
---

Sound a page plays during a take is kept: every video or audio element heard (in the page or a same-origin frame) lands in `meta.media[]` with the footage stretches it was heard, its file is fetched with the page's cookies into the take's `page-sound/`, and the plan places one audio clip per stretch at its output time with `source: "page"`, which a re-plan replaces.
