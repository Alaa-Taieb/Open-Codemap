/**
 * cAST-style recursive chunker + sliding-window fallback.
 *
 * For parseable files we emit one chunk per top-level definition (function /
 * class / method), sized via a cheap `~10 tokens/line` heuristic (research §9.1).
 * Oversized definitions are recursively split on statement/block boundaries;
 * small siblings are merged up to the budget (cAST algorithm, Ref 4c44dde7).
 *
 * Unparseable / unsupported files fall back to fixed-size overlapping line windows.
 */

import { createHash } from 'node:crypto';
import type { SyntaxTree } from './index.js';
import { languageForFile } from './grammars.js';
import type { RepoChunk, ChunkKind, LanguageId } from '../../types/index.js';

const TOKENS_PER_LINE = 10;

/** Node types that begin a top-level chunkable definition. */
const TOP_LEVEL_DEF = new Set([
  'function_declaration',
  'function_definition',
  'generator_function_declaration',
  'generator_function_definition',
  'class_declaration',
  'class_definition',
  'interface_declaration',
  'struct_declaration',
  'enum_declaration',
  'trait_declaration',
  'module_declaration',
  'method_definition',
  'method_declaration',
  'impl_item',
  'decorated_definition',
  'decorated_declaration',
]);

/** Node types used as split boundaries when a def exceeds the token budget. */
const SPLIT_BOUNDARY = new Set([
  'statement_block',
  'block',
  'expression_statement',
  'declaration',
  'assignment',
  'function_declaration',
  'function_definition',
  'class_declaration',
  'class_definition',
  'if_statement',
  'for_statement',
  'while_statement',
  'return_statement',
  'call_expression',
  'method_definition',
]);

export interface ChunkerOptions {
  /** Max estimated tokens per chunk before recursive splitting. */
  maxTokens?: number;
  /** Sliding-window fallback: lines per window. */
  windowLines?: number;
  /** Sliding-window fallback: line overlap between windows. */
  windowOverlap?: number;
  repoId: string;
  file: string;
}

function hash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function estTokens(text: string): number {
  const lines = text.split('\n').length;
  return Math.max(1, Math.round(lines * TOKENS_PER_LINE));
}

function linesOf(node: { startPosition: { row: number }; endPosition: { row: number } }): number {
  return node.endPosition.row - node.startPosition.row + 1;
}

function contentOf(source: string, startRow: number, endRow: number): string {
  // source is 0-indexed lines internally; rows are 0-indexed from tree-sitter.
  const arr = source.split('\n');
  return arr.slice(startRow, endRow + 1).join('\n');
}

function kindFor(nodeType: string): ChunkKind {
  if (
    nodeType.includes('class') ||
    nodeType.includes('struct') ||
    nodeType.includes('interface') ||
    nodeType.includes('enum') ||
    nodeType.includes('trait') ||
    nodeType.includes('module')
  )
    return 'class';
  if (nodeType.includes('method')) return 'method';
  if (nodeType.includes('function') || nodeType.includes('def')) return 'function';
  return 'block';
}

function nameOf(node: any): string | null {
  for (const field of ['name', 'identifier']) {
    const n = node.childForFieldName?.(field);
    if (n && typeof n.text === 'string' && n.text.length > 0) return n.text;
  }
  return null;
}

/**
 * Produce chunks for a parsed tree. `source` is the original file text.
 */
