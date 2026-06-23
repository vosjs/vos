# Changesets

This folder is managed by [Changesets](https://github.com/changesets/changesets).

When you make a change that should be released, run:

```bash
pnpm changeset
```

Pick the affected packages and a semver bump, write a short summary, and commit
the generated markdown file with your pull request. Merging accumulates a
"Version Packages" PR; merging that PR versions the packages and publishes them.
