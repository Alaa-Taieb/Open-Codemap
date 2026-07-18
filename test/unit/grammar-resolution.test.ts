import { describe, it, expect } from 'vitest';
import { resolveGrammarWasmPath } from '../../src/core/parser/grammars.js';
import { existsSync } from 'node:fs';

describe('grammar wasm resolution (D3)', () => {
  it('resolves an absolute path under the real tree-sitter-wasm package root', () => {
    const p = resolveGrammarWasmPath('typescript');
    expect(p).toMatch(/tree-sitter-wasm[\\/]out[\\/]typescript[\\/]tree-sitter-typescript\.wasm$/);
  });

  it('targets a file that actually exists in node_modules', () => {
    const p = resolveGrammarWasmPath('typescript');
    expect(existsSync(p)).toBe(true);
  });

  it('resolves the c_sharp grammar (underscore folder name)', () => {
    const p = resolveGrammarWasmPath('c_sharp');
    expect(p).toMatch(/out[\\/]c_sharp[\\/]tree-sitter-c_sharp\.wasm$/);
    expect(existsSync(p)).toBe(true);
  });
});
