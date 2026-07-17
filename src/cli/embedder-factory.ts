/**
 * Embedder factory — resolves a concrete `Embedder` from a CLI/API `kind`.
 *
 * This is the single place that knows how to wire each backend, so the CLI and
 * API never duplicate embedder construction. The `mock` (HashEmbedder) backend
 * needs no network or API key and is what tests + the quickstart use.
 */

import type { Embedder } from '../core/embed/index.js';
import { HashEmbedder } from '../core/embed/mock.js';
import { VoyageEmbedder } from '../core/embed/voyage.js';
import { JinaEmbedder } from '../core/embed/jina.js';
import { ConfigError } from '../errors.js';
import type { EmbedderKindSchema } from '../schemas/index.js';

/** Default embedding dimensionality per backend. */
const DEFAULT_DIMS: Record<EmbedderKindSchema, number> = {
  mock: 1024,
  voyage: 1024,
  jina: 1024,
};

export interface BuildEmbedderOpts {
  kind: EmbedderKindSchema;
  /** Override the embedding width (must match the existing index dims). */
  dims?: number;
  /** Override the model name (voyage/jina). */
  model?: string;
  /** Explicit API key (otherwise read from the standard env var). */
  apiKey?: string;
}

/** Build an `Embedder` for the given kind + options. Throws `ConfigError` on bad input. */
export function buildEmbedder(opts: BuildEmbedderOpts): Embedder {
  const dims = opts.dims ?? DEFAULT_DIMS[opts.kind];
  switch (opts.kind) {
    case 'mock':
      return new HashEmbedder(dims);
    case 'voyage':
      return new VoyageEmbedder({ dims, model: opts.model, apiKey: opts.apiKey });
    case 'jina':
      return new JinaEmbedder({ dims, model: opts.model, apiKey: opts.apiKey });
    default: {
      const _exhaustive: never = opts.kind;
      throw new ConfigError(`Unknown embedder kind: ${String(_exhaustive)}`);
    }
  }
}
