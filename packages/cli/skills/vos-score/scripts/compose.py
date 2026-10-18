#!/usr/bin/env python3
"""
Compose an original score for a vos program from a JSON spec, locked to the
program's beat grid and arranged section by section.

    python compose.py spec.json score.wav

Writes a 48 kHz stereo float WAV at exactly the program's length (bars x bar
length, or the spec's `length` in seconds), beat 1 of bar 0 at t = 0. Needs
numpy and scipy. Normalize and encode it with ffmpeg afterwards (see SKILL.md).

The instruments: an 808-style kick with a pitch sweep, a layered gated clap,
swung 16th hats, a crash, snare rolls, noise risers, a two-filter funk pluck
bass with a sub under it, an FM electric piano, detuned saw brass, orchestra
hits, a square/saw lead with vibrato, a pad, a convolution room reverb and a
bus saturation. Their sounds and the mix are tuned; leave them alone unless
the genre needs a different instrument, and then add one beside them.

The spec decides everything about the piece: tempo, swing, chords (as note
names or MIDI numbers), the bass riff and the hook (both must be original),
and the sections, each a texture over a bar range with an energy. See
`references/new-jack-swing-124.json` and `references/spec.md`.
"""
import json
import sys

import numpy as np
from scipy import signal
from scipy.io import wavfile

SR = 48000

# The energy each texture was tuned at. A section's `energy` scales the whole
# texture (drums and parts) by energy / reference, so the reference energy
# plays the texture exactly as tuned.
TEXTURE_ENERGY = {
    'build': 0.65,
    'groove': 0.72,
    'stop': 0.75,
    'pump': 1.0,
    'drop': 1.05,
    'dark': 0.8,
    'chorus': 1.25,
}
MOMENTS = ('intro', 'spin', 'ending', 'silence')
TEXTURES = tuple(TEXTURE_ENERGY) + MOMENTS

NOTE_NAMES = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}


class SpecError(Exception):
    pass


def note(v):
    """A MIDI number from 64, '64', 'E4', 'F#3' or 'Bb2' (C4 = 60)."""
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return int(v)
    s = str(v).strip()
    if s.lstrip('-').isdigit():
        return int(s)
    if not s or s[0].upper() not in NOTE_NAMES:
        raise SpecError(f'"{v}" is not a note (write E4, F#3, Bb2 or a MIDI number)')
    pc = NOTE_NAMES[s[0].upper()]
    rest = s[1:]
    while rest and rest[0] in '#b':
        pc += 1 if rest[0] == '#' else -1
        rest = rest[1:]
    try:
        octave = int(rest)
    except ValueError:
        raise SpecError(f'"{v}" has no octave (write E4, not E)')
    return 12 * (octave + 1) + pc


# --- the spec -----------------------------------------------------------------

