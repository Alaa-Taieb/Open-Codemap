import { describe, it, expect } from 'vitest';
import type {
  RepoChunk,
  SymbolNode,
  Edge,
  QueryRequest,
  QueryResult,
  IndexOptions,
  IndexProgress,
  Job,
  LanguageId,
  ChunkKind,
} from '../../src/types/index.js';

describe('domain types (smoke)', () => {
  it('RepoChunk shape is constructible', () => {
    const chunk: RepoChunk = {
      id: 'repo1:abc',
      repoId: 'repo1',
      file: 'src/a.ts',
      startLine: 1,
      endLine: 10,
      symbol: 'foo',
      language: 'typescript',
      kind: 'function',
      content: 'function foo() {}',
      contentHash: 'abc',
    };
    expect(chunk.language).toBe('typescript');
    expect(chunk.kind).toBe('function');
  });

  it('SymbolNode + Edge are constructible', () => {
    const sym: SymbolNode = {
      id: 'repo1#src/a.ts@foo',
      repoId: 'repo1',
      file: 'src/a.ts',
      name: 'foo',
      kind: 'function',
      defLine: 2,
    };
    const edge: Edge = { srcId: sym.id, dstId: 'repo1#src/b.ts@bar', kind: 'calls' };
    expect(edge.kind).toBe('calls');
  });

  it('QueryRequest/QueryResult/Index types are constructible', () => {
    const req: QueryRequest = { text: 'validate login', topK: 5, expandGraph: true };
    const result: QueryResult = {
      chunk: {
        id: 'r:c',
        repoId: 'r',
        file: 'a.py',
        startLine: 1,
        endLine: 2,
        symbol: 'validate_login',
        language: 'python',
        kind: 'function',
        content: 'def validate_login(): pass',
        contentHash: 'c',
      },
      score: 0.9,
      mode: 'rrf',
    };
    const opts: IndexOptions = { reindex: false, watch: false, ignore: ['dist'] };
    const prog: IndexProgress = { phase: 'parse', done: 1, total: 10, file: 'a.ts' };
    const job: Job = {
      id: 'j1',
      status: 'running',
      progress: prog,
      createdAt: 0,
      updatedAt: 0,
    };
    expect(req.text).toBe('validate login');
    expect(result.mode).toBe('rrf');
    expect(opts.ignore?.[0]).toBe('dist');
    expect(job.status).toBe('running');
  });

  it('LanguageId and ChunkKind are closed unions', () => {
    const langs: LanguageId[] = [
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
    ];
    const kinds: ChunkKind[] = ['function', 'class', 'method', 'block', 'file'];
    expect(langs).toHaveLength(12);
    expect(kinds).toHaveLength(5);
  });
});
