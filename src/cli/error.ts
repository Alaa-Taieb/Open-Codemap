/**
 * Shared CLI/API error rendering.
 *
 * Core code throws typed `CodemapError`s (each with a stable `code`). This helper
 * renders them consistently and lets unknown errors through as generic messages,
 * so adapters never leak raw stack traces to end users.
 */

import { CodemapError } from '../errors.js';

/** Print a human-readable error and return the resolved exit code. */
export function renderError(cause: unknown): number {
  if (cause instanceof CodemapError) {
    process.stderr.write(`Error [${cause.code}]: ${cause.message}\n`);
    return 1;
  }
  if (cause instanceof Error) {
    process.stderr.write(`Error: ${cause.message}\n`);
    return 1;
  }
  process.stderr.write(`Error: ${String(cause)}\n`);
  return 1;
}
