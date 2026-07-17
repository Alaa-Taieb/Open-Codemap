/**
 * Debounced incremental file watching.
 *
 * Wraps `chokidar` to keep an index live as the repo changes. Editor "save
 * storms" (many rapid write/change events for one logical edit) are coalesced
 * by a debounce timer so the indexer only runs once per burst. Paths are
 * normalized to POSIX (`/` separators) before reaching the indexer — this is
 * required on Windows where chokidar reports `\` separators.
 *
 * On watch start we also perform a full initial index (chokidar may miss
 * events that occurred between the walk and the watcher attaching), and a
 * trailing debounced run guarantees no event was dropped.
 */

import chokidar, { type FSWatcher } from 'chokidar';
import path from 'node:path';
import type { Indexer } from './indexer.js';
import type { IndexOptions, IndexProgress } from '../types/index.js';
import { createLogger } from '../logger.js';

const log = createLogger('watch');

export interface WatchOptions {
  /** Debounce window in ms (default 300). Bursts are coalesced into one re-index. */
  debounceMs?: number;
  /** Extra glob patterns to ignore (forwarded to the indexer + chokidar). */
  ignore?: string[];
  /** Drop + rebuild before watching. */
  reindex?: boolean;
  /**
   * Optional callback invoked after each (re)index run with its progress.
   * The final progress is also returned by `startWatch`.
   */
  onProgress?: (progress: IndexProgress) => void;
}

export interface WatchHandle {
  /** The underlying chokidar watcher (so callers may inspect/stop it). */
  watcher: FSWatcher;
  /** The latest completed progress snapshot (or null before the first run). */
  lastProgress: IndexProgress | null;
  /** Stop watching and release the watcher. */
  close(): Promise<void>;
}

const DEFAULT_IGNORE = ['node_modules', '.git', '.codemap', 'dist', 'build'];

/**
 * Start watching `repoPath` and keep its index incrementally up to date.
 *
 * Returns a handle whose `lastProgress` reflects the most recent index run.
 * The promise resolves after the initial index has completed.
 */
export async function startWatch(
  repoPath: string,
  indexer: Indexer,
  options: WatchOptions = {},
): Promise<WatchHandle> {
  const abs = path.resolve(repoPath);
  const debounceMs = options.debounceMs ?? 300;
  const ignore = [...DEFAULT_IGNORE, ...(options.ignore ?? [])];
  const indexOptions: IndexOptions = { ignore, reindex: options.reindex };

  let lastProgress: IndexProgress | null = null;
  let timer: NodeJS.Timeout | null = null;
  let running = false;

  const runIndex = async (reason: string): Promise<void> => {
    if (running) return;
    running = true;
    try {
      log.info(`re-indexing (${reason}) for ${abs}`);
      const progress = await indexer.index(abs, indexOptions);
      lastProgress = progress;
      options.onProgress?.(progress);
    } catch (err) {
      log.error(`watch re-index failed: ${(err as Error).message}`);
    } finally {
      running = false;
    }
  };

  const scheduleRun = (reason: string): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void runIndex(reason);
    }, debounceMs);
  };

  // Watch source files (respecting ignore globs). chokidar normalizes paths
  // for us on non-Windows, but we still normalize explicitly below for safety.
  const watcher = chokidar.watch(abs, {
    ignored: ignore,
    ignoreInitial: true,
    persistent: true,
    awaitWriteFinish: { stabilityThreshold: 50, pollInterval: 10 },
  });

  const onChange = (raw: string): void => {
    const p = raw.split(path.sep).join('/');
    if (ignore.some((g) => p.includes(g))) return;
    scheduleRun('change');
  };

  watcher
    .on('add', (p) => onChange(p))
    .on('change', (p) => onChange(p))
    .on('unlink', (p) => onChange(p))
    .on('error', (err: unknown) =>
      log.warn(`watch error: ${err instanceof Error ? err.message : String(err)}`),
    );

  // Initial index (full), then arm a trailing run so no event dropped during setup.
  await runIndex('initial');
  scheduleRun('trailing');

  const handle: WatchHandle = {
    watcher,
    get lastProgress() {
      return lastProgress;
    },
    set lastProgress(v: IndexProgress | null) {
      lastProgress = v;
    },
    async close() {
      if (timer) clearTimeout(timer);
      await watcher.close();
    },
  };
  return handle;
}
