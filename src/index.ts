// Open-Codemap — public API barrel.
//
// This is the `open-codemap` entry point that library consumers import:
//
//   import { Indexer, Retriever, SqliteStore, WorkspaceRegistry, HashEmbedder }
//     from 'open-codemap';
//
// The same core is wrapped by the CLI (`open-codemap/cli`) and the HTTP API
// (`open-codemap/api`). Parse → chunk → embed → store → retrieve, behind one
// interface-first design.

/** Package version. */
export const VERSION = '0.1.1';

// ---------------------------------------------------------------------------
// Core classes
// ---------------------------------------------------------------------------

export { Indexer } from './core/indexer.js';
export type { IndexerDeps } from './core/indexer.js';

export { Retriever } from './core/retriever.js';
export type { RetrieverDeps, Reranker } from './core/retriever.js';

export { SqliteStore } from './core/store/sqlite.js';
export type { Store, KnnHit, Bm25Hit, GraphHit } from './core/store/index.js';

export { WorkspaceRegistry, registry } from './core/registry/index.js';
export type { WorkspaceEntry, OpenOptions } from './core/registry/index.js';
export { repoId, normalizeRepoPath, detectGitRemote } from './core/registry/repo-id.js';

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

export { TreeSitterParser, parser } from './core/parser/index.js';
export type { SyntaxTree } from './core/parser/index.js';

// ---------------------------------------------------------------------------
// Embedders
// ---------------------------------------------------------------------------

export type { Embedder, EmbeddingVector } from './core/embed/index.js';
export { embedBatch, toNumberArray } from './core/embed/index.js';
export { HashEmbedder } from './core/embed/mock.js';
export { VoyageEmbedder } from './core/embed/voyage.js';
export type { VoyageOptions } from './core/embed/voyage.js';
export { JinaEmbedder } from './core/embed/jina.js';
export type { JinaOptions } from './core/embed/jina.js';

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export type {
  LanguageId,
  ChunkKind,
  RepoChunk,
  SymbolNode,
  EdgeKind,
  Edge,
  QueryRequest,
  QueryResult,
  IndexOptions,
  IndexProgress,
  Job,
  EmbedderKind,
} from './types/index.js';

// ---------------------------------------------------------------------------
// Shared validation schemas (used by CLI + API so they never diverge)
// ---------------------------------------------------------------------------

export {
  embedderKindSchema,
  languageIdSchema,
  configSchema,
  querySchema,
  indexOptionsSchema,
  indexRequestSchema,
  queryRequestSchema,
} from './schemas/index.js';
export type {
  EmbedderKindSchema,
  ConfigSchema,
  QuerySchema,
  IndexOptionsSchema,
  IndexRequestSchema,
  QueryRequestSchema,
} from './schemas/index.js';

// ---------------------------------------------------------------------------
// Typed errors
// ---------------------------------------------------------------------------

export {
  CodemapError,
  ParseError,
  EmbedError,
  StoreError,
  ConfigError,
  WorkspaceNotFound,
  NotFoundError,
  asCodemapError,
  HTTP_STATUS_FOR_CODE,
} from './errors.js';
export type { ErrorCode, CodemapErrorOptions } from './errors.js';
