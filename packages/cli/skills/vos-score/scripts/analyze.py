#!/usr/bin/env python3
"""
Verify a score by numbers, because an agent cannot listen.

    python analyze.py score.mp3 --spec spec.json [--lufs -16]
    python analyze.py score.mp3 --bpm 124 --bars 30

Prints the tempo and first-beat fit (kick-band onset flux), the length, the
integrated loudness, per-bar loudness (all bands and the 30 to 150 Hz low
band), and, with a spec, per-section loudness against the reference section
and the checks below. Exits 1 when a check fails. Needs ffmpeg, numpy, scipy.

The checks (with --spec):
  grid      the tempo fit is the spec's BPM within 0.05, beat 1 within 0.02 s of t = 0
  length    the file is the program's length within 0.05 s
  order     a section with more energy is at least 0.5 dB louder than one with less
  biggest   the highest-energy section is at least 1 dB louder than every other
  holes     no bar falls more than 10 dB under the bar before it (a fill is not a hole)
  ring      the bar after the last hit is quieter than the hit's bar (the ending rings out)
  lufs      integrated loudness within 1 LU of --lufs, when given
"""
import argparse
import json
import re
import subprocess
import sys

import numpy as np
from scipy import signal

SR = 11025
# The energy each groove texture plays at by default (compose.py's TEXTURE_ENERGY).
TEXTURE_ENERGY = {'build': 0.65, 'groove': 0.72, 'stop': 0.75, 'pump': 1.0, 'drop': 1.05, 'dark': 0.8, 'chorus': 1.25}
GROOVES = tuple(TEXTURE_ENERGY)
ORDER_GAP = 0.03    # energies closer than this are not ordered
ORDER_STEP = 0.5    # dB a higher-energy section must clear
BIGGEST_STEP = 1.0  # dB the biggest moment must clear
HOLE = 10.0         # dB a bar may fall under the bar before it


def decode(path):
    out = subprocess.run(
        ['ffmpeg', '-v', 'error', '-i', path, '-ac', '1', '-ar', str(SR), '-f', 'f32le', '-'],
        capture_output=True,
    )
    if out.returncode != 0:
        sys.exit(f'ffmpeg could not read {path}: {out.stderr.decode().strip()}')
    return np.frombuffer(out.stdout, dtype=np.float32).astype(np.float64)


def integrated_lufs(path):
    out = subprocess.run(
        ['ffmpeg', '-v', 'info', '-i', path, '-af', 'loudnorm=print_format=json', '-f', 'null', '-'],
        capture_output=True, text=True,
    )
    m = re.search(r'"input_i"\s*:\s*"(-?[\d.]+|-inf)"', out.stderr)
    return float(m.group(1)) if m and m.group(1) != '-inf' else None


def tempo_fit(flux, fps, lo, hi, step):
    """The BPM and first-beat phase whose beat grid lands on the most kick onsets."""
    dur = len(flux) / fps
    best = (-1.0, None, None)
    for bpm in np.arange(lo, hi + step / 2, step):
        P = 60.0 / bpm
        offs = np.arange(0, P, 0.002)
        beats = np.arange(0, dur, P)
        idx = ((offs[:, None] + beats[None, :]) * fps).astype(int)
        valid = idx < len(flux)
        scores = np.where(valid, flux[np.minimum(idx, len(flux) - 1)], 0).sum(axis=1)
        k = int(np.argmax(scores))
        if scores[k] > best[0]:
            best = (scores[k], bpm, offs[k])
    return best[1], best[2]


