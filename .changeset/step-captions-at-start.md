---
'@vosjs/cli': minor
---

`vos join --captions` and `vos plan --captions` land a step's caption as the step BEGINS (`anchor.at: "start"`, no offset), so the words name the beat while it plays. They used to land 0.2 s after the gesture ended, which on a real film ran each caption about 1.8 s late and put one over the next beat's payoff. `at: "end"` with an `offset` stays available on any caption.