export function chunkTree(tree: SyntaxTree, source: string, opts: ChunkerOptions): RepoChunk[] {
  const maxTokens = opts.maxTokens ?? 800;
  const root = tree?.rootNode;
  if (!root) return [];

  const lang = languageForFile(opts.file);
  const langId: LanguageId = lang ?? 'text';
  const chunks: RepoChunk[] = [];

  const pushChunk = (node: any, kind: ChunkKind, symbol: string | null): void => {
    const startLine = node.startPosition.row + 1;
    const endLine = node.endPosition.row + 1;
    const content = contentOf(source, node.startPosition.row, node.endPosition.row);
    chunks.push({
      id: '', // assigned by the store (repoId:contentHash)
      repoId: opts.repoId,
      file: opts.file,
      startLine,
      endLine,
      symbol,
      language: langId,
      kind,
      content,
      contentHash: hash(content),
    });
  };

  /** Recursively split an oversized node into budget-sized pieces.
   *  `inheritedSymbol` (if set) is applied to the FIRST emitted sub-chunk so a
   *  split definition still surfaces its name on its leading chunk. */
  const splitNode = (node: any, depth: number, inheritedSymbol: string | null = null): void => {
    const nodeTokens = estTokens(contentOf(source, node.startPosition.row, node.endPosition.row));
    if (nodeTokens <= maxTokens || depth > 6) {
      pushChunk(node, kindFor(node.type), inheritedSymbol ?? nameOf(node));
      return;
    }
    // Candidate split points: explicit boundaries (statements/blocks) or, if none,
    // every child (so a block body splits into its statements).
    const boundaries = node.children.filter(
      (c: any) => SPLIT_BOUNDARY.has(c.type) || TOP_LEVEL_DEF.has(c.type),
    );
    const candidates = boundaries.length > 1 ? boundaries : node.children;
    if (candidates.length <= 1) {
      // Truly cannot split further — keep as one chunk.
      pushChunk(node, kindFor(node.type), inheritedSymbol ?? nameOf(node));
      return;
    }
    let first = true;
    for (const c of candidates) {
      const cTokens = estTokens(contentOf(source, c.startPosition.row, c.endPosition.row));
      const sym = first ? (inheritedSymbol ?? nameOf(node)) : null;
      if (cTokens > maxTokens && c.childCount > 1) {
        splitNode(c, depth + 1, sym);
      } else {
        pushChunk(c, kindFor(c.type), sym ?? nameOf(c));
      }
      first = false;
    }
  };

  // Walk top-level defs. Some languages wrap a declaration in a statement node
  // (e.g. TypeScript `export function f() {}` is an `export_statement` whose
  // child is the real `function_declaration`). Unwrap those to the inner def.
  const unwrap = (node: any): any => {
    let n = node;
    let guard = 0;
    while (n && guard < 4) {
      // Wrapper nodes (export_statement, decorated_definition, etc.) carry the
      // real definition as one of their children — pick the first real def child.
      // NOTE: only match TOP_LEVEL_DEF here; SPLIT_BOUNDARY nodes (block, etc.)
      // are *inside* a definition, not wrappers around one.
      const realDef = n.children?.find((c: any) => TOP_LEVEL_DEF.has(c.type));
      if (realDef) return realDef;
      // Single-child wrapper (e.g. parenthesized / labeled) — descend once.
      if (n.childCount === 1) {
        const only = n.child(0);
        if (only && only.type !== n.type) {
          n = only;
          guard++;
          continue;
        }
      }
      break;
    }
    return n;
  };

  for (let i = 0; i < root.childCount; i++) {
    const child = root.child(i);
    if (!child) continue;
    // Skip noise (comments, semicolons, stray tokens).
    if (child.type.endsWith('_comment') || child.type === ';') continue;
    const def = unwrap(child);
    if (TOP_LEVEL_DEF.has(def.type)) {
      const tokens = estTokens(contentOf(source, def.startPosition.row, def.endPosition.row));
      if (tokens > maxTokens && def.childCount > 1) {
        splitNode(def, 0);
      } else {
        pushChunk(def, kindFor(def.type), nameOf(def));
      }
    }
  }

  // If nothing was chunked (no top-level defs), fall back to a single file chunk.
  if (chunks.length === 0) {
    const content = source.replace(/\s+$/, '');
    if (content.length > 0) {
      chunks.push({
        id: '',
        repoId: opts.repoId,
        file: opts.file,
        startLine: 1,
        endLine: source.split('\n').length,
        symbol: null,
        language: langId,
        kind: 'file',
        content,
        contentHash: hash(content),
      });
    }
  }

  return chunks;
}

/**
 * Sliding-window fallback for unparseable / unsupported files.
 */
export function chunkWindowed(source: string, opts: ChunkerOptions): RepoChunk[] {
  const windowLines = opts.windowLines ?? 40;
  const windowOverlap = opts.windowOverlap ?? 8;
  const maxTokens = opts.maxTokens ?? 800;
  const lines = source.split('\n');
  const repoId = opts.repoId;
  const file = opts.file;
  const chunks: RepoChunk[] = [];

  if (lines.length === 0) return chunks;

  let start = 0;
  let idx = 0;
  while (start < lines.length) {
    const end = Math.min(start + windowLines, lines.length);
    const content = lines.slice(start, end).join('\n').replace(/\s+$/, '');
    if (content.length > 0) {
      const est = estTokens(content);
      // If a single window exceeds the budget, shrink it to fit.
      const usableEnd =
        est > maxTokens && end - start > 1
          ? start + Math.max(1, Math.floor((end - start) * (maxTokens / est)))
          : end;
      const finalContent = lines.slice(start, usableEnd).join('\n').replace(/\s+$/, '');
      chunks.push({
        id: '',
        repoId,
        file,
        startLine: start + 1,
        endLine: usableEnd,
        symbol: null,
        language: 'text',
        kind: 'block',
        content: finalContent,
        contentHash: hash(finalContent),
      });
      idx++;
    }
    if (end === lines.length) break;
    start = end - windowOverlap;
  }

  return chunks;
}

/** High-level chunk entry: parseable -> cAST chunker, else windowed. */
export function chunkSource(
  source: string,
  opts: ChunkerOptions & { tree?: SyntaxTree | null },
): RepoChunk[] {
  if (opts.tree) return chunkTree(opts.tree, source, opts);
  return chunkWindowed(source, opts);
}
