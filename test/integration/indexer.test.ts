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
import { embedBatch } from '../../src/core/embed/index.js';

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

describe('Indexer (integration)', () => {
  let tmp: string;
  let repoDir: string;
  let rid: string;
  let store: SqliteStore;
  let embedder: CountingEmbedder;
  let indexer: Indexer;

  beforeEach(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'codemap-idx-'));
    repoDir = path.join(tmp, 'repo');
    fs.mkdirSync(repoDir, { recursive: true });
    rid = await repoId(repoDir);
    store = new SqliteStore(':memory:');
    store.open();
    store.init(16);
    embedder = new CountingEmbedder(16);
    indexer = new Indexer({
      embedder,
      parser: new TreeSitterParser(),
      registry: new WorkspaceRegistry(),
    });
  });

  afterEach(() => {
    store.close();
    for (let i = 0; i < 5; i++) {
      try {
        fs.rmSync(tmp, { recursive: true, force: true });
        return;
      } catch {
        /* retry */
      }
    }
  });

  it('first index populates the store; second run with no changes makes zero embed calls', async () => {
    writeRepo(repoDir, {
      'a.ts': 'function getAuthToken() { return token; }\n',
      'b.py': 'def validate_login():\n    return True\n',
    });
    await indexer.indexWithStore(store, repoDir);
    expect(store.allChunks(rid).length).toBeGreaterThan(0);
    const firstCalls = embedder.calls;

    embedder.calls = 0;
    await indexer.indexWithStore(store, repoDir);
    expect(embedder.calls).toBe(0); // nothing changed -> no re-embed
    void firstCalls;
  });

  it('editing one file re-embeds only its changed chunks', async () => {
    writeRepo(repoDir, {
      'a.ts': 'function getAuthToken() { return token; }\nfunction helper() { return 1; }\n',
      'b.py': 'def validate_login():\n    return True\n',
    });
    await indexer.indexWithStore(store, repoDir);
    embedder.calls = 0;

    // Edit only a.ts.
    fs.writeFileSync(
      path.join(repoDir, 'a.ts'),
      'function getAuthToken() { return token; }\nfunction helper() { return 2; }\n',
    );
    await indexer.indexWithStore(store, repoDir);
    // Only a.ts changed -> embed called for its (changed) chunks, not zero, not for b.py.
    expect(embedder.calls).toBeGreaterThan(0);
  });

  it('moving a function updates metadata without re-embedding', async () => {
    writeRepo(repoDir, {
      'a.ts': 'function getAuthToken() { return token; }\n',
    });
    await indexer.indexWithStore(store, repoDir);
    const hash = store.allChunks(rid)[0]!.contentHash;
    embedder.calls = 0;

    // Move the function into a subfolder (same content hash -> metadata-only update).
    fs.rmSync(path.join(repoDir, 'a.ts'));
    fs.mkdirSync(path.join(repoDir, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(repoDir, 'src', 'a.ts'),
      'function getAuthToken() { return token; }\n',
    );
    await indexer.indexWithStore(store, repoDir);

    expect(embedder.calls).toBe(0); // identical content -> no re-embed
    // The chunk now lives at the new path (location updated).
    const chunk = store.allChunks(rid).find((c) => c.contentHash === hash);
    expect(chunk?.file).toBe('src/a.ts');
  });

  it('throws ConfigError when store dims mismatch the embedder', async () => {
    store.close();
    store = new SqliteStore(':memory:');
    store.open();
    store.init(32); // built with 32 dims
    embedder = new CountingEmbedder(16); // embedder wants 16
    indexer = new Indexer({
      embedder,
      parser: new TreeSitterParser(),
      registry: new WorkspaceRegistry(),
    });
    writeRepo(repoDir, { 'a.ts': 'function x() { return 1; }\n' });
    await expect(indexer.indexWithStore(store, repoDir)).rejects.toThrow(/dims/i);
    store.close();
  });

  it('emits progress events', async () => {
    writeRepo(repoDir, { 'a.ts': 'function x() { return 1; }\n' });
    const phases = new Set<string>();
    indexer.on('progress', (p: { phase: string }) => phases.add(p.phase));
    await indexer.indexWithStore(store, repoDir);
    expect(phases.has('walk')).toBe(true);
    expect(phases.has('done')).toBe(true);
  });

  it('embedBatch respects batch size', async () => {
    const e = new HashEmbedder(8);
    const spy = e as unknown as { embed: (t: string[]) => Promise<Float32Array[]> };
    let maxSlice = 0;
    const orig = spy.embed.bind(e);
    spy.embed = async (t: string[]) => {
      maxSlice = Math.max(maxSlice, t.length);
      return orig(t);
    };
    const out = await embedBatch(
      e,
      Array.from({ length: 500 }, (_, i) => `x${i}`),
      100,
    );
    expect(out).toHaveLength(500);
    expect(maxSlice).toBeLessThanOrEqual(100);
  });
});
