import { describe, it, expect, vi } from 'vitest';
import { JinaEmbedder } from '../../src/core/embed/jina.js';
import { HashEmbedder } from '../../src/core/embed/mock.js';
import { EmbedError } from '../../src/errors.js';

describe('JinaEmbedder', () => {
  it('posts to the endpoint with payload (keyless ok)', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      expect(body.model).toBe('jina-embeddings-v3');
      expect(body.input).toEqual(['a']);
      return new Response(JSON.stringify({ data: [{ embedding: [0.5, -0.5] }] }), {
        status: 200,
      });
    }) as unknown as typeof fetch;
    const e = new JinaEmbedder({ fetchImpl: fetchMock, dims: 2 });
    const out = await e.embed(['a']);
    expect(Array.from(out[0]!)).toEqual([0.5, -0.5]);
  });

  it('throws EmbedError on non-200', async () => {
    const fetchMock = vi.fn(
      async () => new Response('err', { status: 500 }),
    ) as unknown as typeof fetch;
    const e = new JinaEmbedder({ fetchImpl: fetchMock });
    await expect(e.embed(['x'])).rejects.toThrow(EmbedError);
  });
});

describe('HashEmbedder', () => {
  it('is deterministic and dimensionally correct', async () => {
    const e = new HashEmbedder(8);
    const a = await e.embed(['hello world']);
    const b = await e.embed(['hello world']);
    const c = await e.embed(['different']);
    expect(a[0]!.length).toBe(8);
    expect(Array.from(a[0]!)).toEqual(Array.from(b[0]!));
    expect(Array.from(a[0]!)).not.toEqual(Array.from(c[0]!));
    expect(e.dims).toBe(8);
  });

  it('returns [] for empty input', async () => {
    const e = new HashEmbedder(4);
    expect(await e.embed([])).toEqual([]);
  });
});
