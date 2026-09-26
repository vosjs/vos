# Taste — the product-video quality bar

The rubric for judging a take before its render ships. Judge stills
**multimodally**: look at the images, don't just check numbers.

## The quality loop (run it, don't skip it)

1. `vos record --actions actions.json --out take --strict --json` —
   exit 2 means the flow is broken; fix selectors, never ship around a skip.
2. `vos validate take` — doc lints must pass (warnings are judgment calls).
3. `vos frames take --at-zooms --times 0,25%,50%,75%,100%` — look at every
   still against the rubric below. The zoom apexes are where quality lives;
   judge those hardest.
4. Iterate doc.json → spot-check with `vos render take x.webm --range a..b --draft`
   (seconds, not a full re-render) → re-frame the changed region.
5. Full render only when the stills pass. Verify the final with one more
   `frames --at-zooms` against the SAME rubric before declaring done.

## Story shape

1. **One idea per clip.** A take demonstrates one flow or one feature —
   navigation to it is overhead, not story. Open as close to the money shot
   as possible; a cold viewer should see the point inside 3 seconds.
2. **≤ 30s for marketing clips**; 8–15s is the sweet spot for a page hero.
   Launch videos may run longer but every scene must still earn its seconds.
3. **End settled.** Close on a resolved state (result visible, motion parked),
   never mid-action — the loop point should read as intentional.

## Flow authoring (actions.json)

4. **Route the cursor away from hover-traps.** Nav links that live next to
   hover-triggered menus (mega-panels, frosted backdrop-blur scrims) will
   open them as the cursor passes — the rest of the take then plays behind a
   blur. Unless the menu IS the subject, path the cursor below the nav
   (`move` to page content first), or target an equivalent link outside the
   nav.
5. **Pacing is the zoom plan.** Hovers of 700–900ms on the things that matter
   become the zooms; open with `wait ≥700ms`, give navigations 1200–2000ms,
   end with a settle wait. A rushed flow reads as a rushed video AND plans
   no zooms.
6. **Real interactions only.** Click things that respond, type real strings
   (no "asdf"), scroll to content — the witnessed-capture claim dies the
   moment footage looks staged.

## Zoom & camera

7. **Levels 1.4–2.8 read well**; above 3× is for genuine detail (a number, a
   toggle), and must be brief. Below 1.3× reads as drift, not intent.
8. **One zoom per beat.** Zooms that chain across unrelated UI read as a lost
   camera. If the planner over-suggested, delete spans — an un-zoomed second
   is better than an unmotivated one.
9. **Focus on the subject, not the cursor resting spot.** `cx/cy` are
   normalized [0..1]; check the apex still shows the thing the beat is about,
   with breathing room (the subject inside the middle ~60% of the crop).
10. **Camera style is a sentence, not a spice rack.** Default `glide` for
    marketing calm; `snappy` only for dense click-through demos; never mix
    intents within one short clip.

## Frame & destination

11. **Footage honesty.** Never export above the recording's capture width —
    `validate` warns; fix the viewport at record time instead of upscaling.
12. **Background is ambience, not a subject.** A `frame.backgroundMedia`
    loop should sit _behind_ the work, never compete with it: prefer a calm
    ambient loop, and set `dim` (≈0.2–0.4) whenever the card carries dense
    UI or the take runs long enough to loop visibly. A high-contrast or fast
    background behind a text-heavy screen is a rejection.
13. **Tilt is punctuation, not texture.** `doc.tilt` spans lean the card for
    a beat and return to rest — at most one pose change per ~5s, in the
    ±5..18° band, paired with the zoom moments (same `in`/`out` chains the
    two camera moves; `tiltStyle` does this for you). Lean TOWARD the focus
    (right-side focus = negative `ry`). Never oscillate — a wobbling card is
    a rejection — and never leave the card leaning across a whole take: a
    permanent lean reads as a rendering bug, not a style. Spans are the only
    way to pose the card (there is no static tilt), so rest is always flat
    and every lean has to earn its moment.

## Smoothness — the north star

A product video's baseline quality is SMOOTHNESS: the frame should always be
alive, and nothing should change all-at-once unless it's a deliberate cut.
The two enemies, both measurable:

14. **Dead time.** A still frame is not the defect: a page the viewer is
    reading is content, and a workspace tour is mostly still. What is dead
    is a still frame under a PARKED cursor past the beat it takes to read
    what changed: about 1 s after a page changed, 0.6 s after a control
    did. The record done event reports it per step as `dead` (`ms`, `pct`,
    `steps[]` with how long each hold ran after its page settled and how
    much of that was past the beat; `freezePct` stays as the plain fact of
    stillness, `@vosjs/cli` 0.46 and later). Budget: **≤20% dead**, no
    single dead hold >1.5s. The fix is the step's `ms`: a hold is what it
    takes to read what changed, so cut the named steps to their beat. Then,
    where a flow allows it, keep something alive in frame (a playing
    preview, a live canvas, a scroll), and hover things that respond with
    motion. Never choose a flow to make a stillness number smaller.
15. **Full-frame bangs.** Instant UI re-layouts (filter clicks, page
    navigations) read as jump cuts — violent when zoomed. Budget: **≤1 bang
    per ~5s**, and let them happen WIDE (place zoom spans so the camera has
    released before a click that re-layouts; zoom into the RESULT, not the
    trigger). Census: `ffmpeg -vf "select='gt(scene,0.12)'"` on the final
    render — each detection should be a transition you _chose_.

## Judge each still set against

- **Blur check** — nothing unintentionally blurred (hover scrims, mid-seek
  frames). If a still looks soft, find out why before shipping.
- **Chrome check** — browser bar style matches the destination (mac for
  marketing, minimal/none inside app-like framings); no double chrome.
- **Cursor check** — the dot rests on or beside the subject at every apex,
  never floating in dead space; click effects land under it.
- **Text legibility** — body text in the footage readable at the render size;
  if not, the zoom level or viewport was wrong.
- **First/last frame** — both must stand alone as posters (the first frame IS
  the poster; the last frame is what loops into the first).
