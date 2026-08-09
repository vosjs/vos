---
'@vosjs/cli': minor
---

The CLI is now engine-only: `render` / `still` / `info` / `check` / `preview` / `versions`, local and account-free. The platform verbs (`fetch` / `push` / `pull`) moved to the vos plugin (`@vosso/vos-plugin`, npm), next to the service they talk to — installed plugin verbs surface through `vos <verb>` exactly as before via a new delegate-on-unknown seam, appear in `vos help` through the plugin's manifest, and get a version row in `vos versions`. Existing installs keep working: the earlier plugin package names still resolve as fallbacks, and `vos voila <verb>` remains a hidden alias.
