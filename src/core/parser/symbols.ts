/**
 * Symbol & reference extraction.
 *
 * Walks a parsed tree-sitter syntax tree and extracts:
 *   - `SymbolNode[]` — named declarations (functions, classes, methods, …)
 *   - `Edge[]`       — `imports` edges (between the file and imported symbols)
 *                     and best-effort `calls` edges (identifier → referenced name)
 *
 * We deliberately keep this **best-effort and generic** (node-type heuristics +
 * field names) rather than per-language query files, so it works for all v1
 * languages without maintaining a query corpus. Precise call graphs (LSP/SCIP)
 * are an explicit later upgrade (research §10, risk #3).
 */

import type { SyntaxTree } from './index.js';
import type { SymbolNode, Edge, LanguageId } from '../../types/index.js';

/** Node types that denote a declaration we want to surface as a symbol. */
const DECL_TYPES = new Set([
  'function_declaration',
  'function_definition',
  'method_definition',
  'method_declaration',
  'generator_function_declaration',
  'generator_function_definition',
  'class_declaration',
  'class_definition',
  'interface_declaration',
  'struct_declaration',
  'impl_item',
  'trait_declaration',
  'enum_declaration',
  'module_declaration',
  'const_declaration',
  'let_declaration',
  'variable_declarator',
  'arrow_function',
]);

/** Node types that denote an import/require statement. */
const IMPORT_TYPES = new Set([
  'import_statement',
  'import_from_statement',
  'import_declaration',
  'using_directive',
  'require_call',
  'call_expression', // for `require(...)` / `import(...)` in JS
]);

function nameOf(node: { childForFieldName: (f: string) => unknown }): string | null {
  for (const field of ['name', 'identifier', 'value']) {
    const n = (
      node as { childForFieldName: (f: string) => { text: string } | null }
    ).childForFieldName(field);
    if (n && typeof n.text === 'string' && n.text.length > 0) return n.text;
  }
  return null;
}

function isImportLike(type: string): boolean {
  return IMPORT_TYPES.has(type);
}

export interface ExtractedSymbols {
  symbols: SymbolNode[];
  edges: Edge[];
}

/**
 * Extract symbols + import/call edges from a parsed tree.
 * @param tree    parsed syntax tree
 * @param repoId  workspace id (for symbol/edge ids)
 * @param file    repository-relative file path
 * @param lang    language id
 */
export function extractSymbols(
  tree: SyntaxTree,
  repoId: string,
  file: string,
  lang: LanguageId,
): ExtractedSymbols {
  const symbols: SymbolNode[] = [];
  const edges: Edge[] = [];
  const fileId = `${repoId}:${file}`;

  const root = tree?.rootNode;
  if (!root) return { symbols, edges };

  const collect = (node: any): void => {
    const type = node.type as string;

    if (DECL_TYPES.has(type)) {
      const name = nameOf(node);
      if (name) {
        const symId = `${fileId}#${name}@${node.startPosition.row}`;
        symbols.push({
          id: symId,
          repoId,
          file,
          name,
          kind: type,
          defLine: node.startPosition.row + 1,
        });
      }
    }

    if (isImportLike(type)) {
      // Capture imported module/symbol names as `imports` edges.
      const targets = importTargets(node);
      for (const t of targets) {
        edges.push({ srcId: fileId, dstId: `${repoId}:import:${t}`, kind: 'imports' });
      }
    }

    for (let i = 0; i < node.childCount; i++) {
      collect(node.child(i));
    }
  };

  // Use a recursive walk (cursor API is more efficient but recursion is clearer here).
  collect(root as any);

  // Best-effort call edges: identifier references resolved to sibling symbols by name.
  // The source of each call edge is the *enclosing* declaration (so we know which
  // function called which), falling back to the file if it is top-level.
  const nameToId = new Map<string, string>();
  for (const s of symbols) {
    if (!nameToId.has(s.name)) nameToId.set(s.name, s.id);
  }
  const callRefs = collectCallRefs(root as any, fileId);
  for (const ref of callRefs) {
    const dst = nameToId.get(ref.name);
    if (dst) edges.push({ srcId: ref.srcId, dstId: dst, kind: 'calls' });
  }

  return { symbols, edges };
}

/** Collect imported module/symbol names from an import-like node. */
function importTargets(node: any): string[] {
  const out: string[] = [];
  const walk = (n: any): void => {
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i);
      const t = c.type as string;
      if (
        t === 'string' ||
        t === 'string_fragment' ||
        t === 'module_identifier' ||
        t === 'identifier' ||
        t === 'dotted_name' ||
        t === 'aliased_import' ||
        t === 'import_spec'
      ) {
        const text = (c.text ?? '').replace(/^['"]|['"]$/g, '');
        if (text && t !== 'identifier') out.push(text);
        else if (text && (n.type === 'import_spec' || n.type === 'aliased_import')) out.push(text);
      }
      walk(c);
    }
  };
  walk(node);
  return out;
}

/** Node types that denote a function/method call expression (language-agnostic). */
function isCallNode(type: string): boolean {
  const t = type.toLowerCase();
  return t.includes('call') && !t.includes('callback');
}

/** A callee reference anchored to its enclosing declaration. */
interface CallRef {
  name: string;
  srcId: string;
}

/** Collect callee references, attributing each to its enclosing declaration. */
function collectCallRefs(node: any, fileId: string): CallRef[] {
  const refs: CallRef[] = [];
  const walk = (n: any, enclosingId: string | null): void => {
    // Track the current enclosing declaration for attribution.
    let current = enclosingId;
    if (DECL_TYPES.has(n.type)) {
      const name = nameOf(n);
      if (name) current = `${fileId}#${name}@${n.startPosition.row}`;
    }
    const parent = n.parent;
    if (
      (n.type === 'identifier' || n.type === 'field_identifier') &&
      parent &&
      isCallNode(parent.type)
    ) {
      const text = n.text as string;
      if (text) refs.push({ name: text, srcId: current ?? fileId });
    }
    for (let i = 0; i < n.childCount; i++) walk(n.child(i), current);
  };
  walk(node, null);
  return refs;
}
