/**
 * Embedder interface + batching helper.
 *
 * Every embedding backend (Voyage, Jina, Hash/mock) implements `Embedder`.
 * `embedBatch` splits large inputs into fixed-size batches so callers never
 * hand an unbounded array to a provider that rejects `[]` or caps payload size.
 */

import type { EmbeddingVector } from '../../types/index.js';

export type { EmbeddingVector } from '../../types/index.js';

export interface Embedder {
  /** Output dimensionality. Must match the store's `vec0` table at init. */
  readonly dims: number;
  /** Human-readable kind (mock | voyage | jina). */
  readonly kind: string;
  /** Embed a batch of texts -> one vector per input. */
  embed(texts: string[]): Promise<EmbeddingVector[]>;
}

/** Embed `texts` in batches of `batchSize` (default 256). */
export async function embedBatch(
  embedder: Embedder,
  texts: string[],
  batchSize = 256,
): Promise<EmbeddingVector[]> {
  if (texts.length === 0) return [];
  const out: EmbeddingVector[] = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const slice = texts.slice(i, i + batchSize);
    const vectors = await embedder.embed(slice);
    out.push(...vectors);
  }
  return out;
}

/** Convert a Float32Array embedding to a plain number[] (for storage). */
export function toNumberArray(vec: EmbeddingVector): number[] {
  return Array.from(vec as Float32Array);
}