def load_spec(path):
    with open(path) as f:
        spec = json.load(f)
    for key in ('bpm', 'bars', 'chords', 'sections'):
        if key not in spec:
            raise SpecError(f'the spec has no "{key}"')
    chords = {}
    for name, c in spec['chords'].items():
        if 'root' not in c or 'voicing' not in c:
            raise SpecError(f'chord {name} needs a "root" (the bass note) and a "voicing" (the comp notes)')
        chords[name] = {'root': note(c['root']), 'voicing': [note(m) for m in c['voicing']]}
    spec['_chords'] = chords

    bars = spec['bars']
    prev_end = 0
    names = set()
    for i, s in enumerate(spec['sections']):
        label = s.get('name', f'section {i}')
        if label in names:
            raise SpecError(f'two sections are named "{label}"; names must be unique')
        names.add(label)
        s['name'] = label
        tex = s.get('texture')
        if tex not in TEXTURES:
            raise SpecError(f'{label}: texture "{tex}" is not one of {", ".join(TEXTURES)}')
        b0, b1 = s.get('bars', [None, None])
        if b0 is None or b1 is None or not b0 < b1:
            raise SpecError(f'{label}: "bars" must be [start, end] with start < end')
        if b0 != prev_end:
            raise SpecError(f'{label}: starts at bar {b0} but the section before ends at {prev_end} (no gaps, no overlaps)')
        prev_end = b1
        for ch in s.get('chords', []):
            if ch not in chords:
                raise SpecError(f'{label}: chord "{ch}" is not defined in "chords"')
        if tex in TEXTURE_ENERGY or tex == 'intro':
            if not s.get('chords'):
                raise SpecError(f'{label}: a {tex} section needs "chords" (one per bar, cycled)')
        if tex in TEXTURE_ENERGY:
            s.setdefault('energy', TEXTURE_ENERGY[tex])
        if tex in ('drop', 'chorus') and not spec.get('riff'):
            raise SpecError(f'{label}: a {tex} section plays the bass riff, and the spec has no "riff"')
        if tex in ('drop', 'chorus') and not spec.get('hook'):
            raise SpecError(f'{label}: a {tex} section plays the hook, and the spec has no "hook"')
        if tex == 'ending':
            hits = s.get('hits') or []
            if not hits:
                raise SpecError(f'{label}: an ending needs "hits" (at least the last one)')
            for h in hits:
                if h.get('chord') not in chords:
                    raise SpecError(f'{label}: hit chord "{h.get("chord")}" is not defined')
                if not b0 <= h['at'] < b1:
                    raise SpecError(f'{label}: a hit at bar {h["at"]} is outside the section')
        for key in ('hit',):
            if s.get(key) and s[key] not in chords:
                raise SpecError(f'{label}: "{key}" chord "{s[key]}" is not defined')
    if prev_end != bars:
        raise SpecError(f'the sections end at bar {prev_end} but the piece has {bars} bars')
    for f in spec.get('fills', []):
        if not 0 <= f['bar'] < bars:
            raise SpecError(f'a fill at bar {f["bar"]} is outside the piece')
    return spec


def main():
    if len(sys.argv) != 3:
        print('usage: python compose.py spec.json score.wav', file=sys.stderr)
        sys.exit(2)
    try:
        spec = load_spec(sys.argv[1])
    except SpecError as e:
        print(f'spec: {e}', file=sys.stderr)
        sys.exit(2)
    Score(spec).render(sys.argv[2])


# --- the score ----------------------------------------------------------------

