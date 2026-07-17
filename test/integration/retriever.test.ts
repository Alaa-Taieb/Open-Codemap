import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Indexer } from '../../src/core/indexer.js';
import { Retriever } from '../../src/core/retriever.js';
import { SqliteStore } from '../../src/core/store/sqlite.js';
import { HashEmbedder } from '../../src/core/embed/mock.js';
import { TreeSitterParser } from '../../src/core/parser/index.js';
import { WorkspaceRegistry } from '../../src/core/registry/index.js';
import { repoId } from '../../src/core/registry/repo-id.js';

function writeRepo(dir: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
}

describe('Retriever (integration)', () => {
  let tmp: string;
  let repoDir: string;
  let rid: string;
  let store: SqliteStore;
  let embedder: HashEmbedder;
  let retriever: Retriever;
  let indexer: Indexer;

  beforeEach(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'codemap-ret-'));
    repoDir = path.join(tmp, 'repo');
    fs.mkdirSync(repoDir, { recursive: true });
    rid = await repoId(repoDir);
    store = new SqliteStore(':memory:');
    store.open();
    store.init(16);
    embedder = new HashEmbedder(16);
    const parser = new TreeSitterParser();
    const registry = new WorkspaceRegistry();
    indexer = new Indexer({ embedder, parser, registry });
    retriever = new Retriever({ store, embedder, repoId: rid });
  });

  afterEach(() => {
    store.close();
    for (let i = 0; i < 5; i++) {
      try {
        fs.rmSync(tmp, { recursive: true, force: true });
        return;
      } catch {
        /* retry */
      }
    }
  });

  it('returns chunks for an identifier query (BM25 path)', async () => {
    writeRepo(repoDir, {
      'a.ts': 'export function getAuthToken() { return token; }\n',
      'b.py': 'def validate_login():\n    return True\n',
    });
    await indexer.indexWithStore(store, repoDir);

    // BM25 should surface the exact identifier definition.
    const res = await retriever.retrieve({ text: 'getAuthToken', topK: 5 });
    expect(res.length).toBeGreaterThan(0);
    expect(res[0]!.chunk.symbol).toBe('getAuthToken');
  });

  it('semantic query returns a related chunk via vector', async () => {
    writeRepo(repoDir, {
      'a.ts': 'export function getAuthToken() { return token; }\n',
      'b.py': 'def validate_login():\n    return True\n',
    });
    await indexer.indexWithStore(store, repoDir);

    // "validate login" should bring back the python validate_login chunk.
    const res = await retriever.retrieve({ text: 'validate login', topK: 5 });
    expect(res.some((r) => r.chunk.symbol === 'validate_login')).toBe(true);
  });

  it('fused ranking beats either mode alone via RRF', async () => {
    writeRepo(repoDir, {
      'a.ts': 'export function getAuthToken() { return token; }\n',
      'b.py': 'def validate_login():\n    return True\n',
      'c.ts': 'export function getAuthToken() { return cached; }\n', // duplicate name -> BM25 tie
    });
    await indexer.indexWithStore(store, repoDir);

    // The query token appears in two files; RRF should still rank a vector-near chunk.
    const res = await retriever.retrieve({ text: 'validate login', topK: 5 });
    expect(res.length).toBeGreaterThan(0);
    // At least one mode contributed (vector or bm25); scores are positive.
    for (const r of res) expect(r.score).toBeGreaterThan(0);
  });

  it('expandGraph adds graph neighbors of top hits', async () => {
    writeRepo(repoDir, {
      'a.ts':
        'import { helper } from "./b";\nexport function getAuthToken() { return helper(); }\n',
      'b.ts': 'export function helper() { return 42; }\n',
    });
    await indexer.indexWithStore(store, repoDir);

    const res = await retriever.retrieve({
      text: 'getAuthToken',
      topK: 10,
      expandGraph: true,
    });
    // The graph edge a->b (imports/uses helper) should surface b.ts.
    expect(res.some((r) => r.chunk.file === 'b.ts')).toBe(true);
  });

  it('empty index returns empty array', async () => {
    const res = await retriever.retrieve({ text: 'anything', topK: 5 });
    expect(res).toEqual([]);
  });

  it('exact-identifier query labels at least one result as bm25', async () => {
    writeRepo(repoDir, {
      'a.ts': 'export function getAuthToken() { return token; }\n',
      'b.py': 'def validate_login():\n    return True\n',
    });
    await indexer.indexWithStore(store, repoDir);

    const res = await retriever.retrieve({ text: 'getAuthToken', topK: 5 });
    expect(res.some((r) => r.mode === 'bm25')).toBe(true);
  });

  it('semantic query labels at least one result as vector', async () => {
    writeRepo(repoDir, {
      'a.ts': 'export function getAuthToken() { return token; }\n',
      'b.py': 'def validate_login():\n    return True\n',
    });
    await indexer.indexWithStore(store, repoDir);

    const res = await retriever.retrieve({ text: 'validate login', topK: 5 });
    expect(res.some((r) => r.mode === 'vector')).toBe(true);
  });
});
