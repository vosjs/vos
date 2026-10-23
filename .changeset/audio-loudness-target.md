---
'@vosjs/studio-core': minor
'@vosjs/cli': minor
---

An audio clip can carry a loudness target: `normalize` (integrated LUFS, -30..-6) beside its file's measured `loudness` (`{ lufs, peakDb, at, src }`). The lowering plays the clip at `10^((normalize - lufs) / 20) × gain`, which may exceed 1, capped so the sample peak stays under -1 dBFS and never lifted more than +24 dB, in the preview scheduler and the export mix alike (`clipGain`). The target applies only while `loudness.src` is the clip's key; a clip without one lowers byte for byte as before.

`vos audio measure <take>` writes every clip's `loudness` (BS.1770 integrated, K-weighted and gated, over the whole file, and the sample peak, by the meter `vos check-video` uses). `vos score` measures its track and sets `normalize: -16` with `--gain` as a trim on it (`--normalize <lufs|off>`); `vos join` measures the sound it adds. `vos validate` refuses a target out of range or a malformed measurement, and warns, with the verb to run, when a target is unmeasured, measured for another key, or held under its target by a cap. `vos push` and `vos pull --media` move `loudness.src` with the key.
