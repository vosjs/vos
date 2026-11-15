---
'@vosjs/studio-core': patch
---

A take's sound clips (music, effects) play at the player's speed, tape-style, as a speed span's footage does. They are Web Audio sources scheduled on the audio clock, and were scheduled as if the output clock always ran one second a second: at speed 2 every clip was 80ms off within a tenth of a second and was killed and started again four times a second, at the original pitch.

A clip is now scheduled once: its source plays at the speed (`window.__vos__.transport.speed`), and when it starts and where its fades and its duck land are the output times divided by it. A change of speed is one reschedule from where the playhead is. At speed 1, and in a player that publishes no speed, every call is the one it was. The export's mix is untouched: it never ran this.
