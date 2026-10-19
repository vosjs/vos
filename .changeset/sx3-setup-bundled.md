---
'@vosjs/cli': minor
---

`vos setup` installs the skills from the copy this package ships by default (the catalog at the release this CLI was cut from, reviewed with it, no network needed). `--skills-from-catalog` asks skills.sh instead, with the catalog CLI pinned and the repository at the same tag, so what lands is what this release was tested with either way; the bundled copy remains the fallback when skills.sh cannot be reached.
