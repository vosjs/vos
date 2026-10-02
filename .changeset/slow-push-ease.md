---
'@vosjs/studio-core': patch
---

The slow push through a held zoom (`zoomParams.holdDrift`) eases in and out (`sine.inOut`) instead of moving at a constant rate, so it starts and ends still and meets the zoom's arrival and its exit without the small jolt a constant rate made at both joints. The amount, the cap and the rule that a follow span never pushes are unchanged; a document without a push lowers byte-identically.
