---
'@vosjs/render-core': minor
---

The fleet's pages leave the package: `buildFinalizeConcatPage`, `buildAudioMixPage`, `buildDigestPage` and `buildImageDiffPage` were a hosted render fleet's own harness (an ingest route's part names, a finalize stage contract, an ops canary), not the render math any host needs. What stays is what the local `vos render` runs: `planChunks`, the mediabunny concat and mux, and the audio producer. A host that needs those pages keeps them beside its queue consumer, in sync with `concat.ts` for packet parity.
