import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Indexer } from '../../src/core/indexer.js';
import { TreeSitterParser } from '../../src/core/parser/index.js';
import { WorkspaceRegistry } from '../../src/core/registry/index.js';
import { HashEmbedder } from '../../src/core/embed/mock.js';
import { createApp, type ApiDeps } from '../../src/api/index.js';
import type { FastifyInstance } from 'fastify';

function writeRepo(dir: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
}

describe('API (integration)', () => {
  let tmp: string;
  let repoDir: string;
  let app: FastifyInstance;
  let deps: ApiDeps;

  beforeEach(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'codemap-api-'));
    repoDir = path.join(tmp, 'repo');
    fs.mkdirSync(repoDir, { recursive: true });
    writeRepo(repoDir, {
      'a.ts': 'export function getAuthToken() { return token; }\n',
      'b.py': 'def validate_login():\n    return True\n',
    });

    const embedder = new HashEmbedder(16);
    deps = {
      indexer: new Indexer({
        embedder,
        parser: new TreeSitterParser(),
        registry: new WorkspaceRegistry(),
      }),
      registry: new WorkspaceRegistry(),
      embedder,
    };
    app = createApp(deps);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    for (let i = 0; i < 5; i++) {
      try {
        fs.rmSync(tmp, { recursive: true, force: true });
        return;
      } catch {
        /* retry */
      }
    }
  });

  it('POST /index returns a jobId and the job completes', async () => {
    const res = await app.inject({ method: 'POST', url: '/index', payload: { repo: repoDir } });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(typeof body.jobId).toBe('string');

    // Poll until done.
    let job: any;
    for (let i = 0; i < 50; i++) {
      const jr = await app.inject({ method: 'GET', url: `/jobs/${body.jobId}` });
      job = jr.json();
      if (job.status === 'done' || job.status === 'failed') break;
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(job.status).toBe('done');
  });

  it('GET /jobs/:id 404 for unknown id', async () => {
    const res = await app.inject({ method: 'GET', url: '/jobs/nope' });
    expect(res.statusCode).toBe(404);
  });

  it('POST /query returns ranked results after indexing', async () => {
    // Index first (synchronous via indexer directly is fine; API just needs the store).
    await deps.indexer.index(repoDir, {});

    const res = await app.inject({
      method: 'POST',
      url: '/query',
      payload: { repo: repoDir, text: 'getAuthToken', topK: 5 },
    });
    expect(res.statusCode).toBe(200);
    const results = res.json();
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].chunk.symbol).toBe('getAuthToken');
  });

  it('POST /query validates input (empty text -> 400)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/query',
      payload: { repo: repoDir, text: '' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('GET /workspaces lists indexed workspaces', async () => {
    await deps.indexer.index(repoDir, {});
    const res = await app.inject({
      method: 'GET',
      url: `/workspaces?repo=${encodeURIComponent(repoDir)}`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.workspaces)).toBe(true);
    expect(body.workspaces.length).toBeGreaterThan(0);
  });
});
