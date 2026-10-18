# The score spec

`scripts/compose.py spec.json score.wav` reads one JSON object. The worked
example is `new-jack-swing-124.json` beside this file.

## Positions

- A **bar** is four beats; bar 0 starts at t = 0. `bars: [4, 8]` is bars 4,
  5, 6 and 7.
- A **16th** position inside a bar is 0 to 15: beat 1 is 0, beat 2 is 4,
  beat 3 is 8, beat 4 is 12; the "and" of beat 1 is 2. Odd 16ths are swung
  late by `swing` (a fraction of a 16th).
- A **bar position** as a number is bar plus a fraction: `27.5` is bar 27,
  16th 8 (beat 3). Used by ending hits.
- **Notes** are names or MIDI numbers: `"E1"` (28), `"F#3"`, `"Bb2"`, `64`.
  C4 is 60.

## Top level

| Field | Required | Meaning |
| --- | --- | --- |
| `bpm` | yes | The program's tempo. |
| `bars` | yes | The piece's length in bars; the sections must cover exactly 0 to `bars`. |
| `length` | no | The output length in seconds, when the program's duration is not a whole number of bars (default `bars x 4 x 60 / bpm`). |
| `swing` | no | How late odd 16ths fall, as a fraction of a 16th: 0 is straight, 0.24 (the default) is about 62 % swing, the new jack and hip hop pocket. |
| `seed` | no | The noise seed (drums, risers, the room). Same spec, same seed, same file. |
| `chords` | yes | `{ "<name>": { "root": <bass note>, "voicing": [<comp notes>] } }`. Roots sit low (E1 to D2), voicings around G3 to B4 (three or four notes, close, the 7th and 9th rather than doubled roots). |
| `riff` | for `drop`, `chorus` | The bass riff, one bar: `[[16th, semitones over the chord's root, length in 16ths], ...]`. It follows the chord changes because it is intervals. |
| `hook` | for `drop`, `chorus` | The melody: a list of one-bar phrases, each `[[16th, note, length in 16ths], ...]`, cycled bar by bar through a section. Two phrases make a call and an answer. |
| `sub` | no | The plain bass pattern the build, groove and pump play (default the root, an octave up, on 1, on 3 and on the "and" of 4). Same shape as `riff`. |
| `held` | no | The held bass the `dark` texture plays (default long notes on 1 and 3, a fifth on 4). |
| `sections` | yes | The arrangement, in order, no gaps (below). |
| `fills` | no | Snare rolls over the end of a bar: `{ "bar": 11, "from": 12, "to": 16, "level": 0.75 }` (16ths, straight, rising). A fill is written into the section it sits in. |
| `title`, `harmony` | no | Words for the next reader. |

## Sections

Every section has `name` (unique), `bars: [start, end]` and `texture`, plus
`picture` (free text: what is on screen, ignored by the composer). Groove
textures take `chords` (one per bar, cycled) and `energy`.

`energy` scales every level in the texture by `energy / reference`, so the
reference plays it exactly as tuned. Textures differ in density, so equal
energy is not equal loudness: compose, read `analyze.py`, adjust.

| Texture | Reference energy | What plays |
| --- | --- | --- |
| `intro` | none | An orchestra hit on the first chord (`ring`, default 1.8 s), a riser over the last bar, a hat pickup and one kick into the next section. |
| `build` | 0.65 | Kick on 1 and 3, claps on 2 and 4, 8th hats, the plain sub bass, a pad. |
| `groove` | 0.72 | The main groove: a syncopated kick (1, the "and" of 2, 3, the "a" of 3), claps on 2 and 4, 8th hats with two open, the funk pluck on the `sub` pattern, the electric piano comping off the beat. |
| `stop` | 0.75 | Stop-time: on each 16th in `hits` (default `[0, 8]`, beats 1 and 3) the kick, an orchestra hit, a bass note and a clap together, silence between. |
| `pump` | 1.0 | Four on the floor, open hats on the off-beats, the funk pluck, brass on every beat. |
| `spin` | none | A fill section: a rising snare roll and a riser to one beat before the end, kicks on the beats, the last beat empty so the next downbeat lands. `level` (default 0.95) is the roll's. |
| `drop` | 1.05 | The riff, the hook, brass stabs on the "and" of 1 and 3, 16th hats, the kick adding a pickup every other bar. |
| `dark` | 0.8 | A breakdown: kick on 1, 3 and its "and", the `held` bass, a pad every two bars, a soft snare on every beat. |
| `chorus` | 1.25 | Everything: the riff, the hook up `octave` (default 1) with a harmony a fourth under, gang claps, a pad, brass stabs, 16th tambourine. |
| `ending` | none | `pickup` (bars, a roll and a riser from the section start), then `hits: [{ "at": <bar position>, "chord": "<name>" }, ...]`. Every hit but the last is a short orchestra hit with a kick; the last is the big one (`ring`, default 3.6 s), with a falling brass chord, a held bass note and a crash, and soft hats carry the room out through the bars after it. |
| `silence` | none | Nothing. The `holes` check skips these bars: a silence is a choice you declare. |

Per-section options on groove textures:

| Option | Meaning |
| --- | --- |
| `kicks` | 16ths for the kick: `[0, 4, 8, 12]`, or a list of lists cycled bar by bar. |
| `claps` | 16ths for the claps (default `[4, 12]`). |
| `hats` | `"16"`, `"8"` or `""` for none. |
| `open_hats` | 16ths where the hat opens. |
| `crash` | A crash on the section's downbeat, at this level (0.2 to 0.4). |
| `hit` | A chord name: an orchestra hit on the section's downbeat. |

## Changing the sound

The instruments are methods on `Score` (`kick`, `clap`, `bass_note`,
`brass_chord`, ...), the textures are `tex_<name>` methods, and the mix
(room reverb, bus saturation, the cut to length) is `render`. A new texture
is a `tex_<name>` method plus its reference in `TEXTURE_ENERGY` (and in
`analyze.py`'s copy when it is a groove texture the order check should
rank). A new instrument is a method beside the others, synthesized, never
a sample of a record.
