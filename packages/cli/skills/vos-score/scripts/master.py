#!/usr/bin/env python3
"""
Bring a composed WAV to a loudness target with ONE constant gain, then
encode it to a 192k MP3.

    python master.py score.wav score.mp3 [--lufs -16] [--tp -1.5]

A constant gain keeps the arrangement's section contrast exactly as composed.
Single-pass ffmpeg `loudnorm` does not: it rides the gain over a few seconds,
which flattens the build into the groove and the chorus into the drop, so
the shape analyze.py checked is no longer the shape that ships. This runs
loudnorm twice (measure, then `linear=true`). If ffmpeg cannot stay linear
(the gain would push the true peak over --tp), it applies a plain gain capped
by the peak instead and says how far under the target that leaves the file.
Needs ffmpeg with libmp3lame.
"""
import argparse
import json
import re
import subprocess
import sys


def loudnorm_json(stderr):
    m = re.findall(r'\{[^{}]*"input_i"[^{}]*\}', stderr)
    if not m:
        sys.exit('ffmpeg printed no loudnorm measurement:\n' + stderr[-2000:])
    return json.loads(m[-1])


def run(cmd):
    out = subprocess.run(cmd, capture_output=True, text=True)
    if out.returncode != 0:
        sys.exit(f'{" ".join(cmd[:3])}... failed:\n{out.stderr[-2000:]}')
    return out.stderr


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('wav')
    ap.add_argument('mp3')
    ap.add_argument('--lufs', type=float, default=-16.0, help='integrated loudness target (default -16)')
    ap.add_argument('--tp', type=float, default=-1.5, help='true-peak ceiling, dBTP (default -1.5)')
    ap.add_argument('--lra', type=float, default=20.0, help='loudness range allowed before ffmpeg gives up linear mode')
    a = ap.parse_args()

    target = f'I={a.lufs}:TP={a.tp}:LRA={a.lra}'
    m = loudnorm_json(run(['ffmpeg', '-hide_banner', '-i', a.wav, '-af',
                           f'loudnorm={target}:print_format=json', '-f', 'null', '-']))
    print(f'measured: {float(m["input_i"]):.1f} LUFS, true peak {float(m["input_tp"]):.1f} dBTP, '
          f'range {float(m["input_lra"]):.1f} LU')

    second = (f'loudnorm={target}:linear=true:print_format=json:measured_I={m["input_i"]}:'
              f'measured_TP={m["input_tp"]}:measured_LRA={m["input_lra"]}:'
              f'measured_thresh={m["input_thresh"]}:offset={m["target_offset"]}')
    r = loudnorm_json(run(['ffmpeg', '-hide_banner', '-y', '-i', a.wav, '-af', second, '-ar', '48000',
                           '-c:a', 'libmp3lame', '-b:a', '192k', a.mp3]))
    kind = r.get('normalization_type', '?')
    if kind == 'linear':
        print(f'wrote {a.mp3}: one gain of {a.lufs - float(m["input_i"]):+.2f} dB, '
              f'{float(r["output_i"]):.1f} LUFS, true peak {float(r["output_tp"]):.1f} dBTP')
        return

    # ffmpeg fell back to dynamic: never ship that, apply a plain capped gain.
    gain = min(a.lufs - float(m['input_i']), a.tp - float(m['input_tp']))
    run(['ffmpeg', '-hide_banner', '-y', '-i', a.wav, '-af', f'volume={gain:.3f}dB', '-ar', '48000',
         '-c:a', 'libmp3lame', '-b:a', '192k', a.mp3])
    level = float(m['input_i']) + gain
    print(f'loudnorm could not stay linear ({kind}); wrote {a.mp3} with one gain of {gain:+.2f} dB: '
          f'about {level:.1f} LUFS, {a.lufs - level:.1f} LU under the target, so the true peak stays under {a.tp:g} dBTP')


if __name__ == '__main__':
    main()
