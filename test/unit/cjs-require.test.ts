import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const distCjs = resolve(__dirname, '../../dist/index.cjs');
const distExists = existsSync(distCjs);

describe('CJS require of the package (D1/D2)', () => {
  // The dual CJS build is produced by `npm run build`; CI runs build before test.
  // When dist is absent (e.g. unit-only runs before build) we skip gracefully.
  it.skipIf(!distExists)('exposes the documented library surface from dist/index.cjs', () => {
    const m = require(distCjs);
    expect(typeof m.Indexer).toBe('function');
    expect(typeof m.Retriever).toBe('function');
    expect(typeof m.TreeSitterParser).toBe('function');
    expect(typeof m.HashEmbedder).toBe('function');
    expect(typeof m.VERSION).toBe('string');
    expect(m.VERSION).toBe('0.1.1');
  });
});
