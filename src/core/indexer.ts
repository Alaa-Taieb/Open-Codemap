/**
 * Indexer — orchestrates parsing, chunking, embedding, and storage.
 *
 * Pipeline for `index(repoPath, options)`:
 *   1. Resolve `repo_id` and open (or create) the per-workspace store via the registry.
 *   2. Walk files (respecting .gitignore + options.ignore), hashing each; skip files
 *      whose content hash is unchanged since the last run (incremental).
 *   3. For changed files (concurrent via p-limit): parse -> chunk. A chunk whose
 *      contentHash already exists in the store is updated *in place* (location only,
 *      no re-embed) — this handles moved/renamed code cheaply. New chunks are batched
 *      and embedded, then upserted (one transaction per file so a mid-run failure is
 *      re-runnable).
 *   4. Files present in the manifest but absent from the walk are removed.
 *   5. Progress is emitted as `IndexProgress` events; the final progress is returned.
 *
 * `--rebuild` (options.reindex) drops + recreates the store first.
 */

import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import fg from 'fast-glob';
import ignore from 'ignore';
import type { Ignore } from 'ignore';
import pLimit from 'p-limit';

// `ignore` v5 is a CommonJS `export =` module; under NodeNext the default import
// is typed as the namespace, but at runtime it is the callable factory function.
const createIgnore = ignore as unknown as () => Ignore;
import { createHash } from 'node:crypto';

import type { Embedder } from './embed/index.js';
import type { TreeSitterParser } from './parser/index.js';
import { languageForFile } from './parser/grammars.js';
import { extractSymbols } from './parser/symbols.js';
import { chunkTree, chunkWindowed, type ChunkerOptions } from './parser/chunker.js';
import type { WorkspaceRegistry } from './registry/index.js';
import type { SqliteStore } from './store/sqlite.js';
import { ParseError, ConfigError } from '../errors.js';
import { createLogger, type Logger } from '../logger.js';
import type { IndexOptions, IndexProgress, RepoChunk, LanguageId } from '../types/index.js';

export interface IndexerDeps {
  embedder: Embedder;
  parser: TreeSitterParser;
  registry: WorkspaceRegistry;
  logger?: Logger;
  /** File-concurrency for parsing/embedding (default 4). */
  concurrency?: number;
}

/** Default per-chunk token budget before recursive splitting. */
const DEFAULT_MAX_TOKENS = 800;

export class Indexer extends EventEmitter {
  private readonly embedder: Embedder;
  private readonly parser: TreeSitterParser;
  private readonly registry: WorkspaceRegistry;
  private readonly log: Logger;
  private readonly concurrency: number;

  constructor(deps: IndexerDeps) {
    super();
    this.embedder = deps.embedder;
    this.parser = deps.parser;
    this.registry = deps.registry;
    this.log = deps.logger ?? createLogger('indexer');
    this.concurrency = deps.concurrency ?? 4;
  }

  private emitProgress(phase: IndexProgress['phase'], done: number, total: number, file?: string) {
    const p: IndexProgress = { phase, done, total, file };
    this.emit('progress', p);
  }

  /** Index (or re-index) `repoPath`. Returns the final progress snapshot. */
  async index(repoPath: string, options: IndexOptions = {}): Promise<IndexProgress> {
    const abs = path.resolve(repoPath);
    const store = await this.registry.open(abs, {
      dims: this.embedder.dims,
      reindex: options.reindex,
    });
    try {
      return await this.run(store, abs, options);
    } finally {
      store.close();
    }
  }

  /** Index against an already-opened store (used by tests / watch mode). */
  async indexWithStore(
    store: SqliteStore,
    repoPath: string,
    options: IndexOptions = {},
  ): Promise<IndexProgress> {
    return this.run(store, path.resolve(repoPath), options);
  }

