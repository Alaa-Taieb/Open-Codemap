/**
 * Store interface.
 *
 * The `init(dims)` method records the embedding dimensionality the store was built
 * with (used by the indexer/retriever for consistency checks). The vector KNN is
 * computed in JS (cosine) over the stored embeddings; BM25 uses SQLite FTS5; the
 * graph lives in normal tables. This keeps the storage backend swappable and
 * avoids any native build (the engine is `@sqlite.org/sqlite-wasm`).
 */

import type { RepoChunk, SymbolNode, Edge, EmbeddingVector } from '../../types/index.js';

export interface KnnHit {
  chunkId: number;
  distance: number;
}

export interface Bm25Hit {
  chunkId: number;
  score: number;
}

export interface GraphHit {
  neighborId: string;
  kind: Edge['kind'];
}

export interface Store {
  /** Initialize schema + create the vec0 table for the given dims. Idempotent. */
  init(dims: number): void;
  /** Dimensions the store was built with (0 if not yet initialized). */
  readonly dims: number;

  /** Insert or update chunks + their embeddings in a single transaction. */
  upsertChunks(chunks: Array<{ chunk: RepoChunk; embedding: EmbeddingVector }>): void;

  /** Delete chunks whose ids are listed. */
  deleteChunks(ids: number[]): void;

  /** Look up a chunk rowid by content hash (for incremental metadata updates). */
  getByHash(repoId: string, contentHash: string): number | null;

  /** Update a chunk's location (file/lines/symbol) without re-embedding it. */
  updateChunkMetadata(
    repoId: string,
    contentHash: string,
    loc: { file: string; startLine: number; endLine: number; symbol: string | null },
  ): void;

  /** Delete all chunks (and their FTS/embeddings/symbols) for a single repo file. */
  deleteChunksForFile(repoId: string, file: string): void;

  /** Nearest neighbors by cosine distance. */
  knn(vector: EmbeddingVector, k: number): KnnHit[];

  /** BM25 keyword search over chunk content. */
  bm25(query: string, k: number): Bm25Hit[];

  /** Graph neighbors of a symbol/edge id, optionally filtered by kind. */
  graphNeighbors(id: string, kind?: Edge['kind']): GraphHit[];

  /** Upsert symbols + edges for a file (replaces existing edges for that file scope). */
  upsertSymbols(symbols: SymbolNode[], edges: Edge[]): void;

  /** Record / read the manifest file hash for a repo file. */
  setManifest(repoId: string, file: string, fileHash: string): void;
  getManifest(repoId: string, file: string): string | null;

  /** All files recorded in the manifest for a repo. */
  allManifestFiles(repoId: string): string[];

  /** All chunk rows for a repo (used by the retriever's in-memory post-processing). */
  allChunks(repoId: string): RepoChunk[];

  /** Symbols for a repo (used by graph expansion). */
  allSymbols(repoId: string): SymbolNode[];

  /** Close the underlying database. */
  close(): void;
}
