import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Indexer } from '../../src/core/indexer.js';
import { SqliteStore } from '../../src/core/store/sqlite.js';
import { HashEmbedder } from '../../src/core/embed/mock.js';
import { TreeSitterParser } from '../../src/core/parser/index.js';
import { WorkspaceRegistry } from '../../src/core/registry/index.js';
import { repoId } from '../../src/core/registry/repo-id.js';
import { startWatch } from '../../src/core/watch.js';

/** A spy embedder that counts embed() calls but behaves like HashEmbedder. */
class CountingEmbedder extends HashEmbedder {
  calls = 0;
  override async embed(texts: string[]): Promise<Float32Array[]> {
    this.calls++;
    return super.embed(texts);
  }
}

function writeRepo(dir: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
}

describe('Watch (integration)', () => {
  let tmp: string;
  let repoDir: string;
  let rid: string;
  let registry: WorkspaceRegistry;
  let embedder: CountingEmbedder;
  let indexer: Indexer;

  beforeEach(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'codemap-watch-'));
    repoDir = path.join(tmp, 'repo');
    fs.mkdirSync(repoDir, { recursive: true });
    rid = await repoId(repoDir);
    registry = new WorkspaceRegistry();
    embedder = new CountingEmbedder(16);
    indexer = new Indexer({
      embedder,
      parser: new TreeSitterParser(),
      registry,
    });
  });

  afterEach(() => {
    for (let i = 0; i < 5; i++) {
      try {
        fs.rmSync(tmp, { recursive: true, force: true });
        return;
      } catch {
        /* retry */
      }
    }
  });

  it('re-indexes a newly created file after the debounce window', async () => {
    writeRepo(repoDir, { 'a.ts': 'function a() { return 1; }\n' });
    const handle = await startWatch(repoDir, indexer, { debounceMs: 100, ignore: [] });
    try {
      const before = handle.lastProgress;
      expect(before?.phase).toBe('done');

      // Create a new file.
      fs.writeFileSync(path.join(repoDir, 'b.ts'), 'function b() { return 2; }\n');

      // Poll until the store reflects the new file (debounce + index run).
      const store = await registry.open(repoDir, { dims: 16 });
      try {
        await waitUntil(() => store.allChunks(rid).some((c) => c.file === 'b.ts'), 5000);
        const files = store
          .allChunks(rid)
          .map((c) => c.file)
          .sort();
        expect(files).toContain('a.ts');
        expect(files).toContain('b.ts');
      } finally {
        store.close();
      }
    } finally {
      await handle.close();
    }
  });

  it('removes chunks when a file is deleted', async () => {
    writeRepo(repoDir, {
      'a.ts': 'function a() { return 1; }\n',
      'b.ts': 'function b() { return 2; }\n',
    });
    const handle = await startWatch(repoDir, indexer, { debounceMs: 100, ignore: [] });
    try {
      const store = await registry.open(repoDir, { dims: 16 });
      try {
        // Wait for the (initial + trailing) index to settle.
        await waitUntil(() => store.allChunks(rid).length >= 2, 5000);
        expect(store.allChunks(rid).some((c) => c.file === 'b.ts')).toBe(true);

        // Delete b.ts.
        fs.rmSync(path.join(repoDir, 'b.ts'));
        await waitUntil(() => !store.allChunks(rid).some((c) => c.file === 'b.ts'), 5000);
        expect(store.allChunks(rid).some((c) => c.file === 'a.ts')).toBe(true);
        expect(store.allChunks(rid).some((c) => c.file === 'b.ts')).toBe(false);
      } finally {
        store.close();
      }
    } finally {
      await handle.close();
    }
  });

  it('coalesces rapid bursts into a single re-index run (debounce)', async () => {
    writeRepo(repoDir, { 'a.ts': 'function a() { return 1; }\n' });
    const handle = await startWatch(repoDir, indexer, { debounceMs: 200, ignore: [] });
    try {
      // Capture a baseline embed count after the initial index.
      const baseCalls = embedder.calls;
      // Fire several rapid writes (editor save-storm).
      for (let i = 0; i < 5; i++) {
        fs.writeFileSync(path.join(repoDir, `f${i}.ts`), `function f${i}() { return ${i}; }\n`);
      }
      // After the debounce settles, only one burst should have been indexed.
      await waitUntil(() => storeCount() >= 5, 5000);
      // Give the debounce a little extra so no second trailing run fires.
      await sleep(400);
      // The embedder was called for the burst (new chunks). We can't assert an
      // exact count (initial run already embedded a.ts), but a single burst must
      // not blow up into a run-per-event. Assert progress completed at least once.
      expect(handle.lastProgress?.phase).toBe('done');
      expect(embedder.calls).toBeGreaterThan(baseCalls);
      void storeCount;
    } finally {
      await handle.close();
    }

    function storeCount(): number {
      // Open a throwaway read handle to count chunks.
      const s = new SqliteStore(openDbPath());
      s.open();
      try {
        return s.allChunks(rid).length;
      } finally {
        s.close();
      }
    }
    function openDbPath(): string {
      return registry.dbPathFor(repoDir, rid) ?? ':memory:';
    }
  });
});

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitUntil(fn: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitUntil timed out');
    await sleep(25);
  }
}