  private async run(
    store: SqliteStore,
    abs: string,
    options: IndexOptions,
  ): Promise<IndexProgress> {
    const repoId = await this.registry.resolveRepoId(abs);

    // Consistency check: the stored index must have been built with the same
    // embedding dims as the embedder (else KNN distances are meaningless).
    const storedDims = store.readDims();
    if (storedDims !== 0 && storedDims !== this.embedder.dims && !options.reindex) {
      throw new ConfigError(
        `Index built with dims=${storedDims} but embedder provides dims=${this.embedder.dims}. ` +
          `Re-index with reindex:true (--rebuild) to switch embedder dimensions.`,
      );
    }

    // 1. Collect candidate files (respecting .gitignore + extra ignores).
    const files = await this.walk(abs, options.ignore ?? []);
    const total = files.length;
    this.emitProgress('walk', total, total);

    // 2. Compute file hashes; separate changed vs unchanged.
    const limit = pLimit(this.concurrency);
    const fileHashes = new Map<string, string>();
    let done = 0;
    await Promise.all(
      files.map((file) =>
        limit(async () => {
          const full = path.join(abs, file);
          const hash = await this.hashFile(full);
          fileHashes.set(file, hash);
          done++;
          this.emitProgress('walk', done, total, file);
        }),
      ),
    );

    // Determine changed / removed files by comparing to the manifest.
    const changed: string[] = [];
    for (const [file, hash] of fileHashes) {
      const prev = store.getManifest(repoId, file);
      if (prev !== hash) changed.push(file);
    }
    const manifestFiles = this.manifestFiles(store, repoId);
    const removed = manifestFiles.filter((f) => !fileHashes.has(f));

    // If nothing changed and nothing removed, we're done (fast path).
    if (changed.length === 0 && removed.length === 0) {
      this.log.info(`no changes for ${repoId}; nothing to index`);
      const p: IndexProgress = { phase: 'done', done: total, total };
      this.emit('progress', p);
      return p;
    }

    // 3. Process changed files.
    let processed = 0;
    const seenLangs = new Set<LanguageId>();
    const processLimit = pLimit(this.concurrency);
    await Promise.all(
      changed.map((file) =>
        processLimit(async () => {
          const lang = languageForFile(file);
          if (lang) seenLangs.add(lang);
          await this.processFile(store, abs, repoId, file, options);
          processed++;
          this.emitProgress('store', processed, changed.length, file);
        }),
      ),
    );

    // 4. Remove deleted files' chunks.
    for (const file of removed) {
      store.deleteChunksForFile(repoId, file);
      store.setManifest(repoId, file, ''); // clear (empty hash marks removal)
    }

    // Persist manifest hashes for all current files.
    for (const [file, hash] of fileHashes) {
      if (hash.length) store.setManifest(repoId, file, hash);
    }

    // Record the languages actually indexed into the workspace ledger.
    if (seenLangs.size > 0) {
      this.registry.recordLanguages(abs, repoId, [...seenLangs]);
    }

    const finalProgress: IndexProgress = { phase: 'done', done: total, total };
    this.emit('progress', finalProgress);
    return finalProgress;
  }

  private manifestFiles(store: SqliteStore, repoId: string): string[] {
    return store.allManifestFiles(repoId);
  }

  private async processFile(
    store: SqliteStore,
    abs: string,
    repoId: string,
    file: string,
    options: IndexOptions,
  ): Promise<void> {
    const full = path.join(abs, file);
    let content: string;
    try {
      content = await readFile(full, 'utf8');
    } catch (cause) {
      this.log.warn(`skip unreadable file ${file}: ${(cause as Error).message}`);
      return;
    }

    let chunks: RepoChunk[];
    const lang = languageForFile(file);
    if (lang && this.parser.supportsFile(file)) {
      let tree;
      try {
        tree = await this.parser.parse(file, content);
      } catch (cause) {
        if (cause instanceof ParseError) {
          this.log.warn(`parse failed for ${file}, falling back to windowed chunking`);
        } else {
          throw cause;
        }
      }
      const opts: ChunkerOptions = { repoId, file, maxTokens: DEFAULT_MAX_TOKENS };
      chunks = tree ? chunkTree(tree, content, opts) : chunkWindowed(content, opts);
    } else {
      chunks = chunkWindowed(content, { repoId, file, maxTokens: DEFAULT_MAX_TOKENS });
    }

    // Split into: unchanged (hash exists) -> metadata update; new -> embed.
    const toEmbed: { chunk: RepoChunk; index: number }[] = [];
    for (const chunk of chunks) {
      const existing = store.getByHash(repoId, chunk.contentHash);
      if (existing !== null) {
        // Moved/renamed code: refresh location, no re-embed.
        store.updateChunkMetadata(repoId, chunk.contentHash, {
          file: chunk.file,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          symbol: chunk.symbol,
        });
      } else {
        toEmbed.push({ chunk, index: toEmbed.length });
      }
    }

    if (toEmbed.length > 0) {
      const texts = toEmbed.map((e) => e.chunk.content);
      const vectors = await this.embedder.embed(texts); // embedBatch handled inside embedder
      store.upsertChunks(toEmbed.map((e, i) => ({ chunk: e.chunk, embedding: vectors[i]! })));
    }

    // Extract symbols + edges and store them for this file.
    if (lang) {
      const tree = await this.parser.parse(file, content).catch(() => null);
      if (tree) {
        const { symbols, edges } = extractSymbols(tree, repoId, file, lang as LanguageId);
        store.upsertSymbols(symbols, edges);
      }
    }
  }

  // ---- file utilities ----

  private async hashFile(full: string): Promise<string> {
    const buf = await readFile(full);
    return createHash('sha256').update(buf).digest('hex');
  }

  /** Walk `abs`, returning POSIX repo-relative file paths, honoring .gitignore. */
  private async walk(abs: string, extraIgnore: string[]): Promise<string[]> {
    const ignoreFilter = await this.buildIgnore(abs, extraIgnore);
    const entries = await fg('**/*', {
      cwd: abs,
      dot: false,
      onlyFiles: true,
      ignore: ['node_modules', '.codemap', ...extraIgnore],
      absolute: false,
      suppressErrors: true,
    });
    return entries
      .filter((f) => typeof f === 'string')
      .map((f) => f.split(path.sep).join('/'))
      .filter((f) => !ignoreFilter.ignores(f));
  }

  private async buildIgnore(abs: string, extraIgnore: string[]): Promise<Ignore> {
    const ig = createIgnore().add(extraIgnore);
    // Load a top-level .gitignore if present (fast-glob's gitignore option also
    // handles this, but we merge it explicitly for nested clarity + extra ignores).
    try {
      const gi = await readFile(path.join(abs, '.gitignore'), 'utf8');
      ig.add(gi);
    } catch {
      /* no .gitignore */
    }
    return ig;
  }
}
