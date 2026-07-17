-- Open-Codemap store schema (non-vector tables only).
-- Vector KNN is computed in JS over the `embeddings` table; BM25 uses SQLite FTS5.
-- The `embeddings` table stores each chunk's vector as JSON (keyed by chunk rowid).

CREATE TABLE IF NOT EXISTS chunks (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id       TEXT NOT NULL,
  file          TEXT NOT NULL,
  start_line    INTEGER NOT NULL,
  end_line      INTEGER NOT NULL,
  symbol        TEXT,
  language      TEXT NOT NULL,
  kind          TEXT NOT NULL,
  content       TEXT NOT NULL,
  content_hash  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chunks_repo ON chunks(repo_id);
CREATE INDEX IF NOT EXISTS idx_chunks_repo_file ON chunks(repo_id, file);
CREATE INDEX IF NOT EXISTS idx_chunks_hash ON chunks(repo_id, content_hash);

-- BM25 full-text index over chunk content (standalone FTS5; synced on upsert).
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(content, tokenize='unicode61');

-- One vector per chunk, stored as a JSON array of floats.
CREATE TABLE IF NOT EXISTS embeddings (
  id      INTEGER PRIMARY KEY,
  vector  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_embeddings_id ON embeddings(id);

CREATE TABLE IF NOT EXISTS symbols (
  id        TEXT PRIMARY KEY,
  repo_id   TEXT NOT NULL,
  file      TEXT NOT NULL,
  name      TEXT NOT NULL,
  kind      TEXT NOT NULL,
  def_line  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_symbols_repo ON symbols(repo_id);
CREATE INDEX IF NOT EXISTS idx_symbols_name ON symbols(repo_id, name);

CREATE TABLE IF NOT EXISTS edges (
  src_id TEXT NOT NULL,
  dst_id TEXT NOT NULL,
  kind   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_edges_src ON edges(src_id, kind);
CREATE INDEX IF NOT EXISTS idx_edges_dst ON edges(dst_id, kind);

-- Per-file manifest for incremental indexing (file hash -> unchanged check).
CREATE TABLE IF NOT EXISTS manifest (
  repo_id   TEXT NOT NULL,
  file      TEXT NOT NULL,
  file_hash TEXT NOT NULL,
  PRIMARY KEY (repo_id, file)
);

-- Index metadata: dims the store was built with (consistency guard).
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
