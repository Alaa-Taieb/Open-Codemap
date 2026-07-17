# Contributing to Open-Codemap

Thanks for your interest in contributing!

## Development

```bash
pnpm install
pnpm typecheck   # tsc --noEmit (strict)
pnpm lint        # eslint + prettier
pnpm test        # vitest (uses the deterministic HashEmbedder — no API keys needed)
pnpm build       # tsup → dist/
```

## Commit conventions

We follow [Conventional Commits](https://www.conventionalcommits.org/). Commits are
linted via commitlint, and changesets drive versioning + changelog.

```bash
pnpm changeset   # describe a user-facing change
```

## Testing without paid keys

All tests run against `HashEmbedder` (deterministic, no network). Paid embedders
(Voyage `code-3`, Jina) are validated locally by the developer with a real key and
are excluded from CI by design.
