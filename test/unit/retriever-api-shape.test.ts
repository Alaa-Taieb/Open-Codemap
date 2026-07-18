import { describe, it, expect } from 'vitest';
import { Retriever } from '../../src/core/retriever.js';
import { ConfigError } from '../../src/errors.js';
import { HashEmbedder } from '../../src/core/embed/mock.js';
import type { QueryRequest, QueryResult } from '../../src/types/index.js';

// A minimal in-memory store stub: the repoId guard fires before any store call,
// so a no-op stub is sufficient for the guard test.
const noopStore = {} as any;
const embedder = new HashEmbedder(8);

describe('Retriever construction guard (D5)', () => {
  it('throws ConfigError when repoId is omitted', () => {
    expect(() => new Retriever({ store: noopStore, embedder } as any)).toThrow(ConfigError);
  });

  it('throws ConfigError when repoId is empty string', () => {
    expect(() => new Retriever({ store: noopStore, embedder, repoId: '' })).toThrow(ConfigError);
  });

  it('does NOT throw when repoId is provided', () => {
    expect(() => new Retriever({ store: noopStore, embedder, repoId: 'abc123' })).not.toThrow();
  });
});

describe('QueryRequest / QueryResult shape (D5)', () => {
  it('QueryRequest has no `mode` field', () => {
    const req: QueryRequest = { text: 'hello' };
    expect((req as unknown as Record<string, unknown>).mode).toBeUndefined();
  });

  it('QueryResult carries a `mode` field that is a known fusion mode', () => {
    const result: QueryResult = {
      chunk: {
        id: '1',
        repoId: 'r',
        file: 'a.ts',
        startLine: 1,
        endLine: 2,
        symbol: null,
        language: 'typescript',
        kind: 'function',
        content: 'x',
        contentHash: 'h',
      },
      score: 0.5,
      mode: 'bm25',
    };
    expect(['vector', 'bm25', 'graph', 'rrf']).toContain(result.mode);
  });
});

describe('Embedder.embed is batched (D5)', () => {
  it('HashEmbedder.embed accepts string[] and returns one vector per input', async () => {
    const out = await embedder.embed(['a', 'b', 'c']);
    expect(Array.isArray(out)).toBe(true);
    expect(out).toHaveLength(3);
    expect(out[0]).toBeInstanceOf(Float32Array);
    expect(out[0]!.length).toBe(8);
  });
});
