import { describe, it, expect, vi } from 'vitest';
import { embedBatch, toNumberArray } from '../../src/core/embed/index.js';
import type { Embedder } from '../../src/core/embed/index.js';

class FakeEmbedder implements Embedder {
  readonly dims = 4;
  readonly kind = 'fake';
  readonly calls: number[] = [];
  async embed(texts: string[]): Promise<Float32Array[]> {
    this.calls.push(texts.length);
    return texts.map((t) => Float32Array.from([t.length, 0, 0, 0]));
  }
}

describe('embedBatch', () => {
  it('returns [] for empty input', async () => {
    const e = new FakeEmbedder();
    expect(await embedBatch(e, [])).toEqual([]);
    expect(e.calls.length).toBe(0);
  });

  it('respects batch size', async () => {
    const e = new FakeEmbedder();
    const texts = Array.from({ length: 10 }, (_, i) => `t${i}`);
    const out = await embedBatch(e, texts, 3);
    expect(out).toHaveLength(10);
    expect(e.calls).toEqual([3, 3, 3, 1]);
  });

  it('single batch when under size', async () => {
    const e = new FakeEmbedder();
    await embedBatch(e, ['a', 'b'], 256);
    expect(e.calls).toEqual([2]);
  });

  it('toNumberArray converts Float32Array', () => {
    expect(toNumberArray(Float32Array.from([1, 2, 3]))).toEqual([1, 2, 3]);
  });

  it('surfaces embedder errors', async () => {
    const bad: Embedder = {
      dims: 2,
      kind: 'bad',
      embed: async () => {
        throw new Error('boom');
      },
    };
    await expect(embedBatch(bad, ['x'])).rejects.toThrow('boom');
  });
});
