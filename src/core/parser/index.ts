/**
 * Parser abstraction over web-tree-sitter.
 *
 * Synchronous-feeling API (`parse` is async because web-tree-sitter grammars load
 * lazily), backed by the grammar registry. Unknown extensions return `supports=false`
 * and the caller falls back to the sliding-window chunker.
 *
 * Note: web-tree-sitter requires `Parser.init()` (the WASM runtime) before a `Parser`
 * can be constructed, so the `Parser` instance is created lazily on first parse. This
 * keeps module import side-effect free and avoids ordering hazards.
 */

import { Parser } from 'web-tree-sitter';
import type { LanguageId } from '../../types/index.js';
import { ParseError } from '../../errors.js';
import { loadLanguage, languageForFile, supports, ensureParserReady } from './grammars.js';

export type SyntaxTree = Awaited<ReturnType<Parser['parse']>>;

export class TreeSitterParser {
  private parser: Parser | null = null;

  private async ensureParser(): Promise<Parser> {
    if (this.parser) return this.parser;
    await ensureParserReady();
    this.parser = new Parser();
    return this.parser;
  }

  /** Resolve the language id for a file and whether we can parse it. */
  languageIdFor(file: string): LanguageId | null {
    return languageForFile(file);
  }

  /** True if this file maps to a supported (non-text) grammar. */
  supportsFile(file: string): boolean {
    return supports(languageForFile(file));
  }

  /** Parse `content` for `file`. Throws ParseError if the grammar cannot be loaded. */
  async parse(file: string, content: string): Promise<SyntaxTree> {
    const id = languageForFile(file);
    if (!supports(id)) {
      throw new ParseError(`No grammar available for file "${file}" (language=${id})`);
    }
    const lang = await loadLanguage(id as Exclude<LanguageId, 'text'>);
    if (!lang) throw new ParseError(`Grammar unavailable for language "${id}"`);
    const parser = await this.ensureParser();
    parser.setLanguage(lang);
    return parser.parse(content);
  }
}

/** Convenience: a shared singleton parser instance. */
export const parser = new TreeSitterParser();
