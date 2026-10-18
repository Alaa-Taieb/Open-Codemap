# Open-Codemap — Specification

_Adopted from the existing code (v0.1.1). Items marked (inferred) are assumptions._

## Architecture
One core engine with thin adapters:
- **Parser** (`src/core/parser/`): `web-tree-sitter` + `tree-sitter-wasm` grammars; grammar `.wasm` resolved via `createRequire` so it survives bundling.
- **Chunker** (`src/core/parser/chunker.ts`): one chunk per top-level function/class/method, recursive split over token budget, sliding-window fallback.
- **Symbols** (`src/core/parser/symbols.ts`): symbol + import/call extraction for the graph.
- **Embedders** (`src/core/embed/`): `HashEmbedder` (mock, deterministic), `VoyageEmbedder` (`VOYAGE_AI_API_KEY`), `JinaEmbedder` (`JINA_API_KEY`); batched `embed(string[])`.
- **Store** (`src/core/store/`): `Store` interface; `SqliteStore` on `node:sqlite` with tables `chunks`, `symbols`, `edges`, `manifest`, FTS5 for BM25, JS cosine KNN over stored embeddings.
- **Registry** (`src/core/registry/`): workspace registry, `.codemap/<repo>.sqlite`, stable `repoId` from path / git remote.
- **Indexer** (`src/core/indexer.ts`, `watch.ts`): `.gitignore`-aware walk, per-file hashing, incremental re-embed, content-hash fix-up for moves, chokidar watch mode, dims-consistency guard (`--rebuild`).
- **Retriever** (`src/core/retriever.ts`): vector + BM25 + graph, RRF k=60, optional `expandGraph`, optional `Reranker` hook, fallback to BM25+graph on embedder failure; `repoId` required.
- **CLI** (`src/cli/`): `index <repo>` (`--embedder`, `--model`, `--rebuild`, `--watch`, `--ignore`), `query <repo> <text>` (`--top-k`, `--expand-graph`, `--json`), `list <repo>`, `serve <repo>` (`--port`, `--host`).
- **HTTP API** (`src/api/`, Fastify): `POST /index` (background job), `GET /jobs/:id`, `POST /query`, `GET /workspaces`.
- **Packaging**: tsup dual ESM + CJS for `.`, `./cli`, `./api`; bin `open-codemap`.

## Tooling
pnpm, TypeScript strict, ESLint flat config + Prettier, Vitest (unit + integration), husky + lint-staged + commitlint, Changesets.

## Test inventory
16 unit test files and 4 integration test files under `test/` (indexer, retriever, API, watch, store, parser, chunker, embedders, CJS require, grammar resolution, API shape).

## Known issues / inconsistencies found during adoption
- README says the default embedder is Voyage, but the CLI default (`--embedder`) is `mock`.
- `.changeset/initial-release.md` references package `open-codemap`, but the package is named `@alaa-taieb/open-codemap`; `CHANGELOG.md` still has a stale "Unreleased: Initial scaffold" entry.
- `.github/workflows/ci.yml` and `release.yml` exist, but GitHub Actions is disabled on the owner's account, so they do not currently run.
- Repository default branch is `main`; the remote also has a `master` branch. Branch policy is not yet decided for this repo.

## Known limits (from README)
- JS KNN instead of native `sqlite-vec`; fine for small/medium repos, unknown scaling on large ones.
- Best-effort call graph; precise cross-file call graph (LSP/SCIP) deferred.
- RRF only; reranker hook exists but no reranker ships.

## Unknowns
- Unknown: retrieval quality on real repositories — no benchmark or evaluation set exists.
- Unknown: performance and index size on large repositories.
- Unknown: intended primary consumer (a specific agent/harness) and the owner's priorities for v0.2.
