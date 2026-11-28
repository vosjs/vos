---
'@vosjs/cli': minor
---

`vos record`, `vos create` and `vos look --actions`: what a script may reach on your machine is said on the command line.

An `actions.json` is a file that travels, and the recorder runs it with your own desktop, shell and signed-in browser. A script now describes a walk and never widens its own reach:

- **The desktop.** A script that names an `app` (or a stage's `apps`) runs only with `--app` (or `--window` / `--pid`) on the command line. Before, the file alone sent the take to the desktop driver.
- **Shell variables.** `{ "env": "NAME" }` is read only for names passed as `--env NAME`, including on `--hosted`. Before, a script could read any variable in the shell.
- **Code in the page.** A `js` check runs only with `--allow-js`.
- **Saved sign-ins.** A peer's `storageState` outside the script's own directory needs `--allow-state <file>`.

Each refusal names the flag that grants it, with the script's own names.

The take server (`vos open`, the render and digest pages) answers only requests addressed to its own loopback name, so a page that points a DNS name at this machine reads nothing, and its pages can save pictures and media only: never a file a later command reads as code.

**Migration.** A script that reads `{ env }` (a `--play` program's take included) needs `--env NAME` for each name; a desktop script that relied on its own `"app"` needs `--app`; a script with a `js` check needs `--allow-js`.
