---
'@vosjs/timeline': minor
---

Initial release: deterministic time math for editable vos compositions.

- **Value types** (`Keyframe`, `KeyframeTrack`, `Segment`, `EaseName`) designed
  to be embedded inside app project documents and shipped through `ctx.data` —
  an evaluation library, not a document format.
- **`sample(track, t, lerp?)`**: pure keyframe evaluation (binary search,
  clamp outside the range, ease-into convention, `step` mode, custom lerps).
- **GSAP-parity easings**: `EASINGS` registry (`none`, `power1..4`, `sine`,
  `expo`, `circ`, `back` × in/out/inOut) built with GSAP's own in/out/inOut
  construction and verified against `gsap.parseEase` in tests.
- **`mapTime` / `sourceToTimeline` / `totalDuration`**: source-time remapping —
  the trim/split/multi-clip primitive.
- **Segment edit helpers** (host-only): `splitSegments`, `trimSegment`,
  `removeSegment`, `normalizeSegments`.
- **`@vosjs/timeline/bundle`**: `timelineRuntimeCode`, a self-contained IIFE
  exposing `globalThis.__vosTimeline` for inlining into constant interpreter
  programs — golden-tested to evaluate identically to the host module.
