/**
 * SQLite store implementation — backed by Node's built-in `node:sqlite`.
 *
 * Why `node:sqlite` (not `sqlite-vec`/`@sqlite.org/sqlite-wasm`):
 *   - `node:sqlite` is bundled with Node 22+ — no native build, no prebuild/ABI
 *     mismatch, and it writes REAL files (the registry needs `.codemap/*.sqlite`).
 *   - The WASM `@sqlite.org/sqlite-wasm` backend is in-memory under Node unless an
 *     explicit file VFS is installed, so it cannot satisfy on-disk persistence.
 *   - FTS5 ships with `node:sqlite`, so BM25 needs no extra dependency.
 *   - Vector KNN is computed in JS (cosine) over the `embeddings` table — the store
 *     interface already isolates this, so a native `vec0` backend could be swapped in
 *     later without touching callers.
 *
 * Relational data lives in normal tables; BM25 uses SQLite FTS5; the graph lives in
 * normal tables; embeddings are stored as JSON in an `embeddings` table keyed by the
 * chunk rowid (rowid alignment is mandatory so KNN results map back to chunk rows).
 */

import { createRequire } from 'node:module';
import type { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { StoreError, ConfigError } from '../../errors.js';
import type { Store, KnnHit, Bm25Hit, GraphHit } from './index.js';
import type { RepoChunk, SymbolNode, Edge, EmbeddingVector } from '../../types/index.js';

const META_DIMS = 'dims';

// Lazily load node:sqlite via createRequire. A static `import ... from 'node:sqlite'`
// is stripped of its `node:` prefix by vite-node's transformer and fails to resolve;
// loading it at runtime via createRequire avoids that and keeps file-based persistence.
const require = createRequire(import.meta.url);
let DatabaseSyncCtor: typeof DatabaseSync | null = null;
function getDatabaseSync(): typeof DatabaseSync {
  if (DatabaseSyncCtor) return DatabaseSyncCtor;
  const Ctor = require('node:sqlite').DatabaseSync;
  DatabaseSyncCtor = Ctor;
  return Ctor;
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT, repo_id TEXT NOT NULL, file TEXT NOT NULL,
  start_line INTEGER NOT NULL, end_line INTEGER NOT NULL, symbol TEXT, language TEXT NOT NULL,
  kind TEXT NOT NULL, content TEXT NOT NULL, content_hash TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chunks_repo ON chunks(repo_id);
CREATE INDEX IF NOT EXISTS idx_chunks_repo_file ON chunks(repo_id, file);
CREATE INDEX IF NOT EXISTS idx_chunks_hash ON chunks(repo_id, content_hash);
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(content, tokenize='unicode61');
CREATE TABLE IF NOT EXISTS embeddings ( id INTEGER PRIMARY KEY, vector TEXT NOT NULL );
CREATE INDEX IF NOT EXISTS idx_embeddings_id ON embeddings(id);
CREATE TABLE IF NOT EXISTS symbols ( id TEXT PRIMARY KEY, repo_id TEXT NOT NULL, file TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL, def_line INTEGER NOT NULL );
CREATE INDEX IF NOT EXISTS idx_symbols_repo ON symbols(repo_id);
CREATE INDEX IF NOT EXISTS idx_symbols_name ON symbols(repo_id, name);
CREATE TABLE IF NOT EXISTS edges ( src_id TEXT NOT NULL, dst_id TEXT NOT NULL, kind TEXT NOT NULL );
CREATE INDEX IF NOT EXISTS idx_edges_src ON edges(src_id, kind);
CREATE INDEX IF NOT EXISTS idx_edges_dst ON edges(dst_id, kind);
CREATE TABLE IF NOT EXISTS manifest ( repo_id TEXT NOT NULL, file TEXT NOT NULL, file_hash TEXT NOT NULL, PRIMARY KEY (repo_id, file) );
CREATE TABLE IF NOT EXISTS meta ( key TEXT PRIMARY KEY, value TEXT NOT NULL );
`;

function cosineDistance(a: Float32Array, b: number[]): number {
  // 1 - cosine_similarity; lower = closer.
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = a.length < b.length ? a.length : b.length;
  for (let i = 0; i < n; i++) {
    const av = a[i]!;
    const bv = b[i]!;
    dot += av * bv;
    na += av * av;
    nb += bv * bv;
  }
  if (na === 0 || nb === 0) return 1;
  return 1 - dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export class SqliteStore implements Store {
  private db: DatabaseSync | null = null;
  private _dims = 0;
  private filename: string;

  constructor(filename = ':memory:') {
    this.filename = filename;
  }

  open(): void {
    // Node's node:sqlite writes a real file at `filename` (or :memory:).
    this.db = new (getDatabaseSync())(this.filename);
    this.db.exec(SCHEMA_SQL);
    // Sync the reported dims from the stored meta (0 if never initialized).
    this._dims = this.readDims();
  }

  get dims(): number {
    return this._dims;
  }

  init(dims: number): void {
    if (!this.db) throw new StoreError('Store not opened; call open() first.');
    this._dims = dims;
    this.db
      .prepare(
        `INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
      )
      .run(META_DIMS, String(dims));
  }

  /** Read the stored dims (0 if uninitialized). */
  readDims(): number {
    if (!this.db) return 0;
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(META_DIMS) as
      { value: string } | undefined;
    return row ? Number(row.value) : 0;
  }

  upsertChunks(chunks: Array<{ chunk: RepoChunk; embedding: EmbeddingVector }>): void {
    if (!this.db) throw new StoreError('Store not opened; call open() first.');
    const insChunk = this.db.prepare(
      `INSERT INTO chunks(repo_id, file, start_line, end_line, symbol, language, kind, content, content_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insFts = this.db.prepare('INSERT INTO chunks_fts(rowid, content) VALUES (?, ?)');
    const insEmb = this.db.prepare(
      `INSERT INTO embeddings(id, vector) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET vector=excluded.vector`,
    );
    this.runInTransaction(() => {
      for (const { chunk, embedding } of chunks) {
        const res = insChunk.run(
          chunk.repoId,
          chunk.file,
          chunk.startLine,
          chunk.endLine,
          chunk.symbol,
          chunk.language,
          chunk.kind,
          chunk.content,
          chunk.contentHash,
        );
        const rowid = Number(res.lastInsertRowid);
        insFts.run(rowid, chunk.content);
        insEmb.run(rowid, JSON.stringify(Array.from(embedding)));
      }
    });
  }

  deleteChunks(ids: number[]): void {
    if (!this.db || ids.length === 0) return;
    const delChunk = this.db.prepare('DELETE FROM chunks WHERE id = ?');
    const delFts = this.db.prepare('DELETE FROM chunks_fts WHERE rowid = ?');
    const delEmb = this.db.prepare('DELETE FROM embeddings WHERE id = ?');
    this.runInTransaction(() => {
      for (const id of ids) {
        delChunk.run(id);
        delFts.run(id);
        delEmb.run(id);
      }
    });
  }

  getByHash(repoId: string, contentHash: string): number | null {
    if (!this.db) return null;
    const row = this.db
      .prepare('SELECT id FROM chunks WHERE repo_id = ? AND content_hash = ? LIMIT 1')
      .get(repoId, contentHash) as { id: number } | undefined;
    return row ? row.id : null;
  }

  updateChunkMetadata(
    repoId: string,
    contentHash: string,
    loc: { file: string; startLine: number; endLine: number; symbol: string | null },
  ): void {
    if (!this.db) return;
    this.db
      .prepare(
        `UPDATE chunks SET file = ?, start_line = ?, end_line = ?, symbol = ?
         WHERE repo_id = ? AND content_hash = ?`,
      )
      .run(loc.file, loc.startLine, loc.endLine, loc.symbol, repoId, contentHash);
  }

  deleteChunksForFile(repoId: string, file: string): void {
    if (!this.db) return;
    const ids = (
      this.db
        .prepare('SELECT id FROM chunks WHERE repo_id = ? AND file = ?')
        .all(repoId, file) as Array<{ id: number }>
    ).map((r) => r.id);
    if (ids.length === 0) return;
    const delChunk = this.db.prepare('DELETE FROM chunks WHERE id = ?');
    const delFts = this.db.prepare('DELETE FROM chunks_fts WHERE rowid = ?');
    const delEmb = this.db.prepare('DELETE FROM embeddings WHERE id = ?');
    this.runInTransaction(() => {
      for (const id of ids) {
        delChunk.run(id);
        delFts.run(id);
        delEmb.run(id);
      }
    });
  }

  knn(vector: EmbeddingVector, k: number): KnnHit[] {
    if (!this.db) return [];
    const rows = this.db.prepare('SELECT id, vector FROM embeddings').all() as Array<{
      id: number;
      vector: string;
    }>;
    const q = vector instanceof Float32Array ? vector : Float32Array.from(vector);
    const hits: KnnHit[] = rows.map((r) => ({
      chunkId: r.id,
      distance: cosineDistance(q, JSON.parse(r.vector) as number[]),
    }));
    hits.sort((a, b) => a.distance - b.distance);
    return hits.slice(0, k);
  }

  bm25(query: string, k: number): Bm25Hit[] {
    if (!this.db) return [];
    const q = quoteFts(query);
    try {
      const rows = this.db
        .prepare(
          `SELECT rowid, bm25(chunks_fts) AS rank FROM chunks_fts WHERE chunks_fts MATCH ? ORDER BY rank LIMIT ?`,
        )
        .all(q, k) as Array<{ rowid: number; rank: number }>;
      return rows.map((r) => ({ chunkId: r.rowid, score: r.rank }));
    } catch {
      return [];
    }
  }

  graphNeighbors(id: string, kind?: Edge['kind']): GraphHit[] {
    if (!this.db) return [];
    const rows = kind
      ? (this.db
          .prepare('SELECT dst_id, kind FROM edges WHERE src_id = ? AND kind = ?')
          .all(id, kind) as Array<{ dst_id: string; kind: Edge['kind'] }>)
      : (this.db.prepare('SELECT dst_id, kind FROM edges WHERE src_id = ?').all(id) as Array<{
          dst_id: string;
          kind: Edge['kind'];
        }>);
    return rows.map((r) => ({ neighborId: r.dst_id, kind: r.kind }));
  }

  upsertSymbols(symbols: SymbolNode[], edges: Edge[]): void {
    if (!this.db) return;
    const insSym = this.db.prepare(
      `INSERT INTO symbols(id, repo_id, file, name, kind, def_line) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET repo_id=excluded.repo_id, file=excluded.file, name=excluded.name, kind=excluded.kind, def_line=excluded.def_line`,
    );
    const insEdge = this.db.prepare('INSERT INTO edges(src_id, dst_id, kind) VALUES (?, ?, ?)');
    this.runInTransaction(() => {
      for (const s of symbols) insSym.run(s.id, s.repoId, s.file, s.name, s.kind, s.defLine);
      for (const e of edges) insEdge.run(e.srcId, e.dstId, e.kind);
    });
  }

  setManifest(repoId: string, file: string, fileHash: string): void {
    if (!this.db) return;
    this.db
      .prepare(
        `INSERT INTO manifest(repo_id, file, file_hash) VALUES (?, ?, ?)
         ON CONFLICT(repo_id, file) DO UPDATE SET file_hash=excluded.file_hash`,
      )
      .run(repoId, file, fileHash);
  }

  getManifest(repoId: string, file: string): string | null {
    if (!this.db) return null;
    const row = this.db
      .prepare('SELECT file_hash FROM manifest WHERE repo_id = ? AND file = ?')
      .get(repoId, file) as { file_hash: string } | undefined;
    return row ? row.file_hash : null;
  }

  allManifestFiles(repoId: string): string[] {
    if (!this.db) return [];
    const rows = this.db
      .prepare('SELECT file FROM manifest WHERE repo_id = ?')
      .all(repoId) as Array<{ file: string }>;
    return rows.map((r) => r.file);
  }

  allChunks(repoId: string): RepoChunk[] {
    if (!this.db) return [];
    const rows = this.db
      .prepare(
        `SELECT id, repo_id, file, start_line, end_line, symbol, language, kind, content, content_hash
         FROM chunks WHERE repo_id = ?`,
      )
      .all(repoId) as Array<{
      id: number;
      repo_id: string;
      file: string;
      start_line: number;
      end_line: number;
      symbol: string | null;
      language: string;
      kind: string;
      content: string;
      content_hash: string;
    }>;
    return rows.map((r) => ({
      id: String(r.id),
      repoId: r.repo_id,
      file: r.file,
      startLine: r.start_line,
      endLine: r.end_line,
      symbol: r.symbol,
      language: r.language as RepoChunk['language'],
      kind: r.kind as RepoChunk['kind'],
      content: r.content,
      contentHash: r.content_hash,
    }));
  }

  allSymbols(repoId: string): SymbolNode[] {
    if (!this.db) return [];
    const rows = this.db
      .prepare('SELECT id, repo_id, file, name, kind, def_line FROM symbols WHERE repo_id = ?')
      .all(repoId) as unknown as Array<SymbolNode>;
    return rows;
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  /** Assert dims match the stored value, throwing ConfigError otherwise. */
  assertDimsMatch(requested: number): void {
    const stored = this.readDims();
    if (stored !== 0 && stored !== requested) {
      throw new ConfigError(
        `Index built with dims=${stored} but embedder provides dims=${requested}. ` +
          `Re-index with --rebuild to switch embedder dimensions.`,
      );
    }
  }

  /** Run `fn` inside a BEGIN/COMMIT; rollback on throw. */
  private runInTransaction(fn: () => void): void {
    if (!this.db) throw new StoreError('Store not opened; call open() first.');
    this.db.exec('BEGIN');
    try {
      fn();
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }
}

function quoteFts(query: string): string {
  const trimmed = query.trim();
  if (!trimmed) return '""';
  return `"${trimmed.replace(/"/g, '""')}"`;
}

/** Stable content hash helper for callers (exposed for reuse). */
export function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}
