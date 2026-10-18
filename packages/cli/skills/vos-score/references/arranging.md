# Arranging to picture

A score for a program is written to the picture the way a choreographer
counts a dance: by bar. The picture already has its sections; the music's
job is to make each one feel like what it is.

## The section map

Write it before any notes, one line per section: the bars, what is on
screen, and what the music does there. The questions it answers:

1. **Where is the downbeat?** Bar 0 at t = 0. Everything else is counted
   from it. If the picture's sections do not sit on bar lines, they are not
   on a grid yet: fix that first (step 1 of the skill).
2. **What does each section DO?** Introduce, groove, stop, push, release,
   peak, end. Two neighbouring sections that do the same thing should
   sound different anyway (a new texture, a new chord pair, the hook
   entering).
3. **Where does it stop?** A pose that snaps, a cut, a word slamming in:
   these are stop-time hits. The whole band hits on that 16th and is silent
   until the next. Read the picture's own timing for them (a pose table
   keyed every half bar means beats 1 and 3), never guess.
4. **What carries the transitions?** A spin, a wipe, a scene change gets a
   fill: a snare roll rising in velocity, a riser, kicks keeping the grid,
   and ideally one empty beat before the next downbeat so it lands.
5. **What is the biggest moment?** One section, usually two thirds to
   three quarters through. It gets the most parts, the hook an octave up,
   the gang claps, and the most energy.
6. **How does it end?** A pickup into the final pose, the last hit ON the
   pose, and the room ringing out under the last frames. A score that is
   still grooving when the picture stops was not written to it.

## Energy contrast, measured

These are the steps of a real score that was approved, per section, against
its main groove (the first `groove` section), all bands. Use them as
targets, not laws: what matters is the order and the gaps.

| Section | Against the groove |
| --- | --- |
| intro (a hit and a riser) | about -7 dB |
| build | -1.5 dB |
| groove | 0 (the reference) |
| stop-time | +0.5 to +1 dB (fewer events, each one bigger) |
| a pumping section | +2.5 to +3 dB |
| the drop | +4.5 to +5 dB |
| a darker breakdown after the drop | +1.5 to +2 dB (under the drop, over the groove) |
| the biggest moment | +6 to +7 dB, and at least +1 dB over the drop |
| a fill bar | about -1.5 dB; never 10 dB or more under the bar before it |
| the last hit's bar, then the ring-out | about the pumping section, then 5 dB or more under it |

## The faults the numbers catch

All three were in one real first draft, and each was invisible without
listening, which an agent cannot do:

- **The drop was not louder than the groove.** The release had nothing to
  release. The `order` check catches it.
- **The chorus was quieter than the drop.** The biggest moment was not the
  biggest. The `biggest` check catches it.
- **The fills were holes.** The spin bars read -29 dB: the music vanished
  exactly where the picture moved most. The `holes` check catches it.

The fix for all three was the same: relative levels per section (`energy`),
never the master gain. And the shape must survive mastering: a single-pass
dynamic loudness normalizer moved that same score's sections by up to 3.5 dB
against each other (the build rose to the groove, the chorus fell to 0.5 dB
over the drop), which is why `master.py` applies one constant gain.

## Writing the riff and the hook

- **The riff** is one bar of intervals over the chord's root, so it follows
  the changes: the root on 1, the octave and the seventh, a chromatic
  passing note into beat 3, a run up into the next bar. Leave a 16th or two
  of air; a bass that never rests has no groove.
- **The hook** is two one-bar phrases, a call and an answer, in the mode's
  pentatonic, with long notes on chord tones and short pickups between. It
  enters with the drop and goes up an octave, with a harmony, in the
  biggest moment, so the peak is the same idea, bigger.
- **Originality.** Hold what you wrote against every famous song in the
  genre you know; if it is close to one of them, change the rhythm and the
  contour until it is not. Never write the riff, hook or bassline of the
  record a film is made after, and never a sample.

## When the picture has no beat

Pick the BPM whose bar lines fall nearest the scene times (a scene change
every 3.9 s suggests 124 BPM, two bars each). Then either retime the
program's labels onto those bars, which is better when you own it, or
write fills across the gaps and accept that a change lands up to a 16th
off the bar. Never stretch the score to the picture: a tempo change you
cannot hear is still one you cannot verify.
