---
'@vosjs/cli': minor
---

An HTML layer's own face can be a `.woff2` beside its document.

- The doc lint takes a face `url` that is an https URL, a hosted file (`/api/assets/<id>/file`) or a `.woff2` beside the document, and says why for anything else: another format would be embedded as woff2 and drawn in a fallback face, and a path may not leave the document's directory.
- `vos push` (keyed or `--claimable`, program or take) uploads that face like any layer file and re-points the layer at the hosted file.
- `vos render`, `vos still` and `vos preview` serve a program's local face to the page, so a local render draws it.
