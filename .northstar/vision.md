# Open-Codemap — Vision

_Adopted from an existing repository (v0.1.1, published to npm as `@alaa-taieb/open-codemap`). Sections marked **(inferred)** were derived from the README and code, not stated by the owner._

## Purpose
Open-Codemap is a local-first, open-source (MIT) codebase indexer and retriever. It parses any repository into structurally coherent chunks (functions, classes, methods), embeds them with a swappable embedder, stores everything in one portable SQLite file per workspace, and answers queries with hybrid retrieval (vector + BM25 + code graph) fused by Reciprocal Rank Fusion. It exists so AI coding assistants can find the *right* function instead of a fuzzy blob of the repo.

## Target audience (inferred)
- Developers building AI coding agents and tools who need precise code retrieval.
- Individual developers who want semantic and identifier search over their own repos without a hosted service.

## Problems it solves
- "Dump the repo into the prompt" loses structure and fails on large codebases.
- Pure semantic search misses exact identifiers; pure keyword search misses meaning.
- Hosted code-search products lock you into a provider and send your code off the machine.

## Core functionality
1. **Structural indexing** — tree-sitter (WASM) parsing for ~150 languages, cAST-style chunking with a sliding-window fallback.
2. **Incremental + live indexing** — only changed chunks are re-embedded; renamed code is fixed up by content hash; optional watch mode.
3. **Hybrid retrieval** — vector KNN, BM25 (FTS5) and an import/call graph, fused with RRF, with optional graph expansion.
4. **Pluggable embedders** — deterministic offline mock, Voyage `code-3`, Jina v3.
5. **One engine, three surfaces** — TypeScript library (ESM + CJS), CLI, and HTTP API.

## Differentiators
- Combines meaning, exact identifiers and code structure in one ranked result.
- Single portable SQLite file per workspace; zero native compilation (WASM tree-sitter + `node:sqlite`).
- Works fully offline with the mock embedder; no lock-in to a paid embedding provider.

## Principles (inferred)
- Local-first: code and index stay on the machine unless the user picks a remote embedder.
- Interface-first: storage, embedder and reranker sit behind interfaces so backends can be swapped.
- Degrade gracefully: if the embedder fails, retrieval falls back to BM25 + graph.
- Small, honest public API with documented limits.

## Constraints
- Node.js >= 22.5 (built-in `node:sqlite`), pnpm >= 10.
- MIT licence; published on npm as `@alaa-taieb/open-codemap`.
- No native build step required.
- GitHub Actions is unavailable on the owner's account, so CI gates (lint, typecheck, test, build) must be runnable locally.

## Explicitly excluded (inferred)
- A hosted/cloud service or multi-tenant server.
- A UI or IDE extension (consumers build those on top).
- Code generation or LLM answering — Open-Codemap only finds code.

## Definition of long-term success (inferred)
- AI agents and tools integrate Open-Codemap as their code-retrieval layer via the library, CLI or API.
- Retrieval returns the relevant function in the top results for both identifier and plain-English questions on real repositories.
- Indexing stays fast and incremental on large repos, with no native-dependency install failures.
