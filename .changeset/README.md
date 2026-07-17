# Changesets

This directory holds [Changesets](https://github.com/changesets/changesets) used to
manage versioning and the changelog.

To record a user-facing change:

```bash
pnpm changeset
```

Then choose the semver bump and write a summary. On merge, the release workflow
consumes the changesets, bumps versions, updates `CHANGELOG.md`, and publishes to npm.
