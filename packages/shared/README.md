# @vosso/shared

Small, dependency-free helpers and types shared across the vosso apps, the
studio's document model and the vos CLI plugin. Consumed in-source and bundled
into [`@vosso/vos-plugin`](../vos-plugin). MIT.

## Exports

```ts
import { formatLabel, generateId, sleep, safeJsonParse } from '@vosso/shared'
```

| Utility                         | Description                                                          |
| ------------------------------- | -------------------------------------------------------------------- |
| `formatLabel(filename)`         | Turn a slug/filename into a title (`'basic-fade'` → `'Basic Fade'`). |
| `generateId()`                  | A random UUID (`crypto.randomUUID`).                                 |
| `sleep(ms)`                     | Promise that resolves after `ms`.                                    |
| `safeJsonParse(json, fallback)` | Parse JSON, returning `fallback` on error.                           |

Subpaths: `@vosso/shared/types` and `@vosso/shared/utils`.

Keep this package lean — it's the lowest layer, so anything with a heavier
dependency or a product opinion belongs in `@vosso/studio-core` or the app.
