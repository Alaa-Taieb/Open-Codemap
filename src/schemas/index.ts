import { z } from 'zod';

/**
 * Shared zod schemas.
 *
 * These schemas are the single source of truth for validating inputs that
 * arrive from BOTH the CLI and the HTTP API, so validation never diverges
 * between the two adapters. The CLI and API each parse through these before
 * touching core logic.
 */

/** Embedder implementations available to the user. */
export const embedderKindSchema = z.enum(['mock', 'voyage', 'jina']);
export type EmbedderKindSchema = z.infer<typeof embedderKindSchema>;

/** Language identifiers accepted from external input (subset of internal LanguageId). */
export const languageIdSchema = z.enum([
  'javascript',
  'typescript',
  'tsx',
  'python',
  'go',
  'rust',
  'java',
  'c',
  'cpp',
  'c_sharp',
  'ruby',
  'text',
]);

/**
 * Embedder/model configuration. The CLI/API resolve which embedder to build
 * from `kind`; `dims` lets the user override the default embedding width.
 */
export const configSchema = z.object({
  embedder: embedderKindSchema.default('mock'),
  model: z.string().optional(),
  /** Name of the env var holding the API key (e.g. "VOYAGE_AI_API_KEY"). */
  apiKeyEnv: z.string().optional(),
  dbPath: z.string().optional(),
  /** Restrict indexing to these languages (otherwise all supported grammars). */
  languages: z.array(languageIdSchema).optional(),
  /** Glob patterns to ignore in addition to .gitignore. */
  ignore: z.array(z.string()).optional(),
});
export type ConfigSchema = z.infer<typeof configSchema>;

/** A query against the index. */
export const querySchema = z.object({
  text: z.string().min(1, 'query text must be non-empty'),
  topK: z.number().int().min(1).max(100).default(10),
  filters: z
    .object({
      language: languageIdSchema.optional(),
      file: z.string().optional(),
    })
    .optional(),
  expandGraph: z.boolean().optional(),
});
export type QuerySchema = z.infer<typeof querySchema>;

/** Options controlling an indexing run. */
export const indexOptionsSchema = z.object({
  reindex: z.boolean().optional(),
  watch: z.boolean().optional(),
  ignore: z.array(z.string()).optional(),
  include: z.array(z.string()).optional(),
});
export type IndexOptionsSchema = z.infer<typeof indexOptionsSchema>;

/** Body for `POST /index`. */
export const indexRequestSchema = z.object({
  repo: z.string().min(1, 'repo path is required'),
  reindex: z.boolean().optional(),
  watch: z.boolean().optional(),
  ignore: z.array(z.string()).optional(),
  include: z.array(z.string()).optional(),
  embedder: embedderKindSchema.optional(),
});
export type IndexRequestSchema = z.infer<typeof indexRequestSchema>;

/** Body for `POST /query`. */
export const queryRequestSchema = z.object({
  repo: z.string().min(1, 'repo path is required'),
  text: z.string().min(1, 'query text must be non-empty'),
  topK: z.number().int().min(1).max(100).optional(),
  filters: querySchema.shape.filters.optional(),
  expandGraph: z.boolean().optional(),
  embedder: embedderKindSchema.optional(),
});
export type QueryRequestSchema = z.infer<typeof queryRequestSchema>;
