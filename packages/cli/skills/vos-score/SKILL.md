---
name: vos-score
description: Compose an original score (background music, BGM, a soundtrack, a beat) for a vos program, written as code. The music is locked to the program's own beat grid (BPM, bars, beat 1 at t = 0) and arranged section by section to what is on screen (a build, stop-time hits on the frames where poses snap, fills under transitions, the biggest moment, an ending that lands), synthesized to a normalized MP3, verified by numbers because an agent cannot listen (a tempo and phase fit against the grid, per-section loudness against the intended shape), and put on the program's doc.json as its track. Use when asked for music, a soundtrack, a score or BGM for a vos, when a catalog track does not fit the picture or does not land on its beats, or when a film dances, cuts or animates on a beat grid.
license: MIT
---

# Compose a score for a vos program

A catalog track (`GET https://vos.so/api/music`: CC0, a slug, a mood, a
length) carries no tempo and no downbeats, and you cannot listen to it. Under
an ambient picture that is fine. Under a picture that moves on a beat, it is
wrong in ways you will not hear: the kick lands between the poses, the drop
arrives two bars early, the loud part sits under the quiet scene.

So write the music instead. The score is a spec (tempo, chords, a riff, a
hook, sections by bar) that `scripts/compose.py` synthesizes into a WAV at
exactly the program's length, beat 1 of bar 0 at t = 0. Because the grid is
the program's own, every hit lands on the frame it was written for, and
because the arrangement is data, a fix is an edit and a re-render.

The bundled instruments are a funk and new jack swing palette: an 808-style
kick with a pitch sweep, a layered gated clap, swung 16th hats, a crash,
snare rolls, noise risers, a two-filter funk pluck bass with a sub under it,
an FM electric piano, detuned saw brass, orchestra hits, a square/saw lead
with vibrato, a pad, a room reverb and a bus saturation. Swing is a number
(0 is straight), kicks, claps and hats are per-section patterns, so the same
kit covers straight funk, four-on-the-floor dance and hip hop pocket. A
genre it cannot play (strings, guitar, a choir) is a new instrument written
beside the others in the same file, never a sample.

## Setup

```bash
python3 -m venv .score-venv && .score-venv/bin/pip install numpy scipy
PY=.score-venv/bin/python
SKILL=<the directory holding this SKILL.md>
ffmpeg -version | head -1      # with libmp3lame
npm i -D @vosjs/cli            # render the preview, push
```

Python 3.9 or newer. Work in the program's directory; the scripts take
their inputs as paths.

## The procedure

### 1. Read the grid

The music's grid is the program's grid. Find it in the program:

- a tempo constant in a function string (`const P = 60 / 124`, `BAR = P * 4`)
  or in `data` (`bpm`, `beat`);
- the sections: a plan table by bar (`[startBar, endBar, move, ...]`), the
  scenes from `tl.addLabel('<scene>', t)`, or the times the picture changes
  (render stills with `vos still config.json s.png --time <t>` and look);
- the length: `config.duration`, which is the score's length to the sample
  (a program that ends mid-bar sets the spec's `length` to it).

Beat 1 of bar 0 is t = 0. If the program has scenes but no beat (a product
reveal timed by eye), pick the BPM whose bar lines fall nearest its scene
times, and, when you own the program, retime its labels onto those bars: a
picture and a score on one grid is the point. See
`references/arranging.md`.

### 2. Write the section map

Before any notes, write down what the music does under each section, in the
spec's `sections` with a `picture` line each (the composer ignores it; it is
for you and the next reader):

- where the energy rises, and where it drops back to breathe;
- where it STOPS: stop-time hits on the frames where poses snap or the cut
  lands, with silence between;
- the fills under transitions (a spin, a wipe, a title): a roll and a riser
  that carry into the next downbeat, never a hole;
- the biggest moment, ONE section, louder than everything else;
- the ending: a pickup, the last hit on the final pose, and the room ringing
  out to the last frame.

`references/arranging.md` holds the craft and the measured level targets.

### 3. Pick a genre and a harmony

