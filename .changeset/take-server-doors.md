---
'@vosjs/cli': minor
---

The take server listens on loopback only, hands `vos open` a base with a per-start token in its path that a page on another origin must read through, serves nothing above the take directory however the path is spelled, and writes only a plain file name from its own pages. `vos push` and `vos render` read a document's media keys inside the document's directory or below, never outside it. `vos fetch --media` and `vos pull --media` send the content key to the configured origin alone: a file-door address on another host is read from home by its id, and any other URL is fetched bare. A pushed document's script carries no typed setup value and no setup address query. `vos login` and `vos open` launch the browser with the URL as an argument, never a shell line, and the sign-in page must be on the origin asked. `vos port scaffold` writes a scene's name as a JSON string. The rehearsal's next-command line names a header, never its value.
