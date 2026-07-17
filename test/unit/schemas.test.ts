import { describe, it, expect } from 'vitest';
import {
  configSchema,
  querySchema,
  indexOptionsSchema,
  indexRequestSchema,
  queryRequestSchema,
} from '../../src/schemas/index.js';

describe('shared zod schemas', () => {
  it('configSchema applies defaults and rejects bad embedder', () => {
    expect(configSchema.parse({})).toEqual({ embedder: 'mock' });
    expect(configSchema.parse({ embedder: 'voyage', dims: 1024 })).toMatchObject({
      embedder: 'voyage',
    });
    expect(() => configSchema.parse({ embedder: 'openai' })).toThrow();
  });

  it('querySchema enforces non-empty text and topK bounds', () => {
    const q = querySchema.parse({ text: 'validate login', topK: 5, expandGraph: true });
    expect(q.topK).toBe(5);
    expect(q.expandGraph).toBe(true);
    // default topK = 10
    expect(querySchema.parse({ text: 'x' }).topK).toBe(10);
    // out-of-range topK rejected (1..100)
    expect(() => querySchema.parse({ text: 'x', topK: 0 })).toThrow();
    expect(() => querySchema.parse({ text: 'x', topK: 101 })).toThrow();
    // empty text rejected
    expect(() => querySchema.parse({ text: '' })).toThrow();
  });

  it('indexOptionsSchema accepts optional flags', () => {
    expect(
      indexOptionsSchema.parse({ reindex: true, watch: false, ignore: ['dist'] }),
    ).toMatchObject({
      reindex: true,
      ignore: ['dist'],
    });
    expect(indexOptionsSchema.parse({})).toEqual({});
  });

  it('indexRequestSchema and queryRequestSchema validate API bodies', () => {
    expect(indexRequestSchema.parse({ repo: './myrepo', embedder: 'mock' })).toMatchObject({
      repo: './myrepo',
    });
    expect(() => indexRequestSchema.parse({ repo: '' })).toThrow();
    const qr = queryRequestSchema.parse({ repo: './r', text: 'getAuthToken', topK: 3 });
    expect(qr.topK).toBe(3);
    expect(() => queryRequestSchema.parse({ repo: './r', text: '' })).toThrow();
  });

  it('round-trips valid input through parse/stringify', () => {
    const input = { text: 'find auth', topK: 7, filters: { language: 'python' as const } };
    const parsed = querySchema.parse(input);
    expect(JSON.parse(JSON.stringify(parsed))).toMatchObject(input);
  });
});