def db(x):
    return 20 * np.log10(np.sqrt(np.mean(x ** 2)) + 1e-9) if len(x) else -180.0


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('audio')
    ap.add_argument('--spec', help='the compose spec: BPM, bars and the sections to check')
    ap.add_argument('--bpm', type=float, help='the grid tempo, without a spec')
    ap.add_argument('--bars', type=int, help='the number of bars, without a spec')
    ap.add_argument('--lufs', type=float, help='check integrated loudness against this target (the catalog is -16)')
    a = ap.parse_args()

    spec = None
    if a.spec:
        with open(a.spec) as f:
            spec = json.load(f)
    bpm = float(spec['bpm']) if spec else a.bpm
    bars = int(spec['bars']) if spec else a.bars

    x = decode(a.audio)
    sos = signal.butter(4, [30, 150], 'bandpass', fs=SR, output='sos')
    low = signal.sosfilt(sos, x)
    hop = 64
    fps = SR / hop
    n = (len(low) - hop) // hop
    env = np.sqrt(np.mean(low[: n * hop].reshape(n, hop) ** 2, axis=1))
    flux = np.maximum(0, np.diff(env, prepend=env[0]))

    if bpm:
        fit_bpm, phase = tempo_fit(flux, fps, bpm - 3, bpm + 3, 0.01)
    else:
        coarse, _ = tempo_fit(flux, fps, 70, 180, 0.1)
        fit_bpm, phase = tempo_fit(flux, fps, coarse - 0.3, coarse + 0.3, 0.01)
    P = 60.0 / fit_bpm
    off = min(phase, P - phase)  # distance of the beat grid from t = 0
    print(f'tempo fit: {fit_bpm:.2f} BPM, first beat at {phase:.3f} s')
    length = len(x) / SR
    print(f'length: {length:.3f} s')
    lufs = integrated_lufs(a.audio)
    if lufs is not None:
        print(f'integrated loudness: {lufs:.1f} LUFS')

    checks = []

    def check(name, ok, line):
        checks.append(ok)
        print(f'  {"pass" if ok else "FAIL"}  {name:<8} {line}')

    if not bpm:
        print('(no --spec or --bpm: the fit is a search from 70 to 180 BPM; half and double tempo are possible)')
        return

    BAR = 4 * 60.0 / bpm
    bars = bars or int(round(length / BAR))
    per_bar = []
    for b in range(bars):
        i0, i1 = int(b * BAR * SR), int((b + 1) * BAR * SR)
        per_bar.append((db(x[i0:i1]), db(low[i0:i1])))
    print('\nbar   start s  all dB  low dB')
    for b, (al, lo) in enumerate(per_bar):
        print(f'{b:3d}  {b * BAR:8.3f}  {al:6.1f}  {lo:6.1f}')

    print('\nchecks:')
    check('grid', abs(fit_bpm - bpm) <= 0.05 and off <= 0.02,
          f'{fit_bpm:.2f} BPM against {bpm:g}, beat 1 {off:.3f} s from t = 0 (limits 0.05 BPM, 0.02 s)')
    expect_len = float(spec.get('length', bars * BAR)) if spec else bars * BAR
    check('length', abs(length - expect_len) <= 0.05, f'{length:.3f} s against {expect_len:.3f} s')
    if a.lufs is not None:
        ok = lufs is not None and abs(lufs - a.lufs) <= 1.0
        check('lufs', ok, f'{lufs if lufs is not None else "unreadable"} against {a.lufs:g} (within 1 LU)')

    if spec:
        sections = spec['sections']
        loud = {}
        print('\nsection                 bars      texture  energy  all dB  low dB  vs ref')
        ref = next((s for s in sections if s['texture'] == 'groove'), None) or \
            next((s for s in sections if s['texture'] in GROOVES), None)
        for s in sections:
            b0, b1 = s['bars']
            i0, i1 = int(b0 * BAR * SR), int(b1 * BAR * SR)
            loud[s['name']] = (db(x[i0:i1]), db(low[i0:i1]))
        ref_db = loud[ref['name']][0] if ref else 0.0
        for s in sections:
            al, lo = loud[s['name']]
            if s['texture'] in GROOVES:
                s.setdefault('energy', TEXTURE_ENERGY[s['texture']])
            e = s.get('energy')
            es = f'{e:6.2f}' if e is not None else '      '
            mark = '  (ref)' if ref is s else ''
            print(f'{s["name"][:22]:<22}  {s["bars"][0]:>4g}-{s["bars"][1]:<4g}  {s["texture"]:<7}  {es}  '
                  f'{al:6.1f}  {lo:6.1f}  {al - ref_db:+5.1f}{mark}')

        print('\nshape:')
        grooves = [s for s in sections if s['texture'] in GROOVES]
        pairs, closest, order_failed = 0, None, False
        for i, s in enumerate(grooves):
            for t in grooves[i + 1:]:
                hi_s, lo_s = (s, t) if s['energy'] > t['energy'] else (t, s)
                if abs(s['energy'] - t['energy']) < ORDER_GAP:
                    continue
                pairs += 1
                step = loud[hi_s['name']][0] - loud[lo_s['name']][0]
                line = (f'{hi_s["name"]} (energy {hi_s["energy"]:g}) is {step:+.1f} dB over {lo_s["name"]} '
                        f'(energy {lo_s["energy"]:g}), needs +{ORDER_STEP:g}')
                if step < ORDER_STEP:
                    order_failed = True
                    check('order', False, line)
                elif closest is None or step < closest[0]:
                    closest = (step, line)
        if closest and not order_failed:
            check('order', True, f'{pairs} pairs in energy order; the closest: {closest[1]}')
        if grooves:
            top = max(grooves, key=lambda s: s['energy'])
            others = [s for s in sections if s is not top]
            if others:
                runner = max(others, key=lambda s: loud[s['name']][0])
                step = loud[top['name']][0] - loud[runner['name']][0]
                check('biggest', step >= BIGGEST_STEP,
                      f'{top["name"]} is {step:+.1f} dB over the next loudest, {runner["name"]} (needs +{BIGGEST_STEP:g})')
        silent = set()
        for s in sections:
            if s['texture'] == 'silence':
                silent.update(range(int(s['bars'][0]), int(np.ceil(s['bars'][1]))))
        worst = (0.0, None)
        for b in range(1, bars):
            if b in silent:
                continue
            fall = per_bar[b - 1][0] - per_bar[b][0]
            if fall > worst[0]:
                worst = (fall, b)
        check('holes', worst[0] <= HOLE,
              f'the deepest fall is {worst[0]:.1f} dB, into bar {worst[1]} (limit {HOLE:g} dB)' if worst[1] is not None
              else 'no bar falls under the bar before it')
        ending = next((s for s in sections if s['texture'] == 'ending'), None)
        if ending and ending.get('hits'):
            hb = int(np.floor(max(h['at'] for h in ending['hits'])))
            if hb + 1 < bars:
                check('ring', per_bar[hb + 1][0] < per_bar[hb][0],
                      f'bar {hb + 1} is {per_bar[hb + 1][0] - per_bar[hb][0]:+.1f} dB against the last hit\'s bar {hb}')

    failed = checks.count(False)
    print(f'\n{len(checks) - failed} of {len(checks)} checks pass' + ('' if not failed else f', {failed} FAIL'))
    if failed:
        sys.exit(1)


if __name__ == '__main__':
    main()
