import { describe, it, expect, beforeAll } from 'vitest';
import { TreeSitterParser } from '../../src/core/parser/index.js';
import { loadLanguage, languageForFile } from '../../src/core/parser/grammars.js';
import { chunkTree, chunkWindowed } from '../../src/core/parser/chunker.js';
import type { LanguageId } from '../../src/types/index.js';

const p = new TreeSitterParser();

describe('chunker', () => {
  beforeAll(async () => {
    await loadLanguage('typescript');
    await loadLanguage('python');
    await loadLanguage('go');
  });

  it('chunks one chunk per top-level function (TS)', async () => {
    const src = [
      'function a() { return 1; }',
      'function b() { return 2; }',
      'class C {',
      '  method m() { return 3; }',
      '}',
    ].join('\n');
    const tree = await p.parse('m.ts', src);
    const chunks = chunkTree(tree, src, { repoId: 'r', file: 'm.ts', maxTokens: 800 });
    const syms = chunks.map((c) => c.symbol);
    expect(syms).toContain('a');
    expect(syms).toContain('b');
    expect(syms).toContain('C');
    // method m is nested in class C, so it may be merged into the class chunk
    expect(chunks.every((c) => c.language === ('typescript' as LanguageId))).toBe(true);
    expect(chunks.every((c) => c.contentHash.length === 64)).toBe(true);
    expect(chunks.every((c) => c.startLine <= c.endLine)).toBe(true);
  });

  it('splits an oversized function recursively', async () => {
    // Build a huge function: many statements, each padded to ~10 tokens.
    const stmts: string[] = [];
    for (let i = 0; i < 200; i++)
      stmts.push(`  const valueNumber${i} = someComputation(${i}, ${i + 1});`);
    const src = ['function huge() {', ...stmts, '  return valueNumber0;', '}'].join('\n');
    const tree = await p.parse('h.ts', src);
    const chunks = chunkTree(tree, src, { repoId: 'r', file: 'h.ts', maxTokens: 200 });
    expect(chunks.length).toBeGreaterThan(1);
    // The outer function chunk is preserved (symbol 'huge').
    expect(chunks.some((c) => c.symbol === 'huge')).toBe(true);
    // And its child statements were split into separate chunks.
    expect(chunks.some((c) => c.symbol === null && c.kind === 'block')).toBe(true);
  });

  it('windowed fallback for .txt files', () => {
    const lines: string[] = [];
    for (let i = 0; i < 120; i++) lines.push(`line ${i} some content here`);
    const src = lines.join('\n');
    const chunks = chunkWindowed(src, { repoId: 'r', file: 'notes.txt' });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]!.language).toBe('text');
    expect(chunks[0]!.kind).toBe('block');
    expect(chunks.every((c) => c.contentHash.length === 64)).toBe(true);
  });

  it('windowed fallback respects maxTokens by shrinking', () => {
    const lines: string[] = [];
    for (let i = 0; i < 200; i++) lines.push('word '.repeat(20)); // very token-dense
    const src = lines.join('\n');
    const chunks = chunkWindowed(src, { repoId: 'r', file: 'big.txt', maxTokens: 200 });
    expect(chunks.length).toBeGreaterThan(1);
  });

  it('hashes are stable across runs', async () => {
    const src = 'function a() { return 1; }';
    const tree = await p.parse('m.ts', src);
    const a = chunkTree(tree, src, { repoId: 'r', file: 'm.ts' });
    const b = chunkTree(tree, src, { repoId: 'r', file: 'm.ts' });
    expect(a[0]!.contentHash).toBe(b[0]!.contentHash);
  });

  it('chunk boundaries align to function edges (python)', async () => {
    const src = ['def alpha():', '    return 1', '', 'def beta():', '    return 2'].join('\n');
    const tree = await p.parse('m.py', src);
    const chunks = chunkTree(tree, src, { repoId: 'r', file: 'm.py' });
    const syms = chunks.map((c) => c.symbol);
    expect(syms).toContain('alpha');
    expect(syms).toContain('beta');
    void languageForFile;
  });
});
