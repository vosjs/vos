---
'@vosjs/render-core': minor
'@vosjs/studio-core': minor
'@vosjs/cli': patch
---

The take carries its payload. Every recorded step keeps the page it left (`meta.steps[].url`, origin and path, never a query or a hash), and a step with `read: "<selector>"` in `actions.json` keeps that element's words once the step has settled (`meta.steps[].text`, trimmed, at most 2 KB; on a click, what the click opened), so a layer quotes the take instead of a second run of the flow. `vos digest` lists the script's steps (`steps`: each with its source and output windows through the cut, the page it left and the words it kept), and `vos validate actions.json` holds `read` to a selector.
