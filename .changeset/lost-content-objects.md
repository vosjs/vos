---
'@vosjs/core': patch
'@vosjs/cli': patch
---

A program whose `createContent` returns objects it never added to a scene now says so. The engine never adds `content.objects` for you (the list is what the program added, for cleanup), so a forgotten `ctx.scene.add()` drew nothing and raised no error. The engine warns `[vos] createContent returned N objects that no scene holds…` after creating and after rebuilding content (a returned `Scene` is exempt, since a program may render a private one), and `vos still` and `vos render` print that warning beside the flat-colour one.
