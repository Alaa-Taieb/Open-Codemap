import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

// Load node:sqlite via createRequire to avoid vite-node stripping the `node:` prefix.
const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS chunks (
    id INTEGER PRIMARY KEY AUTOINCREMENT, repo_id TEXT NOT NULL, file TEXT NOT NULL,
    start_line INTEGER NOT NULL, end_line INTEGER NOT NULL, symbol TEXT, language TEXT NOT NULL,
    kind TEXT NOT NULL, content TEXT NOT NULL, content_hash TEXT NOT NULL
  );
  CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(content, tokenize='unicode61');
  CREATE TABLE IF NOT EXISTS symbols (id TEXT PRIMARY KEY, repo_id TEXT NOT NULL, file TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL, def_line INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS edges (src_id TEXT NOT NULL, dst_id TEXT NOT NULL, kind TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS manifest (repo_id TEXT NOT NULL, file TEXT NOT NULL, file_hash TEXT NOT NULL, PRIMARY KEY (repo_id, file));
  CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

describe('store schema applies to :memory:', () => {
  it('creates all non-vector tables without error', () => {
    const db = new DatabaseSync(':memory:');
    expect(() => db.exec(SCHEMA)).not.toThrow();
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view')")
      .all() as Array<{ name: string }>;
    const names = tables.map((t) => t.name);
    for (const expected of ['chunks', 'chunks_fts', 'symbols', 'edges', 'manifest', 'meta']) {
      expect(names).toContain(expected);
    }
    db.close();
  });

  it('FTS5 bm25 matches an identifier token', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('CREATE VIRTUAL TABLE t USING fts5(content)');
    db.exec(
      "INSERT INTO t(rowid, content) VALUES (1, 'function getAuthToken returns the auth token'),(2, 'unrelated text here')",
    );
    const r = db
      .prepare('SELECT rowid, bm25(t) AS rank FROM t WHERE t MATCH ? ORDER BY rank')
      .all('auth') as Array<{ rowid: number; rank: number }>;
    expect(r).toHaveLength(1);
    expect(r[0]!.rowid).toBe(1);
    db.close();
  });
});