Fit the picture's era and mood: a 1990 dance film wants new jack swing (an
808, swung 16ths, brass stabs, a funk bass), a 1977 one disco (straight,
four on the floor, open hats on the off-beats). Pick a mode and two to four
chords that vamp (E dorian's Em9 to A13 does a whole groove), a darker pair
for the breakdown, and a lift for the chorus.

**Everything is original.** Write a new riff, a new hook, new changes. Never
a recognisable melody, riff, bassline or sample from a real record. A film
made after a famous record is the most tempting case: the score is in that
record's genre and era, and quotes nothing of it.

### 4. Compose

Copy `$SKILL/references/new-jack-swing-124.json` to `score.json` (a 124
BPM new jack swing dance film, 30 bars) and change everything that belongs
to that piece: the tempo, bars, chords, the riff, the hook, the sections.
`references/spec.md` is the spec's full contract and every texture's parts.
Composed as it ships, the example is a reference: it renders the score it
was written as, sample for sample.

```bash
$PY $SKILL/scripts/compose.py score.json score.wav
```

It prints the section map in seconds: hold it against the picture's times.
A spec error is said in words (an undefined chord, a gap between sections,
a drop with no riff) before anything renders.

### 5. Verify by numbers

You cannot listen, so measure:

```bash
$PY $SKILL/scripts/analyze.py score.wav --spec score.json
```

- **grid**: the kick-band (30 to 150 Hz) onset fit must read the spec's BPM
  (within 0.05) with beat 1 within 0.02 s of t = 0. A fit at half or double
  tempo, or a phase off by half a beat, means the kick pattern is not
  saying the downbeat: put a kick on every beat 1.
- **order**: a section with more `energy` must be at least 0.5 dB louder
  than one with less.
- **biggest**: the highest-energy section must clear every other by 1 dB.
- **holes**: no bar may fall more than 10 dB under the bar before it. A fill
  is not a hole.
- **ring**: the bar after the last hit is quieter than the hit's bar.

Read the per-section table too: it prints each section against the main
groove, the numbers `references/arranging.md` gives targets for. A failed
check is fixed with RELATIVE levels: raise or lower that section's `energy`
and compose again. Never fix a section's level with the master gain, which
moves every section together. Three faults these checks were built from,
all in one real first draft: the drop was not louder than the groove, the
chorus was quieter than the drop, and the spin fills were holes (-29 dB).

### 6. Master

```bash
$PY $SKILL/scripts/master.py score.wav score.mp3                 # -16 LUFS, 192k
$PY $SKILL/scripts/analyze.py score.mp3 --spec score.json --lufs -16
```

`master.py` reaches -16 LUFS (the catalog's loudness) with ONE constant
gain. Do not run a single-pass `ffmpeg -af loudnorm` instead: it rides the
gain over a few seconds and flattens the arrangement (measured on a real
score: the build came out as loud as the groove, and the chorus only 0.5 dB
over the drop). The MP3 must pass the same checks as the WAV.

### 7. Put it on the program and preview

The score is a track in `doc.json` beside `config.json`, keyed by the MP3's
file name in the same directory (`vos push` uploads it and keys the hosted
file):

```json
{
  "docSchemaVersion": 6,
  "audio": [
    {
      "id": "score",
      "key": "score.mp3",
      "name": "<title>, composed for this film",
      "start": 0, "in": 0, "out": 58.0645, "duration": 58.0645,
      "gain": 0.95, "fadeIn": 0, "fadeOut": 2.2
    }
  ],
  "program": {}
}
```

`start: 0` and `in: 0` keep beat 1 on frame 0; `out` and `duration` are the
program's length. No fade in (it would soften the first downbeat); a fade out
about one bar long under the ring-out. If the program already has a
`doc.json`, keep its other fields and replace the old track in `audio`.

```bash
npx vos render config.json preview.mp4 --width 640 --height 360   # mixes doc.json's audio
ffmpeg -ss <a second inside the biggest moment> -i preview.mp4 -frames:v 1 f.png
$PY $SKILL/scripts/analyze.py preview.mp4 --bpm <bpm> --bars <bars>
```

Look at the frame. The preview's analysis confirms the score is in the
render at the right tempo; its beat 1 reads about 0.05 s late because the
MP4's AAC track keeps its encoder delay, so the score file, not the preview,
is the grid check.

### 8. Credit and push

Credit it honestly, as music made for this film and by no one else: the
track's `name` is `<title>, composed for this film`, and a description that
credits music says `music: <title>, composed for this film`. Never an
artist's name, never "by" anyone who did not write it.

```bash
vos push config.json --label "score: <title>" \
  --note "an original score at <bpm> BPM, <bars> bars, <genre>, written to the sections: <one line>" --wait
```

In a fetched or tracked directory this versions the same vos (pass
`--vos <id>` otherwise); a new program takes the usual `--title`, `--folder`
and `--prompt` (the person's words, as they wrote them, which the watch page
shows by default: say so). Keep `score.json` beside the program so the next
round edits the spec, not the MP3: the same spec renders the same WAV,
sample for sample.

### 9. Hand it over, and ask them to listen

Give the person the preview (and the vos's watch link), and ask them to
LISTEN before it is promoted or published. Say it plainly: the numbers show
the score is on the grid and shaped as intended; they cannot say whether it
is good music. Ears decide. Their words go back into the spec (a section's
energy, a chord, the hook) and steps 4 to 8 run again.

## Rules

- The grid is the program's. Never fit a picture to a track's tempo when
  you can write a track at the picture's.
- Original or nothing: no quoted melody, riff, bassline, chord hook or
  sample from a real record, and no artist named in the credit.
- One biggest moment. A score where everything is loud has no drop.
- Fix shape with section levels, never the master.
- Normalize with one gain (`master.py`), never a dynamic normalizer.
- A score is not finished until a person has listened to it.
