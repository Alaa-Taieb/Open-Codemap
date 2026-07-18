# Changelog

This project adheres to [Semantic Versioning](https://semver.org/) and uses
[Changesets](https://github.com/changesets/changesets) to manage releases.

## Unreleased

- Initial scaffold (Phase 0): package, tooling, and CI setup.

## 0.1.1

Integration-blocking fixes (all additive / doc-only — the exported API surface is unchanged):

- **D1 — Dual ESM + CJS build.** `tsup` now emits both `.js` (ESM) and `.cjs` (CJS)
  bundles; `package.json` gains `main`/`module` + a `"require"` export condition for
  `.`, `./cli`, and `./api`. CommonJS consumers (Node, Electron) can now
  `require('@alaa-taieb/open-codemap')` without `ERR_PACKAGE_PATH_NOT_EXPORTED`.
- **D2 — Export `TreeSitterParser`.** The parser class (and the `parser` singleton +
  `SyntaxTree` type) are now re-exported from the package root barrel, matching the
  documented library example.
- **D3 — Bundler-proof grammar resolution.** `loadLanguage` resolves tree-sitter grammar
  `.wasm` files via `createRequire().resolve('tree-sitter-wasm')` + the real
  `out/<lang>/tree-sitter-<lang>.wasm` layout, instead of `tree-sitter-wasm`'s
  `getWasmPath` (which resolves relative to the package's own `import.meta.url` and
  breaks when OCM is bundled). Exposed `resolveGrammarWasmPath(lang)` for testing.
- **D4 — No husky in published scripts.** Removed the `postinstall` script and replaced
  `prepare` with a `.husky/`-guarded `node -e` one-liner, so a fresh install of the
  package shows no git-hook noise while the author still gets hooks locally.
- **D5 — README / API alignment.** The `Retriever` example now passes the required
  `repoId`; added a "Library API notes" section documenting that `mode` is a _result_
  field (not a request option) and that `embed()` takes a string array (batched). The
  `Retriever` constructor now throws `ConfigError` if `repoId` is missing.
- Added regression unit tests: `cjs-require.test.ts`, `grammar-resolution.test.ts`,
  `retriever-api-shape.test.ts`.
