# The how-to: one flow, one door, the result first

A how-to shows a person how to reach ONE result in a product: "make a
cinematic shot in HeyGen", "put a video on vos.so". It is the clip a docs
page, a changelog entry or a support answer embeds, and it is judged by
whether a viewer can repeat the path. The marketing rules in `taste.md`
still hold (one idea, open on the money shot, end settled); these are the
rules that are specific to the genre. They came out of three agent-made
how-tos and the cuts a person had to redo on them.

## The grammar

1. **One door.** A product usually has several ways to the same result
   (a guided flow, a prompt box, an apps menu, a template). The video walks
   ONE, and the person named it before the script was written (the
   pre-flight in `SKILL.md`). Two doors in one clip read as two videos;
   a door that works under automation beats the recommended one that does
   not (never hide the automation from a site; pick the door that works, or
   hand the shot list to a person).

2. **One caption per step, in the product's own words for the control.**
   The caption names the control the way the product labels it, as a verb
   phrase: "Open Apps", "Choose Cinematic Shots", "Press Generate". Not a
   sentence about the feature, not marketing copy, nothing the footage does
   not show. It sits on the step whose action it describes (`caption` on
   the step in `actions.json`; `vos plan` and `vos join --captions` land
   each one anchored to its step, so a re-record carries it). One caption
   is one beat; a step with no caption is part of the beat before it.

3. **The result is the payoff, and the cold open.** Open on the finished
   result for a beat (a repeated segment at camera rest,
   `segments[].camera: "rest"`, the `vos-cut` skill's "Assemble"), then
   the path from the door, then the result again, settled, as the last
   frame. The result's step is the beat marked `"zoom": true`; the path's
   clicks stay wide unless one of them is the point. `still` sits on the
   result, never on the door.

4. **A recap card that lists the path.** The last thing on screen is the
   path as a list, in the captions' own words, in order ("Apps → Cinematic
   Shots → Describe the shot → Generate"), on the plate after the card
   fades (`frame.anim.exit: "fade"` plus layers past the footage), never
   over a frozen frame. A viewer who looked away for the middle leaves with
   the path.

5. **Measured times only.** When the product takes time off camera (`await`
   in the script), the cut says how long it took in the words the
   measurement gives: `{elapsed}` in the caption after the wait prints the
   measured time ("8 minutes later, the shot is ready"), or write the
   number read from `meta.skips[].ms` ("About 8 minutes later"). Never a
   round number nobody measured, never "instantly" or "in seconds", and
   never a speed read off a capture (the recorder loads the page too).

6. **Music lands on the result.** `vos score --track <slug> --at <result
   step id>` puts the track's swell on the payoff; a how-to with a voice
   or the product's own sound (a generated video playing) keeps the bed
   under it (`--gain`). The downloaded output's own sound rides as a clip
   through `vos join`.

7. **As long as its path.** A how-to is not held to the 30 s marketing
   band; it is held to its beats: about 1 s of reading after a page
   changes, 0.6 s after a control, the waits cut out, nothing padded.
   Run 3's how-to was 36 s for seven steps and an 8-minute generation.

## The checks, in order

```bash
vos validate actions.json                     # the captions sit on the steps they describe
vos record --actions actions.json --out take --dry-run   # the door opens, the guard hovers, the wait is timed
vos record --actions actions.json --out take --strict --json --confirm <spend id>
vos plan take --zooms per-beat --still <result output s>
vos frames take --at-zooms                    # every apex beside its zoom-off twin
vos frames take --times <each caption start + 1>   # every caption on its own ground, in the product's words
vos check-video out.mp4                       # one cut per 5 s at most, the first and last frames stand alone
```

A caption the footage does not show, a time that was not measured, a second
door, or a result that is not the first and last frame each send the cut
back a round, not the recording.
