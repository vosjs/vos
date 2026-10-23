---
'@vosjs/cli': minor
---

`vos join … --keep-edits` joins again over an edited joined take and keeps its edits. Every join writes `join.json` (each input's path, footage sha256 and media id), so inputs are matched to their media by source file, never by position: a kept input keeps its id and everything on it (segments in their edited order, spans, rejections, anchored layers, its sound), the frame, export, styles and still stay, a new input is joined fresh under an id no media ever held (and only it is captioned or re-planned), and an input that is gone takes its edits with it, each named in the done line. A layer, prop or still placed at an output second follows the footage it played over. A take joined before `join.json` is matched by the footage it holds. A joined media now carries its script, so its step captions are read from the joined take.
