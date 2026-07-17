import { describe, it, expect, vi } from 'vitest';
import { VoyageEmbedder } from '../../src/core/embed/voyage.js';
import { ConfigError, EmbedError } from '../../src/errors.js';

describe('VoyageEmbedder', () => {
  it('throws ConfigError without an API key', () => {
    const saved = process.env.VOYAGE_AI_API_KEY;
    delete process.env.VOYAGE_AI_API_KEY;
    try {
      expect(() => new VoyageEmbedder()).toThrow(ConfigError);
    } finally {
      if (saved) process.env.VOYAGE_AI_API_KEY = saved;
    }
  });

  it('posts to the endpoint with auth + payload', async () => {
    const saved = process.env.VOYAGE_AI_API_KEY;
    process.env.VOYAGE_AI_API_KEY = 'test-key';
    try {
      const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(init.body as string);
        expect(body.model).toBe('voyage-code-3');
        expect(body.input).toEqual(['hello', 'world']);
        expect(init.headers && (init.headers as Record<string, string>).Authorization).toBe(
          'Bearer test-key',
        );
        return new Response(
          JSON.stringify({
            data: [{ embedding: [0.1, 0.2] }, { embedding: [0.3, 0.4] }],
          }),
          { status: 200 },
        );
      }) as unknown as typeof fetch;
      const e = new VoyageEmbedder({ fetchImpl: fetchMock, dims: 2 });
      const out = await e.embed(['hello', 'world']);
      expect(out).toHaveLength(2);
      // Float32 precision: assert close rather than exact.
      expect(out[0]![0]!).toBeCloseTo(0.1, 5);
      expect(out[0]![1]!).toBeCloseTo(0.2, 5);
      expect(out[1]![0]!).toBeCloseTo(0.3, 5);
      expect(out[1]![1]!).toBeCloseTo(0.4, 5);
      expect(e.dims).toBe(2);
    } finally {
      if (saved) process.env.VOYAGE_AI_API_KEY = saved;
      else delete process.env.VOYAGE_AI_API_KEY;
    }
  });

  it('throws EmbedError on non-200', async () => {
    const saved = process.env.VOYAGE_AI_API_KEY;
    process.env.VOYAGE_AI_API_KEY = 'test-key';
    try {
      const fetchMock = vi.fn(
        async () => new Response('nope', { status: 401 }),
      ) as unknown as typeof fetch;
      const e = new VoyageEmbedder({ fetchImpl: fetchMock });
      await expect(e.embed(['x'])).rejects.toThrow(EmbedError);
    } finally {
      if (saved) process.env.VOYAGE_AI_API_KEY = saved;
      else delete process.env.VOYAGE_AI_API_KEY;
    }
  });
});
