/**
 * Grammar registry.
 *
 * Maps file extensions to `LanguageId`, and `LanguageId` to an async loader that
 * returns a web-tree-sitter `Language`. Grammars are prebuilt `.wasm` files from
 * the `tree-sitter-wasm` package (no native build, ABI-stable across Node versions).
 *
 * The WASM runtime is initialised once via `ensureParserReady()`; `Language.load`
 * is memoised per language so repeated parses are cheap.
 */

import { Parser, Language } from 'web-tree-sitter';
import { getWasmPath, type SupportedLanguage } from 'tree-sitter-wasm';
import type { LanguageId } from '../../types/index.js';
import { ParseError } from '../../errors.js';

let runtimeReady = false;

/** Initialise the web-tree-sitter WASM runtime exactly once. */
export async function ensureParserReady(): Promise<void> {
  if (runtimeReady) return;
  await Parser.init();
  runtimeReady = true;
}

/** Map a file path/extension to a supported `LanguageId`, or null if unsupported. */
export function languageForFile(file: string): LanguageId | null {
  const lower = file.toLowerCase();
  const ext = lower.includes('.') ? lower.slice(lower.lastIndexOf('.') + 1) : '';
  switch (ext) {
    case 'js':
    case 'mjs':
    case 'cjs':
    case 'jsx':
      return 'javascript';
    case 'ts':
      return 'typescript';
    case 'tsx':
      return 'tsx';
    case 'py':
    case 'pyi':
      return 'python';
    case 'go':
      return 'go';
    case 'rs':
      return 'rust';
    case 'java':
      return 'java';
    case 'c':
    case 'h':
      return 'c';
    case 'cpp':
    case 'cxx':
    case 'cc':
    case 'hpp':
    case 'hxx':
      return 'cpp';
    case 'cs':
      return 'c_sharp';
    case 'rb':
      return 'ruby';
    default:
      return null;
  }
}

/** Tree-sitter `getWasmPath` name for each supported language. */
const WASM_NAME: Record<Exclude<LanguageId, 'text'>, SupportedLanguage> = {
  javascript: 'javascript',
  typescript: 'typescript',
  tsx: 'tsx',
  python: 'python',
  go: 'go',
  rust: 'rust',
  java: 'java',
  c: 'c',
  cpp: 'cpp',
  c_sharp: 'c_sharp',
  ruby: 'ruby',
};

const langCache = new Map<LanguageId, Promise<Language>>();

/** Load (and memoize) a grammar Language for the given id. Returns null if unsupported. */
export async function loadLanguage(id: LanguageId): Promise<Language | null> {
  if (id === 'text') return null;
  const cached = langCache.get(id);
  if (cached) return cached;
  const wasmName = WASM_NAME[id];
  const promise = (async () => {
    await ensureParserReady();
    try {
      const path = getWasmPath(wasmName);
      return await Language.load(path);
    } catch (cause) {
      throw new ParseError(`Failed to load grammar for language "${id}"`, {
        cause,
        details: { language: id, wasmPath: getWasmPath(wasmName) },
      });
    }
  })();
  langCache.set(id, promise);
  return promise;
}

/** Whether a language id is parseable (i.e. not the text fallback). */
export function supports(id: LanguageId | null): boolean {
  return id !== null && id !== 'text';
}
