/**
 * Open-Codemap — core domain types.
 *
 * These types are framework-agnostic: the same shapes flow through the
 * library, the CLI, and the HTTP API. Validation of externally-supplied
 * values lives in `src/schemas` (zod); these interfaces describe the
 * internal, already-validated model.
 */

/** Tree-sitter language identifiers supported by the v1 grammar set. */
export type LanguageId =
  | 'javascript'
  | 'typescript'
  | 'tsx'
  | 'python'
  | 'go'
  | 'rust'
  | 'java'
  | 'c'
  | 'cpp'
  | 'c_sharp'
  | 'ruby'
  /** Assigned to files we could not parse (sliding-window fallback). */
  | 'text';

/** Structural category of a chunk. */
export type ChunkKind = 'function' | 'class' | 'method' | 'block' | 'file';

/**
 * A single retrievable unit of code, produced by the chunker and stored in
 * the vector/FTS/graph stores.
 */
export interface RepoChunk {
  /** Stable id: `${repoId}:${contentHash}` (set by the store on upsert). */
  id: string;
  repoId: string;
  /** Repository-relative file path (always POSIX-style, `/` separators). */
  file: string;
  startLine: number;
  endLine: number;
  /** Symbol name when the chunk is a function/class/method; else null. */
  symbol: string | null;
  language: LanguageId;
  kind: ChunkKind;
  content: string;
  /** SHA-256 (hex) of `content`; used for incremental re-embed decisions. */
  contentHash: string;
}

/** A named declaration extracted from a parsed file. */
export interface SymbolNode {
  id: string;
  repoId: string;
  file: string;
  name: string;
  kind: string;
  defLine: number;
  /** Optional fully-qualified name (e.g. `Class.method`). */
  qualifiedName?: string;
}

/** A relationship between two symbols or chunks. */
export type EdgeKind = 'calls' | 'imports' | 'defines' | 'inherits' | 'references';

export interface Edge {
  srcId: string;
  dstId: string;
  kind: EdgeKind;
}

/** A dense embedding vector (length === the embedder's `dims`). */
export type EmbeddingVector = Float32Array;

/** A query against the index. */
export interface QueryRequest {
  text: string;
  topK?: number;
  /** Optional language/extension filter applied to retrieved chunks. */
  filters?: {
    language?: LanguageId;
    file?: string;
  };
  /** When true, expand results with graph neighbors of top semantic hits. */
  expandGraph?: boolean;
}

/** One ranked result returned by the retriever. */
export interface QueryResult {
  chunk: RepoChunk;
  score: number;
  /** Which retrieval mode produced/ranked this candidate. */
  mode: 'vector' | 'bm25' | 'graph' | 'rrf';
}

/** Options controlling an indexing run. */
export interface IndexOptions {
  /** Drop and rebuild the store before indexing (required when switching dims). */
  reindex?: boolean;
  /** Keep a chokidar watcher alive after the initial index completes. */
  watch?: boolean;
  /** Extra glob patterns (in addition to `.gitignore`) to ignore. */
  ignore?: string[];
  /** Optional explicit list of file globs to include (overrides walking). */
  include?: string[];
}

/** Progress emitted during indexing. */
export interface IndexProgress {
  phase: 'walk' | 'parse' | 'embed' | 'store' | 'watch' | 'done';
  done: number;
  total: number;
  /** Repository-relative file currently being processed (when relevant). */
  file?: string;
}

/** Async job descriptor used by the HTTP API. */
export interface Job {
  id: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  progress: IndexProgress | null;
  result?: unknown;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

/** Kind of embedder implementation. */
export type EmbedderKind = 'mock' | 'voyage' | 'jina';
