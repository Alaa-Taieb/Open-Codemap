/**
 * Voyage `code-3` embedder (default paid backend).
 *
 * Calls the REST API with the global `fetch` (Node 18+). The API key is read from
 * `VOYAGE_AI_API_KEY`. If absent we throw a `ConfigError` that points at the OSS
 * fallback (research §10.1) — never silently proceed.
 */

import { EmbedError, ConfigError } from '../../errors.js';
import type { Embedder, EmbeddingVector } from './index.js';

export interface VoyageOptions {
  apiKey?: string;
  model?: string;
  dims?: number;
  /** Override the endpoint (mainly for tests). */
  endpoint?: string;
  /** Inject a fetch implementation (for tests). */
  fetchImpl?: typeof fetch;
}

export class VoyageEmbedder implements Embedder {
  readonly kind = 'voyage';
  readonly dims: number;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: VoyageOptions = {}) {
    const apiKey = opts.apiKey ?? process.env.VOYAGE_AI_API_KEY;
    if (!apiKey) {
      throw new ConfigError(
        'Voyage embedder requires VOYAGE_AI_API_KEY. Set it, or use the OSS fallback ' +
          '(--embedder jina) or the deterministic test embedder (--embedder mock).',
      );
    }
    this.apiKey = apiKey;
    this.model = opts.model ?? 'voyage-code-3';
    this.dims = opts.dims ?? 1024;
    this.endpoint = opts.endpoint ?? 'https://api.voyageai.com/v1/embeddings';
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async embed(texts: string[]): Promise<EmbeddingVector[]> {
    if (texts.length === 0) return [];
    let res: Response;
    try {
      res = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          input: texts,
          model: this.model,
          output_dimension: this.dims,
          input_type: 'document',
        }),
      });
    } catch (cause) {
      throw new EmbedError('Voyage request failed (network)', { cause });
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new EmbedError(`Voyage returned ${res.status}`, {
        details: { status: res.status, body: body.slice(0, 500) },
      });
    }
    const json = (await res.json()) as {
      data?: Array<{ embedding: number[] }>;
    };
    const data = json.data;
    if (!Array.isArray(data) || data.length !== texts.length) {
      throw new EmbedError('Voyage response shape unexpected', {
        details: { got: Array.isArray(data) ? data.length : typeof data, want: texts.length },
      });
    }
    return data.map((d) => Float32Array.from(d.embedding));
  }
}
