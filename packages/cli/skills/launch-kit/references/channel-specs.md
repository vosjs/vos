# Channel specs: readable mirror

Source of truth: `schema/channel-specs.json` in the `@vosjs/cli` npm
package (loop over the JSON, don't hand-type from this table). Verified
against official platform docs 2026-08-04. Platform specs drift, so
re-verify quarterly against the channels' current docs.

## Video (4 cuts from one document)

| Cut | `--to` | Spec | Destinations |
| --- | --- | --- | --- |
| Main demo | `youtube` | 16:9 1920×1080 MP4 H.264+AAC, 60–120s, captions burned in | YouTube (public). The same upload serves the Chrome Web Store promo video and the Product Hunt video (both take YouTube URLs only) |
| Feed cut | `x` | 16:9 or 1:1, 30–60s, ≤140s / 512MB free tier, **H.264+AAC only** (HEVC/VP9/AV1 rejected) | X native upload |
| Vertical cut | `shorts` | 9:16 1080×1920, 30–90s, critical text inside a centered ~900×1160 safe zone | YouTube Shorts + LinkedIn native vertical |
| README loop | `github` | 16:9, 10–20s, **≤10MB** MP4 (GitHub free-plan ceiling) | GitHub README |

## Composition (per cut)

The specs carry two more facts `vos deliver` and `vos validate --picture`
read (loop over the JSON; this is the readable mirror):

| Cut | Words | Safe rect (fractions) | Renders from |
| --- | --- | --- | --- |
| youtube main-demo, x feed-cut | allowed | 5% / 8% inset | the take, with its planned entrance and end card |
| shorts-linkedin vertical-cut | expected | 900x1160 centred | the take, reframed |
| github readme-loop | none | | the take, motion and sound dropped |
