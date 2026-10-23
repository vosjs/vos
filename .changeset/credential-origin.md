---
'@vosjs/cli': patch
---

The credential `vos login` stores carries the origin it was minted for (a file written before that line is `https://vos.so`'s), and it is sent only there: a command aimed at another origin sends no key and says so once. A key handed to the command (`--key`, `VOS_API_KEY`) goes where the command goes. A 401 names where to mint a key on the origin in use, and a request that gets no answer names the origin it could not reach.

`vos push` asks for consent before it reads the platform's release or bakes anything. `vos score` reports the level the film hears from the stretch of the track it plays, not the whole file. `vos validate <take>` refuses an audio clip whose key names no file in the take.
