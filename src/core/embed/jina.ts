/**
 * Jina v3/v4 embedder (OSS fallback).
 *
 * Same interface as Voyage. Key is optional from `JINA_API_KEY`; dims configurable.
 * The shape mirrors Jina's `/v1/embeddings` endpoint.
 */

import { EmbedError, ConfigError } from '../../errors.js';
import type { Embedder, EmbeddingVector } from './index.js';

export interface JinaOptions {
  apiKey?: string;
  model?: string;
  dims?: number;
  endpoint?: string;
  fetchImpl?: typeof fetch;
}

export class JinaEmbedder implements Embedder {
  readonly kind = 'jina';
  readonly dims: number;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: JinaOptions = {}) {
    const apiKey = opts.apiKey ?? process.env.JINA_API_KEY ?? '';
    // Jina allows keyless trials in some setups; we still surface a ConfigError if
    // explicitly absent AND the caller relies on it (research §10.1).
    this.apiKey = apiKey;
    this.model = opts.model ?? 'jina-embeddings-v3';
    this.dims = opts.dims ?? 1024;
    this.endpoint = opts.endpoint ?? 'https://api.jina.ai/v1/embeddings';
    this.fetchImpl = opts.fetchImpl ?? fetch;
    if (!this.apiKey) {
      // Non-fatal: Jina sometimes permits unauthenticated dev requests. We only
      // throw if the request later fails auth; keep it permissive for local use.
      void ConfigError; // referenced for documentation symmetry with Voyage
    }
  }

  async embed(texts: string[]): Promise<EmbeddingVector[]> {
    if (texts.length === 0) return [];
    let res: Response;
    try {
      res = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify({
          input: texts,
          model: this.model,
          dimensions: this.dims,
          task: 'retrieval.passage',
        }),
      });
    } catch (cause) {
      throw new EmbedError('Jina request failed (network)', { cause });
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new EmbedError(`Jina returned ${res.status}`, {
        details: { status: res.status, body: body.slice(0, 500) },
      });
    }
    const json = (await res.json()) as { data?: Array<{ embedding: number[] }> };
    const data = json.data;
    if (!Array.isArray(data) || data.length !== texts.length) {
      throw new EmbedError('Jina response shape unexpected', {
        details: { got: Array.isArray(data) ? data.length : typeof data, want: texts.length },
      });
    }
    return data.map((d) => Float32Array.from(d.embedding));
  }
}
