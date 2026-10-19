---
'@vosjs/cli': minor
---

Seven small hardenings of what the CLI takes from a server, a file or an address it did not write:

- A slug, title or file name the server chose is held to a plain path segment before it becomes a directory or file on disk (`vos fetch`, `vos folder pull`, a pulled manifest's names); the id stands in when nothing is left.
- Every file the CLI writes into a take or program directory (`doc.json`, `vos.json`, `config.json`, recipes, downloaded media) refuses a symbolic link already at the path, in words, instead of writing through it.
- `vos ingest` inflates a Playwright `trace.zip` under a budget (64 MiB per entry, 256 MiB in all) and stops in words past it, whatever the archive declares.
- `vos asset import` and `vos brand` refuse an address on this machine or its network (loopback, private ranges, link-local, in every spelling) and any scheme but http(s) before fetching, and follow at most five redirects, each held to the same rule.
- An HTML layer's `fonts[].url` is held to `https://assets.vos.so/`, a hosted file, or a `.woff2` beside the document, the way its images are; a face on another host is refused by `vos validate` and dropped by a local render, in words.
- A take's `url` and a setup's `goto` take only http and https; `vos record --url` refuses the rest in words.
- `vos record` says which environment variable NAMES a script's setup will read from this shell (one line, or an `env` event under `--json`) before any value is resolved, so a script you did not write is read before it is run. Values are never printed.
