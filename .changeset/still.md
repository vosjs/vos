---
'@vosjs/studio-core': minor
---

The frame that stands for a document is one derivation, `docStillTime`: the author's own `still` (output seconds) wins, else the last freeze the document owns (a template's freezes, stamped `from`, never count), else the hero moment after the card and the opening clips have entered, else the old 0.5 s. An own freeze at the end of a take survives an end card laid on it.
