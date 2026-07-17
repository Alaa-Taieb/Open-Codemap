/**
 * Workspace registry — multi-repo index management.
 *
 * Each indexed repo gets a `.codemap/<repo_id>.sqlite` file plus a
 * `.codemap/registry.json` ledger mapping `repo_id -> { dbPath, languageSet, meta }`.
 * `open()` returns a `SqliteStore` already opened + initialized to the embedder's
 * `dims`. Re-opening the same repo reuses the existing DB; switching embedder
 * dimensions requires `reindex` (the `--rebuild` escape hatch).
 */

import fs from 'node:fs';
import path from 'node:path';
import { repoId } from './repo-id.js';
import { SqliteStore } from '../store/sqlite.js';
import { ConfigError } from '../../errors.js';
import { createLogger } from '../../logger.js';
import type { LanguageId } from '../../types/index.js';

const log = createLogger('registry');

export interface WorkspaceEntry {
  repoId: string;
  repoPath: string;
  dbPath: string;
  /** Embedding dimensionality the index was built with. */
  dims: number;
  languageSet: LanguageId[];
  createdAt: number;
  updatedAt: number;
}

export interface OpenOptions {
  /** Embedding dimensionality the index must be built with. */
  dims: number;
  /** Drop + recreate the existing index (needed when switching embedder dims). */
  reindex?: boolean;
  /** Languages indexed into this workspace (recorded in the ledger). */
  languageSet?: LanguageId[];
}

function codemapDir(repoPath: string): string {
  return path.join(repoPath, '.codemap');
}

function registryPath(repoPath: string): string {
  return path.join(codemapDir(repoPath), 'registry.json');
}

export class WorkspaceRegistry {
  /** Resolve the `repo_id` for a path (auto-detects or ignores git per call). */
  async resolveRepoId(repoPath: string): Promise<string> {
    return repoId(repoPath);
  }

  private readRegistry(repoPath: string): Record<string, WorkspaceEntry> {
    const p = registryPath(repoPath);
    if (!fs.existsSync(p)) return {};
    try {
      return JSON.parse(fs.readFileSync(p, 'utf8')) as Record<string, WorkspaceEntry>;
    } catch {
      return {};
    }
  }

  private writeRegistry(repoPath: string, entries: Record<string, WorkspaceEntry>): void {
    const dir = codemapDir(repoPath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(registryPath(repoPath), JSON.stringify(entries, null, 2));
  }

  /** Open (or create) the workspace store for `repoPath`, initialized to `dims`. */
  async open(repoPath: string, opts: OpenOptions): Promise<SqliteStore> {
    const abs = path.resolve(repoPath);
    const id = await repoId(abs);
    const dir = codemapDir(abs);
    fs.mkdirSync(dir, { recursive: true });
    const dbPath = path.join(dir, `${id}.sqlite`);

    if (opts.reindex && fs.existsSync(dbPath)) {
      fs.rmSync(dbPath);
      log.info(`rebuild requested: removed existing index at ${dbPath}`);
    }

    const store = new SqliteStore(dbPath);
    await store.open();

    const storedDims = store.readDims();
    if (storedDims !== 0 && storedDims !== opts.dims) {
      store.close();
      throw new ConfigError(
        `Workspace ${id} was built with dims=${storedDims} but embedder provides dims=${opts.dims}. ` +
          `Re-open with reindex:true (e.g. --rebuild) to switch embedder dimensions.`,
      );
    }
    if (storedDims === 0) store.init(opts.dims);

    // Persist / refresh the ledger entry.
    const entries = this.readRegistry(abs);
    const now = Date.now();
    const existing = entries[id];
    entries[id] = {
      repoId: id,
      repoPath: abs,
      dbPath,
      dims: opts.dims,
      languageSet: opts.languageSet ?? existing?.languageSet ?? [],
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.writeRegistry(abs, entries);
    log.info(`opened workspace ${id} (dims=${opts.dims}) at ${dbPath}`);
    return store;
  }

  /** Enumerate workspaces recorded in a repo's `.codemap/registry.json`. */
  list(repoPath: string): WorkspaceEntry[] {
    return Object.values(this.readRegistry(path.resolve(repoPath)));
  }

  /** Merge additional indexed languages into a workspace's ledger entry. */
  recordLanguages(repoPath: string, id: string, langs: LanguageId[]): void {
    const entries = this.readRegistry(path.resolve(repoPath));
    const existing = entries[id];
    if (!existing) return;
    const merged = new Set<LanguageId>(existing.languageSet);
    for (const l of langs) merged.add(l);
    existing.languageSet = [...merged];
    existing.updatedAt = Date.now();
    this.writeRegistry(path.resolve(repoPath), entries);
  }

  /** Resolve the DB path for a previously-opened workspace (without opening it). */
  dbPathFor(repoPath: string, id: string): string | null {
    return this.readRegistry(path.resolve(repoPath))[id]?.dbPath ?? null;
  }
}

/** Shared singleton registry. */
export const registry = new WorkspaceRegistry();
