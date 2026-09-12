---
'@vosjs/studio-core': minor
---

The auto-zoom planner tests a press against the frame ONE PRESS AT A TIME. A click on a frame-sized element (a canvas, a panel, a modal clicked to focus or dismiss it) is set aside before clustering and only reserves its window against dwells; the button presses around it keep their zoom. The cluster-wide test read the chain's largest element, so one press on a panel inside a chain of clicks threw every zoom in the chain away. A `down` echoing the previous one within 4 ms and 2 px is one press (a recorder listening to pointer and mouse events records each click twice), so the digest's click counts are honest and a lone click is never a pair. The glide and keynote styles zoom a lone click (`minClusterClicks: 1`); the two-click rule they carried was never in effect on a recorded take. Digest click moments on a surface carry `surface: true`.
