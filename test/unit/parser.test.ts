import { describe, it, expect, beforeAll } from 'vitest';
import { TreeSitterParser } from '../../src/core/parser/index.js';
import { languageForFile, supports, loadLanguage } from '../../src/core/parser/grammars.js';

describe('parser abstraction + grammar registry', () => {
  const p = new TreeSitterParser();

  beforeAll(async () => {
    await loadLanguage('javascript');
    await loadLanguage('python');
  });

  it('maps file extensions to language ids', () => {
    expect(languageForFile('a.ts')).toBe('typescript');
    expect(languageForFile('a.tsx')).toBe('tsx');
    expect(languageForFile('a.py')).toBe('python');
    expect(languageForFile('a.go')).toBe('go');
    expect(languageForFile('a.rs')).toBe('rust');
    expect(languageForFile('a.java')).toBe('java');
    expect(languageForFile('a.c')).toBe('c');
    expect(languageForFile('a.cpp')).toBe('cpp');
    expect(languageForFile('a.cs')).toBe('c_sharp');
    expect(languageForFile('a.rb')).toBe('ruby');
    expect(languageForFile('a.txt')).toBe(null);
  });

  it('reports support correctly', () => {
    expect(supports(languageForFile('a.ts'))).toBe(true);
    expect(supports(languageForFile('a.txt'))).toBe(false);
    expect(p.supportsFile('a.ts')).toBe(true);
    expect(p.supportsFile('a.txt')).toBe(false);
  });

  it('parses a .ts snippet', async () => {
    const tree = await p.parse('a.ts', 'function f(a: number): number { return a + 1; }');
    expect(tree?.rootNode.type).toBe('program');
    const fn = tree?.rootNode.child(0);
    expect(fn?.type).toBe('function_declaration');
  });

  it('parses a .py snippet', async () => {
    const tree = await p.parse('a.py', 'def validate_login():\n    return True\n');
    expect(tree?.rootNode.type).toBe('module');
    const fn = tree?.rootNode.child(0);
    expect(fn?.type).toBe('function_definition');
  });

  it('throws ParseError for unsupported files', async () => {
    await expect(p.parse('a.txt', 'hello')).rejects.toThrow(/No grammar available/);
  });
});
