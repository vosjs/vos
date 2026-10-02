---
'@vosjs/studio-core': minor
'@vosjs/cli': patch
---

The card can wait before it enters: `frame.anim.enter.at` (OUTPUT seconds, 0..30). The ground plays alone until then, so a film can open on its title over the ground, and the card arrives from nothing rather than from its softened first pose. Every head of the entrance (the tilt-in pose, the pull-out level, the camera's rest, the card-pose track and a slide's start in the transitions table) holds until `at` and moves over the step's seconds after it; the exit never begins before the card has arrived, and the cover moves past the arrival. Absent, every track lowers byte-identically. `vos validate` and the doc schema take `at` on the card's enter only and say why anywhere else.
