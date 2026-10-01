---
'@vosjs/timeline': minor
'@vosjs/tween': patch
'@vosjs/core': patch
'@vosjs/cli': minor
---

A `spring(damping, stiffness, mass)` ease (defaults 10, 100, 1; bare `spring`, `spring.in`, `spring.inOut` too), dialect-only like `css-bezier`: a damped spring released from rest, run for its natural settle time (until it stays within 0.5 % of the target) stretched over the tween, landing exactly on 1, as Remotion's `durationInFrames` stretches its `spring()`. A damping ratio of 1 or more settles critically at the natural frequency, as Remotion's does. A tween whose duration is the spring's settle time moves as Remotion's spring does, frame for frame (`springSettleTime(damping, stiffness, mass)` in `@vosjs/timeline`; `content.refs.lib.springSeconds(config)` in a ported program). The dialect lint accepts it in every spelling; GSAP has no such ease, so the GSAP backend falls back to its default. `@vosjs/tween`'s runtime bundle carries it to every render page. The port scaffold's hint now puts a source's springs on the timeline with the ease, never in `onFrame`.
