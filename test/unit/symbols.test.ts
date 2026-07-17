import { describe, it, expect, beforeAll } from 'vitest';
import { TreeSitterParser } from '../../src/core/parser/index.js';
import { loadLanguage } from '../../src/core/parser/grammars.js';
import { extractSymbols } from '../../src/core/parser/symbols.js';

const p = new TreeSitterParser();

describe('symbol & reference extraction', () => {
  beforeAll(async () => {
    await loadLanguage('typescript');
    await loadLanguage('python');
  });

  it('extracts function symbols from a TS file', async () => {
    const src = [
      "import { getAuthToken } from './auth';",
      '',
      'export function getAuthToken(): string {',
      '  return login();',
      '}',
      '',
      'class Session {',
      '  start() { return getAuthToken(); }',
      '}',
    ].join('\n');
    const tree = await p.parse('auth.ts', src);
    const { symbols, edges } = extractSymbols(tree, 'repo1', 'auth.ts', 'typescript');
    const names = symbols.map((s) => s.name);
    expect(names).toContain('getAuthToken');
    expect(names).toContain('Session');
    expect(names).toContain('start');
    // import edge present
    expect(edges.some((e) => e.kind === 'imports')).toBe(true);
    // call edge getAuthToken -> login (login defined elsewhere, may not resolve)
    expect(symbols.find((s) => s.name === 'getAuthToken')?.defLine).toBe(3);
  });

  it('extracts def + call edges from a Python file', async () => {
    const src = [
      'from auth import validate_login',
      '',
      'def validate_login():',
      '    return True',
      '',
      'def handler():',
      '    return validate_login()',
    ].join('\n');
    const tree = await p.parse('app.py', src);
    const { symbols, edges } = extractSymbols(tree, 'repo1', 'app.py', 'python');
    const names = symbols.map((s) => s.name);
    expect(names).toContain('validate_login');
    expect(names).toContain('handler');
    expect(edges.some((e) => e.kind === 'imports')).toBe(true);
    // handler -> validate_login call edge (both resolved)
    const handler = symbols.find((s) => s.name === 'handler');
    const login = symbols.find((s) => s.name === 'validate_login');
    expect(handler && login).toBeTruthy();
    expect(
      edges.some((e) => e.kind === 'calls' && e.srcId.includes('handler') && e.dstId === login!.id),
    ).toBe(true);
  });

  it('returns empty for an empty tree', () => {
    // build a minimal fake tree-like object
    const fake = { rootNode: null } as any;
    const { symbols, edges } = extractSymbols(fake, 'r', 'f', 'text');
    expect(symbols).toEqual([]);
    expect(edges).toEqual([]);
  });
});
