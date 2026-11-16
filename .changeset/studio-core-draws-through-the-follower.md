---
'@vosjs/studio-core': patch
---

A lowered take draws its footage through the player's follower when the player can supply the picture (`media.draw`), and tells it what it needs to: that the card draws through it, whether the media carries sound, whether the document has a fast piece, and what piece comes next on the same media. In a player with a decoder switched on, a take's fast pieces are then drawn from the decoder, on the clock, with cuts between them landing on their first frame. In every other player nothing changes: the element is drawn as before, and the program's own copy of the rule is untouched.