class Score:
    def __init__(self, spec):
        self.spec = spec
        self.bpm = float(spec['bpm'])
        self.beat = 60.0 / self.bpm
        self.bar = 4 * self.beat
        self.s16 = self.beat / 4
        self.bars = int(spec['bars'])
        self.length = float(spec.get('length', self.bars * self.bar))
        self.swing = float(spec.get('swing', 0.24))
        self.rng = np.random.default_rng(int(spec.get('seed', 1990)))
        self.ch = {k: v['voicing'] for k, v in spec['_chords'].items()}
        self.root = {k: v['root'] for k, v in spec['_chords'].items()}
        self.riff = [tuple(x) for x in spec.get('riff', [])]
        self.sub = [tuple(x) for x in spec.get('sub', [(0, 12, 4), (8, 12, 2), (14, 12, 2)])]
        self.held = [tuple(x) for x in spec.get('held', [(0, 12, 6), (8, 12, 3), (12, 19, 3)])]
        self.hook_phrases = [[(p, note(m), ln) for p, m, ln in phrase] for phrase in spec.get('hook', [])]

        n = int(max(self.length, self.bars * self.bar) * SR) + SR * 4
        self.L = np.zeros(n)
        self.R = np.zeros(n)
        self.VL = np.zeros(n)  # reverb send
        self.VR = np.zeros(n)

    # --- time and placement ---------------------------------------------------

    def at(self, bar, pos16=0.0, swing=True):
        """Seconds for a bar and a 16th position, odd 16ths swung late."""
        p = float(pos16)
        odd = int(round(p)) % 2 == 1 and abs(p - round(p)) < 1e-6
        late = self.swing * self.s16 if swing and odd else 0
        return bar * self.bar + p * self.s16 + late

    def at_bar(self, x, swing=True):
        """Seconds for a fractional bar position (27.5 = bar 27, 16th 8)."""
        bar = int(np.floor(x + 1e-9))
        return self.at(bar, round((x - bar) * 16, 6), swing)

    def place(self, sig, t, gain=1.0, pan=0.0, verb=0.0):
        L = self.L
        i = int(round(t * SR))
        if i < 0 or i >= len(L):
            return
        n = min(len(sig), len(L) - i)
        s = sig[:n] * gain
        gl = np.cos((pan + 1) * np.pi / 4)
        gr = np.sin((pan + 1) * np.pi / 4)
        L[i:i + n] += s * gl
        self.R[i:i + n] += s * gr
        if verb:
            self.VL[i:i + n] += s * gl * verb
            self.VR[i:i + n] += s * gr * verb

    # --- dsp helpers ----------------------------------------------------------

    @staticmethod
    def tt(dur):
        return np.arange(int(dur * SR)) / SR

    @staticmethod
    def midi(m):
        return 440.0 * 2 ** ((m - 69) / 12)

    @staticmethod
    def filt(x, kind, f, order=2):
        if kind == 'bp':
            sos = signal.butter(order, [f[0], f[1]], 'bandpass', fs=SR, output='sos')
        else:
            sos = signal.butter(order, f, kind, fs=SR, output='sos')
        return signal.sosfilt(sos, x)

    @staticmethod
    def saw(f, t, detune=0.0):
        ph = (f * (1 + detune) * t) % 1.0
        return 2 * ph - 1

    @staticmethod
    def adsr(n, a=0.005, d=0.1, s=0.6, r=0.08, hold=None):
        a_n, d_n, r_n = int(a * SR), int(d * SR), int(r * SR)
        hold_n = n - a_n - d_n - r_n if hold is None else int(hold * SR)
        hold_n = max(hold_n, 0)
        env = np.concatenate([
            np.linspace(0, 1, max(a_n, 1)),
            np.linspace(1, s, max(d_n, 1)),
            np.full(hold_n, s),
            np.linspace(s, 0, max(r_n, 1)),
        ])
        return env[:n] if len(env) >= n else np.pad(env, (0, n - len(env)))

    # --- drums ----------------------------------------------------------------

    def kick(self, v=1.0):
        t = self.tt(0.55)
        f = 44 + 96 * np.exp(-t * 30)
        ph = 2 * np.pi * np.cumsum(f) / SR
        body = np.sin(ph) * np.exp(-t * 6.5)
        click = self.filt(self.rng.standard_normal(len(t)), 'hp', 2500) * np.exp(-t * 400) * 0.35
        return np.tanh((body + click) * 1.6) * v

    def clap(self, v=1.0):
        t = self.tt(0.32)
        n = self.rng.standard_normal(len(t))
        env = np.zeros(len(t))
        for k, off in enumerate((0.0, 0.009, 0.019)):
            i = int(off * SR)
            env[i:] += np.exp(-(t[: len(t) - i]) * (220 if k < 2 else 18)) * (0.8 if k < 2 else 1.0)
        noise = self.filt(n, 'bp', (900, 5200)) * env
        body = np.sin(2 * np.pi * 195 * t) * np.exp(-t * 32) * 0.4
        return (noise + body) * v

    def hat(self, v=1.0, open_=False):
        t = self.tt(0.3 if open_ else 0.06)
        n = self.filt(self.rng.standard_normal(len(t)), 'hp', 7200)
        return n * np.exp(-t * (11 if open_ else 75)) * v

    def crash(self, v=1.0):
        t = self.tt(2.2)
        n = self.filt(self.rng.standard_normal(len(t)), 'hp', 3800)
        return n * np.exp(-t * 2.1) * v

    def snare(self, v=1.0):
        t = self.tt(0.18)
        n = self.filt(self.rng.standard_normal(len(t)), 'bp', (1500, 7000)) * np.exp(-t * 26)
        body = np.sin(2 * np.pi * 215 * t) * np.exp(-t * 40) * 0.5
        return (n + body) * v

    def riser(self, bars):
        t = self.tt(bars * self.bar)
        n = self.rng.standard_normal(len(t))
        out = np.zeros_like(n)
        blocks = 48
        edges = np.linspace(0, len(t), blocks + 1).astype(int)
        for b in range(blocks):
            lo = 400 + 7000 * (b / blocks) ** 2
            out[edges[b]:edges[b + 1]] = self.filt(n[edges[b]:edges[b + 1]], 'bp', (lo, lo * 1.6))
        return out * np.linspace(0.05, 1, len(t)) ** 2

    # --- pitched --------------------------------------------------------------

    def bass_note(self, m, dur, funky=True, v=1.0):
        t = self.tt(dur + 0.04)
        f = self.midi(m)
        raw = 0.6 * self.saw(f, t) + 0.4 * np.sign(np.sin(2 * np.pi * f * t))
        if funky:
            bright = self.filt(raw, 'lp', 2400)
            dark = self.filt(raw, 'lp', 320)
            c = np.exp(-t * 26)
            tone = c * bright + (1 - c) * dark
        else:
            tone = self.filt(raw, 'lp', 260)
        sub = np.sin(2 * np.pi * f * t) * 0.9
        env = self.adsr(len(t), a=0.003, d=0.08, s=0.7, r=0.03)
        return np.tanh((tone * 0.7 + sub) * env * 1.4) * v

    def ep_chord(self, ms, dur, v=1.0):
        t = self.tt(dur + 0.3)
        out = np.zeros(len(t))
        for m in ms:
            f = self.midi(m)
            idx = 2.2 * np.exp(-t * 9)
            out += np.sin(2 * np.pi * f * t + idx * np.sin(2 * np.pi * f * t))
        env = self.adsr(len(t), a=0.002, d=0.25, s=0.35, r=0.25, hold=max(dur - 0.25, 0))
        return out * env / len(ms) * v

    def brass_chord(self, ms, dur, v=1.0, cutoff=3200, fall=False):
        t = self.tt(dur + 0.12)
        out = np.zeros(len(t))
        for m in ms:
            f = self.midi(m)
            if fall:
                f = f * 2 ** (-np.clip((t - dur * 0.55) / (dur * 0.45), 0, 1) * 3 / 12)
                ph = np.cumsum(f) / SR
                for d in (-0.006, 0.0, 0.006):
                    out += 2 * ((ph * (1 + d)) % 1.0) - 1
            else:
                for d in (-0.006, 0.0, 0.006):
                    out += self.saw(f, t, d)
        out = self.filt(out, 'lp', cutoff)
        env = self.adsr(len(t), a=0.012, d=0.12, s=0.55, r=0.1)
        return np.tanh(out * env / (len(ms) * 2.2) * 2.0) * v

    def orch_hit(self, ms, v=1.0, ring=0.9):
        t = self.tt(ring)
        out = self.brass_chord(ms + [m + 12 for m in ms], ring - 0.12, v=1.0, cutoff=5200)[: len(t)]
        burst = self.filt(self.rng.standard_normal(len(t)), 'bp', (300, 6000)) * np.exp(-t * 30) * 0.6
        timp = np.sin(2 * np.pi * self.midi(ms[0] - 12) * t) * np.exp(-t * 4) * 0.8
        return (out + burst + timp) * v

    def lead_note(self, m, dur, v=1.0):
        t = self.tt(dur + 0.06)
        f = self.midi(m) * (1 + 0.004 * np.sin(2 * np.pi * 5.5 * t) * np.clip(t / 0.25, 0, 1))
        ph = np.cumsum(f) / SR
        tone = 0.55 * np.sign(np.sin(2 * np.pi * ph)) + 0.45 * (2 * (ph % 1.0) - 1)
        tone = self.filt(tone, 'lp', 3400)
        env = self.adsr(len(t), a=0.008, d=0.08, s=0.75, r=0.05)
        return tone * env * v

    def pad(self, ms, dur, v=1.0):
        t = self.tt(dur)
        out = np.zeros(len(t))
        for m in ms:
            for d in (-0.004, 0.004):
                out += self.saw(self.midi(m), t, d)
        out = self.filt(out, 'lp', 1200)
        env = self.adsr(len(t), a=0.4, d=0.1, s=0.9, r=0.5)
        return out * env / (len(ms) * 2) * v

    # --- phrases ----------------------------------------------------------------

    def bass_bar(self, bar, chord, pattern, funky=True, v=0.55):
        r = self.root[chord]
        for pos, iv, ln in pattern:
            self.place(self.bass_note(r + iv, ln * self.s16 * 0.92, funky=funky), self.at(bar, pos), v)

    def ep_bar(self, bar, chord, v=0.2):
        for pos in (2, 6, 10, 14):  # the off-beat comp
            self.place(self.ep_chord(self.ch[chord], self.s16 * 1.6), self.at(bar, pos), v, pan=-0.3, verb=0.25)

    def drums(self, bar, kicks, claps=(4, 12), hats='16', v=1.0, open_hat=(14,), gang=False):
        for p in kicks:
            self.place(self.kick(), self.at(bar, p), 0.95 * v)
        for p in claps:
            self.place(self.clap(), self.at(bar, p), 0.5 * v, pan=0.05, verb=0.35)
        if gang:
            for p in (0, 4, 8, 12):
                self.place(self.clap(), self.at(bar, p), 0.22 * v, pan=-0.25, verb=0.4)
        if hats:
            step = 1 if hats == '16' else 2
            for p in range(0, 16, step):
                if p in open_hat:
                    self.place(self.hat(open_=True), self.at(bar, p), 0.16 * v, pan=0.3)
                    continue
                acc = 1.0 if p % 4 == 2 else (0.75 if p % 2 == 0 else 0.5)
                self.place(self.hat(), self.at(bar, p), 0.2 * acc * v, pan=0.3)

    def roll(self, bar, start16, end16, v=0.45):
        """A snare roll on straight 16ths, rising in velocity; may cross bars."""
        n = end16 - start16
        for k, p in enumerate(range(start16, end16)):
            b, q = bar + p // 16, p % 16
            self.place(self.snare(0.3 + 0.7 * k / max(n - 1, 1)), self.at(b, q, swing=False), v, pan=-0.1, verb=0.2)

    def hook(self, bar, phrase, octave=0, v=0.28, harmony=False):
        for pos, m, ln in self.hook_phrases[phrase % len(self.hook_phrases)]:
            nt = m + 12 * octave
            dur = ln * self.s16 * 0.95
            self.place(self.lead_note(nt, dur), self.at(bar, pos), v, pan=0.15, verb=0.3)
            self.place(self.brass_chord([nt - 12], dur, cutoff=2600), self.at(bar, pos), v * 0.8, pan=-0.15, verb=0.25)
            if harmony:
                self.place(self.lead_note(nt - 5, dur), self.at(bar, pos), v * 0.6, pan=-0.35, verb=0.3)

    # --- textures -------------------------------------------------------------
    # Each takes a section dict and writes its bars. `g` scales every level in
    # the texture; at the reference energy it is 1 and the texture plays as
    # tuned. Per-section overrides: kicks (a list, or a list of lists cycled
    # per bar), claps, hats ('16', '8' or ''), open_hats.

    @staticmethod
    def _bars(s):
        return list(range(int(s['bars'][0]), int(np.ceil(s['bars'][1]))))

    @staticmethod
    def _bp(x):
        """A bar position as (bar, 16th): 27.5 is (27, 8)."""
        bar = int(np.floor(x + 1e-9))
        return bar, int(round((x - bar) * 16))

    @staticmethod
    def _chord(s, k):
        chords = s['chords']
        return chords[k % len(chords)]

    @staticmethod
    def _kicks(s, k, default):
        kicks = s.get('kicks')
        if kicks is None:
            return default
        if kicks and isinstance(kicks[0], list):
            return kicks[k % len(kicks)]
        return kicks

    def _g(self, s):
        return s['energy'] / TEXTURE_ENERGY[s['texture']]

    def _entry(self, s, big=False, verb=0.3):
        """The crash and the orchestra hit that open a section, when asked."""
        b0 = int(s['bars'][0])
        if s.get('crash'):
            self.place(self.crash(1.2) if big else self.crash(), self.at(b0, 0), s['crash'], verb=verb)
        if s.get('hit'):
            self.place(self.orch_hit(self.ch[s['hit']], ring=0.6), self.at(b0, 0), s.get('hit_level', 0.35), verb=0.4)

    def tex_intro(self, s):
        """An orchestra hit on the first chord, a riser across the last bar."""
        bars = self._bars(s)
        last = bars[-1]
        self.place(self.orch_hit(self.ch[s['chords'][0]], ring=s.get('ring', 1.8)), self.at(bars[0], 0), 0.55, verb=0.6)
        self.place(self.riser(1.0), self.at(last, 0), 0.12, verb=0.3)
        for p in range(8, 16, 2):
            self.place(self.hat(), self.at(last, p), 0.12, pan=0.3)
        self.place(self.kick(), self.at(last, 12), 0.6)

    def tex_build(self, s):
        """Low drums, a sub bass, a pad: the groove before it arrives."""
        g = self._g(s)
        for k, b in enumerate(self._bars(s)):
            ch = self._chord(s, k)
            self.drums(b, kicks=self._kicks(s, k, (0, 8)), claps=s.get('claps', (4, 12)), hats=s.get('hats', '8'),
                       v=s['energy'], open_hat=s.get('open_hats', (14,)))
            self.bass_bar(b, ch, self.sub, funky=False, v=0.45 * g)
            self.place(self.pad(self.ch[ch], self.bar), self.at(b, 0), 0.18 * g, verb=0.3)
        self._entry(s)

    def tex_groove(self, s):
        """The main groove: syncopated kick, claps on 2 and 4, the EP comp."""
        g = self._g(s)
        for k, b in enumerate(self._bars(s)):
            ch = self._chord(s, k)
            self.drums(b, kicks=self._kicks(s, k, (0, 6, 8, 11)), claps=s.get('claps', (4, 12)),
                       hats=s.get('hats', '8'), v=s['energy'], open_hat=s.get('open_hats', (6, 14)))
            self.bass_bar(b, ch, self.sub, funky=True, v=0.38 * g)
            self.ep_bar(b, ch, v=0.15 * g)
        self._entry(s, verb=0.2)

    def tex_stop(self, s):
        """Stop-time: the band hits together on `hits` (16ths), silence between."""
        g = self._g(s)
        for k, b in enumerate(self._bars(s)):
            ch = self._chord(s, k)
            for pos in s.get('hits', (0, 8)):
                self.place(self.kick(), self.at(b, pos), 0.95 * g)
                self.place(self.orch_hit(self.ch[ch], ring=0.5), self.at(b, pos), 0.42 * g, verb=0.35)
                self.place(self.bass_note(self.root[ch] + 12, self.s16 * 3, funky=True), self.at(b, pos), 0.5 * g)
                self.place(self.clap(), self.at(b, pos), 0.3 * g, verb=0.4)
        self._entry(s)

    def tex_pump(self, s):
        """Four on the floor with brass on every beat."""
        g = self._g(s)
        for k, b in enumerate(self._bars(s)):
            ch = self._chord(s, k)
            self.drums(b, kicks=self._kicks(s, k, (0, 4, 8, 12)), claps=s.get('claps', (4, 12)),
                       hats=s.get('hats', '8'), v=s['energy'], open_hat=s.get('open_hats', (2, 6, 10, 14)))
            self.bass_bar(b, ch, self.sub, funky=True, v=0.5 * g)
            for pos in (0, 4, 8, 12):
                self.place(self.brass_chord(self.ch[ch], self.s16 * 1.4, cutoff=2400), self.at(b, pos), 0.2 * g, pan=0.2, verb=0.2)
        self._entry(s, verb=0.2)

    def tex_spin(self, s):
        """A fill section: a snare roll and a riser, the last beat silent."""
        b0, b1 = s['bars']
        bar, p0 = self._bp(b0)
        n16 = int(round((b1 - b0) * 16))
        level = s.get('level', 0.95)
        self.roll(bar, p0, p0 + n16 - 4, v=level)
        self.place(self.riser((n16 - 4) / 16), self.at_bar(b0), 0.42, verb=0.3)
        for p in range(p0, p0 + n16 - 4, 4):  # the kick keeps the fill on the grid
            self.place(self.kick(), self.at(bar + p // 16, p % 16), 0.7)

    def tex_drop(self, s):
        """The biggest groove before the end: the funk riff, the hook, stabs."""
        g = self._g(s)
        for k, b in enumerate(self._bars(s)):
            ch = self._chord(s, k)
            default = (0, 6, 8, 11, 15) if k % 2 else (0, 6, 8, 11)
            self.drums(b, kicks=self._kicks(s, k, default), claps=s.get('claps', (4, 12)), hats=s.get('hats', '16'),
                       v=s['energy'], open_hat=s.get('open_hats', (14,)))
            self.bass_bar(b, ch, self.riff, funky=True, v=0.66 * g)
            self.ep_bar(b, ch, v=0.16 * g)
            self.hook(b, k, v=0.34 * g)
            for pos in (2, 10):  # brass stabs on the off-beats
                self.place(self.brass_chord(self.ch[ch], self.s16 * 1.2, cutoff=3000), self.at(b, pos), 0.2 * g, pan=0.25, verb=0.2)
        self._entry(s, big=True)

    def tex_dark(self, s):
        """A darker section: held bass, a pad, a snare on every beat."""
        g = self._g(s)
        bars = self._bars(s)
        for k, b in enumerate(bars):
            ch = self._chord(s, k)
            self.drums(b, kicks=self._kicks(s, k, (0, 8, 10)), claps=s.get('claps', (4, 12)), hats=s.get('hats', '8'),
                       v=s['energy'], open_hat=s.get('open_hats', ()))
            self.bass_bar(b, ch, self.held, funky=False, v=0.5 * g)
            if k % 2 == 0:
                span = min(2, len(bars) - k)
                self.place(self.pad(self.ch[ch], span * self.bar), self.at(b, 0), 0.32 * g, verb=0.45)
            for pos in (0, 4, 8, 12):
                self.place(self.snare(0.4), self.at(b, pos), 0.12 * g, pan=-0.2, verb=0.3)
        self._entry(s)

    def tex_chorus(self, s):
        """Everything: the hook an octave up with a harmony, gang claps."""
        g = self._g(s)
        for k, b in enumerate(self._bars(s)):
            ch = self._chord(s, k)
            self.drums(b, kicks=self._kicks(s, k, (0, 6, 8, 11, 15)), claps=s.get('claps', (4, 12)),
                       hats=s.get('hats', '16'), v=s['energy'], open_hat=s.get('open_hats', (14,)), gang=True)
            self.bass_bar(b, ch, self.riff, funky=True, v=0.8 * g)
            self.ep_bar(b, ch, v=0.2 * g)
            self.hook(b, k, octave=s.get('octave', 1), v=0.38 * g, harmony=True)
            self.place(self.pad(self.ch[ch], self.bar), self.at(b, 0), 0.3 * g, verb=0.4)
            for pos in (2, 10):
                self.place(self.brass_chord(self.ch[ch], self.s16 * 1.2, cutoff=3400), self.at(b, pos), 0.24 * g, pan=0.25, verb=0.2)
            for p in range(0, 16):
                self.place(self.hat(0.6), self.at(b, p), 0.07 * g, pan=-0.4)  # tambourine-ish 16ths
        self._entry(s, big=True)

    def tex_ending(self, s):
        """A pickup roll, hits, and the last hit ringing out to the end."""
        b0 = s['bars'][0]
        pickup = s.get('pickup', 0)
        if pickup:
            bar, p0 = self._bp(b0)
            self.roll(bar, p0, p0 + int(round(pickup * 16)), v=0.95)
            self.place(self.riser(pickup), self.at_bar(b0), 0.35, verb=0.3)
        hits = sorted(s['hits'], key=lambda h: h['at'])
        for h in hits[:-1]:
            t = self.at_bar(h['at'])
            self.place(self.orch_hit(self.ch[h['chord']], ring=0.45), t, 0.4, verb=0.4)
            self.place(self.kick(), t, 0.9)
        last = hits[-1]
        t = self.at_bar(last['at'])
        ch = last['chord']
        self.place(self.kick(), t, 1.0)
        self.place(self.orch_hit(self.ch[ch], ring=last.get('ring', 3.6)), t, 0.6, verb=0.7)
        self.place(self.brass_chord(self.ch[ch], 1.6, fall=True), t, 0.25, verb=0.5)
        self.place(self.bass_note(self.root[ch] + 12, 2.5, funky=False), t, 0.5)
        self.place(self.crash(1.3), t, 0.4, verb=0.4)
        for b in range(int(np.floor(last['at'])) + 1, int(np.ceil(s['bars'][1]))):
            for p in range(0, 16, 2):  # the hats carry the room out under the fade
                self.place(self.hat(0.5), self.at(b, p), 0.08, pan=0.3)

    def tex_silence(self, s):
        pass

    # --- render ---------------------------------------------------------------

    def arrange(self):
        fills = self.spec.get('fills', [])
        for s in self.spec['sections']:
            getattr(self, 'tex_' + s['texture'])(s)
            b0, b1 = s['bars']
            for f in fills:  # a fill belongs to the section it sits in
                if b0 <= f['bar'] < b1:
                    self.roll(int(f['bar']), int(f.get('from', 12)), int(f.get('to', 16)), v=f.get('level', 0.6))

    def render(self, path):
        self.arrange()
        rng = self.rng
        ir_t = self.tt(1.6)
        irL = rng.standard_normal(len(ir_t)) * np.exp(-ir_t * 3.2)
        irR = rng.standard_normal(len(ir_t)) * np.exp(-ir_t * 3.2)
        irL = self.filt(irL, 'lp', 6000)
        irR = self.filt(irR, 'lp', 6000)
        irL /= np.sqrt(np.sum(irL ** 2))
        irR /= np.sqrt(np.sum(irR ** 2))
        wetL = signal.fftconvolve(self.VL, irL)[: len(self.L)]
        wetR = signal.fftconvolve(self.VR, irR)[: len(self.R)]
        mixL = self.L + wetL * 0.5
        mixR = self.R + wetR * 0.5

        # Glue: a gentle bus saturation, then cut to the program's length exactly.
        n = int(round(self.length * SR))
        mix = np.stack([mixL[:n], mixR[:n]], axis=1)
        mix = self.filt(mix.T, 'hp', 28).T
        peak = np.max(np.abs(mix))
        mix = np.tanh(mix / peak * 1.4) / np.tanh(1.4)
        mix *= 0.89
        wavfile.write(path, SR, mix.astype(np.float32))

        print(f'wrote {path}: {n / SR:.4f} s, {self.bars} bars at {self.bpm:g} BPM (bar = {self.bar:.4f} s)')
        print('section map (bars, seconds):')
        for s in self.spec['sections']:
            b0, b1 = s['bars']
            energy = f'  energy {s["energy"]:g}' if 'energy' in s else ''
            print(f'  {b0:>5g} to {b1:<5g} {b0 * self.bar:7.3f} to {b1 * self.bar:7.3f} s  {s["texture"]:<8} {s["name"]}{energy}')


if __name__ == '__main__':
    main()
