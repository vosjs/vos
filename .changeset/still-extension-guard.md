---
'@vosjs/cli': patch
---

`vos still` refuses a `.png`/`.jpg` output name in words: the capture template writes WebP, and a still named `.png` shipped WebP bytes under a lying extension, which stores refuse as a mislabelled image.
