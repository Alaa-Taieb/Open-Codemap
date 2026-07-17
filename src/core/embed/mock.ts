/**
 * `HashEmbedder` — deterministic mock used by the test suite (no network, no keys).
 *
 * Each vector is derived from a SHA-256 of the text, expanded (via a simple, stable
 * mixing function) to `dims` floats in [-1, 1). Two equal strings always produce the
 * same vector, which makes retrieval tests reproducible. Not for production use.
 */

import { createHash } from 'node:crypto';
import type { Embedder, EmbeddingVector } from './index.js';

export class HashEmbedder implements Embedder {
  readonly kind = 'mock';
  readonly dims: number;

  constructor(dims = 1024) {
    this.dims = dims;
  }

  async embed(texts: string[]): Promise<EmbeddingVector[]> {
    return texts.map((t) => this.embedOne(t));
  }

  private embedOne(text: string): EmbeddingVector {
    const out = new Float32Array(this.dims);
    // Seed hash from the text.
    const seed = createHash('sha256').update(text).digest();
    // Expand to `dims` entries using a deterministic xorshift over the digest.
    let state = seed.readUInt32LE(0) || 1;
    for (let i = 0; i < this.dims; i++) {
      // mix
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      // occasionally pull more entropy from the hash
      if (i % 8 === 0) {
        const idx = (i / 8) % (seed.length / 4);
        state = state ^ seed.readUInt32LE(idx * 4) || 1;
      }
      out[i] = (state % 1000) / 500 - 1; // map to [-1, 1)
    }
    return out;
  }
}
