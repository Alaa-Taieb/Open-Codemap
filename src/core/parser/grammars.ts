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
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { LanguageId } from '../../types/index.js';
import { ParseError } from '../../errors.js';

// `tree-sitter-wasm`'s `getWasmPath(lang)` resolves the `.wasm` relative to *its own*
// `import.meta.url`. When OCM is bundled (esbuild/Vite/Electron), that resolution
// breaks with `ENOENT`. Instead we resolve the real `tree-sitter-wasm` package root
// via `createRequire` and join the well-known `out/<lang>/tree-sitter-<lang>.wasm`
// layout. `createRequire(import.meta.url)` is transpiled to the equivalent CJS path by
// esbuild in the `.cjs` build, so this works in both ESM and CJS.
// esbuild transpiles `import.meta.url` to `undefined` in the CJS (`.cjs`) build, so
// we fall back to `__filename` (which esbuild defines for CJS) when it is available.
// This yields a working `createRequire` in both ESM and CJS outputs.
const req = createRequire(typeof __filename !== 'undefined' ? __filename : import.meta.url);

/** Absolute path to a language's prebuilt grammar wasm inside `tree-sitter-wasm`. */
export function resolveGrammarWasmPath(lang: SupportedGrammar): string {
  const pkgRoot = dirname(req.resolve('tree-sitter-wasm'));
  return join(pkgRoot, 'out', lang, `tree-sitter-${lang}.wasm`);
}

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

/** The set of grammar folder names shipped by `tree-sitter-wasm` that OCM supports. */
export type SupportedGrammar =
  | 'javascript'
  | 'typescript'
  | 'tsx'
  | 'python'
  | 'go'
  | 'rust'
  | 'java'
  | 'c'
  | 'cpp'
  | 'c_sharp'
  | 'ruby';

/** Tree-sitter grammar folder name for each supported language. */
const WASM_NAME: Record<Exclude<LanguageId, 'text'>, SupportedGrammar> = {
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
      const path = resolveGrammarWasmPath(wasmName);
      return await Language.load(path);
    } catch (cause) {
      const wasmPath = resolveGrammarWasmPath(wasmName);
      throw new ParseError(`Failed to load grammar for language "${id}"`, {
        cause,
        details: { language: id, wasmPath },
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
