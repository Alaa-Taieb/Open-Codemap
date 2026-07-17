import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { repoId, normalizeRepoPath } from '../../src/core/registry/repo-id.js';
import { WorkspaceRegistry } from '../../src/core/registry/index.js';

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'codemap-reg-'));
});
afterEach(() => {
  // Windows retains file locks on the sqlite db briefly; retry to avoid EPERM.
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
      return;
    } catch {
      // wait a tick before retrying
    }
  }
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* give up */
  }
});

describe('repoId', () => {
  it('is stable for the same path (path-only)', async () => {
    const a = await repoId(tmp, null);
    const b = await repoId(tmp, null);
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });

  it('differs when the git remote differs', async () => {
    const a = await repoId(tmp, null);
    const b = await repoId(tmp, 'https://github.com/x/y.git');
    expect(a).not.toBe(b);
  });

  it('normalizes windows backslashes', () => {
    expect(normalizeRepoPath('C:\\a\\b')).toBe('C:/a/b');
  });

  it('auto-detects git remote when none provided', async () => {
    // In a temp (non-git) dir auto-detect returns null -> path-only hash.
    const a = await repoId(tmp);
    const b = await repoId(tmp, null);
    expect(a).toBe(b);
  });
});

describe('WorkspaceRegistry', () => {
  it('opens, persists, and reuses the same store with the same dims', async () => {
    const reg = new WorkspaceRegistry();
    const s1 = await reg.open(tmp, { dims: 32 });
    expect(s1.dims).toBe(32);
    const id = await repoId(tmp, null);
    expect(fs.existsSync(path.join(tmp, '.codemap', `${id}.sqlite`))).toBe(true);
    expect(fs.existsSync(path.join(tmp, '.codemap', 'registry.json'))).toBe(true);
    await s1.close();

    const s2 = await reg.open(tmp, { dims: 32 });
    expect(s2.dims).toBe(32);
    await s2.close();
  });

  it('throws ConfigError on dims mismatch without reindex', async () => {
    const reg = new WorkspaceRegistry();
    const s1 = await reg.open(tmp, { dims: 32 });
    await s1.close();
    await expect(reg.open(tmp, { dims: 64 })).rejects.toThrow(/dims/);
  });

  it('reindex rebuilds the store with new dims', async () => {
    const reg = new WorkspaceRegistry();
    const s1 = await reg.open(tmp, { dims: 32 });
    await s1.close();
    const s2 = await reg.open(tmp, { dims: 64, reindex: true });
    expect(s2.dims).toBe(64);
    await s2.close();
  });

  it('list() enumerates recorded workspaces', async () => {
    const reg = new WorkspaceRegistry();
    const s = await reg.open(tmp, { dims: 32, languageSet: ['typescript', 'python'] });
    await s.close();
    const list = reg.list(tmp);
    expect(list).toHaveLength(1);
    expect(list[0]!.repoId).toHaveLength(64);
    expect(list[0]!.languageSet).toEqual(['typescript', 'python']);
    expect(list[0]!.dbPath).toContain('.codemap');
  });
});
