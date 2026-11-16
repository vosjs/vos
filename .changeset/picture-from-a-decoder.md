---
'@vosjs/core': patch
---

The playback document can take a playing video's picture from a WebCodecs decoder where an element does not show what its clock says: above 1× (Chrome's element stops near 13× and trails its allowance; Safari's presents a few frames a second) and over a cut.

It is a second picture source behind the media follower, never a replacement for the element:

- A caller that draws the element onto a canvas says `picture: true` to `media.follow` and asks `media.draw(el, ctx, crop, dx, dy, dw, dh, at)` before drawing the element. `false` means the element is the picture.
- The decoder serves ABOVE 1×, one frame from the clock, and OVER A HAND-BACK (after a fast piece, and after a cut where the element's own seek is dear) until the element is playing on the clock again. Plain 1×, all sound and every paused frame stay the element's.
- The latest request wins: the walk reads the clock afresh before every frame it decodes. Short of the rate, it steps to the keyframe under the clock; when that cannot keep it inside the allowance for a second of playing, the element takes that rate back for good.
- Told what piece comes next (`next: { at, rate, in }`), a second walk finds that piece's first frame in the last 0.3 s before it, so a cut into a fast piece, or between two, shows the new piece on the frame of the cut.
- An element whose caller says `silent: true` rests while the decoder serves a fast piece (paused, parked at the piece's end), so one decoder runs, not two. One with sound keeps playing.
- A file the decoder cannot open (a WebM in Safari, a track whose size is not the element's) is the element's, as before.

Off unless the host says so: `generateRenderTemplate(code, { mode: 'playback', mediaDecoder: true })` sets `window.__vos__.mediaDecoder`, and a capture page never carries it. The file is read in ranges through mediabunny from the page's module source; nothing is fetched whole.
