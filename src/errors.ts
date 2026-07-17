/**
 * Typed error hierarchy for Open-Codemap.
 *
 * Core code never throws raw strings. Every failure is a `CodemapError` with a
 * stable `code` (used by the API to pick an HTTP status) and an optional
 * `cause` for chaining. Adapters map these to user-facing messages / status.
 */

export type ErrorCode =
  | 'PARSE_ERROR'
  | 'EMBED_ERROR'
  | 'STORE_ERROR'
  | 'CONFIG_ERROR'
  | 'WORKSPACE_NOT_FOUND'
  | 'NOT_FOUND'
  | 'INVALID_INPUT'
  | 'INTERNAL_ERROR';

/** Maps an error code to the HTTP status the API should return. */
export const HTTP_STATUS_FOR_CODE: Record<ErrorCode, number> = {
  PARSE_ERROR: 422,
  EMBED_ERROR: 502,
  STORE_ERROR: 500,
  CONFIG_ERROR: 400,
  WORKSPACE_NOT_FOUND: 404,
  NOT_FOUND: 404,
  INVALID_INPUT: 400,
  INTERNAL_ERROR: 500,
};

export interface CodemapErrorOptions {
  cause?: unknown;
  /** Arbitrary structured detail (status, body, language, wasmPath, ...). */
  details?: Record<string, unknown>;
}

export class CodemapError extends Error {
  readonly code: ErrorCode;
  /** Stable machine-readable code, also exposed as `statusCode` for Fastify. */
  readonly statusCode: number;
  override readonly cause?: unknown;
  readonly details?: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, options?: CodemapErrorOptions) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = HTTP_STATUS_FOR_CODE[code];
    this.cause = options?.cause;
    this.details = options?.details;
    // Restore prototype chain for instanceof checks across transpilation.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ParseError extends CodemapError {
  constructor(message: string, options?: CodemapErrorOptions) {
    super('PARSE_ERROR', message, options);
  }
}

export class EmbedError extends CodemapError {
  constructor(message: string, options?: CodemapErrorOptions) {
    super('EMBED_ERROR', message, options);
  }
}

export class StoreError extends CodemapError {
  constructor(message: string, options?: CodemapErrorOptions) {
    super('STORE_ERROR', message, options);
  }
}

export class ConfigError extends CodemapError {
  constructor(message: string, options?: CodemapErrorOptions) {
    super('CONFIG_ERROR', message, options);
  }
}

export class WorkspaceNotFound extends CodemapError {
  constructor(message: string, options?: CodemapErrorOptions) {
    super('WORKSPACE_NOT_FOUND', message, options);
  }
}

export class NotFoundError extends CodemapError {
  constructor(message: string, options?: CodemapErrorOptions) {
    super('NOT_FOUND', message, options);
  }
}

/** Re-throw an unknown value as a CodemapError (wrapping non-typed errors). */
export function asCodemapError(err: unknown): CodemapError {
  if (err instanceof CodemapError) return err;
  const message = err instanceof Error ? err.message : String(err);
  return new CodemapError('INTERNAL_ERROR', message, { cause: err });
}
