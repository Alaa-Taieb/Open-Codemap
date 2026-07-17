import { describe, it, expect, beforeAll } from 'vitest';
import { SqliteStore } from '../../src/core/store/sqlite.js';
import { HashEmbedder } from '../../src/core/embed/mock.js';
import type { RepoChunk } from '../../src/types/index.js';

function makeChunk(over: Partial<RepoChunk>): RepoChunk {
  return {
    id: '',
    repoId: 'r1',
    file: 'a.ts',
    startLine: 1,
    endLine: 3,
    symbol: 'foo',
    language: 'typescript',
    kind: 'function',
    content: 'function foo() { return 1; }',
    contentHash: 'h' + Math.random().toString(36).slice(2),
    ...over,
  };
}

describe('SqliteStore (wasm)', () => {
  let store: SqliteStore;
  const embedder = new HashEmbedder(8);

  beforeAll(async () => {
    store = new SqliteStore(':memory:');
    await store.open();
    store.init(8);
  });

  it('upserts chunks, syncs FTS + embeddings with same rowid', async () => {
    const chunks = [
      makeChunk({
        symbol: 'getAuthToken',
        content: 'function getAuthToken() { return token; }',
        contentHash: 'ca',
      }),
      makeChunk({
        symbol: 'other',
        file: 'b.ts',
        content: 'function other() { return 2; }',
        contentHash: 'cb',
      }),
    ];
    const embeddings = await embedder.embed(chunks.map((c) => c.content));
    store.upsertChunks(chunks.map((c, i) => ({ chunk: c, embedding: embeddings[i]! })));
    const all = store.allChunks('r1');
    expect(all).toHaveLength(2);
    // KNN returns the nearest by cosine
    const q = await embedder.embed(['function getAuthToken() { return token; }']);
    const hits = store.knn(q[0]!, 2);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.chunkId).toBe(1); // identical vector -> distance 0
  });

  it('bm25 matches an identifier', async () => {
    const hits = store.bm25('getAuthToken', 5);
    expect(hits.length).toBeGreaterThan(0);
    // The matched chunk id should be the getAuthToken chunk (rowid 1).
    expect(hits[0]!.chunkId).toBe(1);
  });

  it('graphNeighbors returns edges', () => {
    store.upsertSymbols(
      [
        {
          id: 'r1#a.ts#foo@1',
          repoId: 'r1',
          file: 'a.ts',
          name: 'foo',
          kind: 'function',
          defLine: 1,
        },
      ],
      [{ srcId: 'r1#a.ts#foo@1', dstId: 'r1#a.ts#bar@2', kind: 'calls' }],
    );
    const n = store.graphNeighbors('r1#a.ts#foo@1');
    expect(n).toHaveLength(1);
    expect(n[0]!.neighborId).toBe('r1#a.ts#bar@2');
    expect(n[0]!.kind).toBe('calls');
  });

  it('getByHash finds a chunk by content hash', () => {
    expect(store.getByHash('r1', 'ca')).toBe(1);
    expect(store.getByHash('r1', 'nope')).toBeNull();
  });

  it('deleteChunks removes rows + fts + embeddings', () => {
    const before = store.allChunks('r1').length;
    store.deleteChunks([2]);
    const after = store.allChunks('r1').length;
    expect(after).toBe(before - 1);
    expect(store.bm25('other', 5)).toHaveLength(0);
  });

  it('manifest round-trips', () => {
    store.setManifest('r1', 'a.ts', 'filehash1');
    expect(store.getManifest('r1', 'a.ts')).toBe('filehash1');
  });

  it('assertDimsMatch guards embedder switch', () => {
    expect(() => store.assertDimsMatch(8)).not.toThrow();
    expect(() => store.assertDimsMatch(1024)).toThrow();
  });
});
