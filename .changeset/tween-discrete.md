---
'@vosjs/tween': minor
---

Discrete values are replayed. A boolean or a plain string in a tween's vars (`set(media.props, { playing: true })`, a mode string on a ref) is not interpolated, but it is no longer lost either: the recorder keeps it on `spec.discrete` (still named in `opaqueKeys`, since a track editor cannot draw it) and the sampler applies it as a step at the tween's start, latest-started step winning. On the vos backend a media element's `playing` used to never flip.
