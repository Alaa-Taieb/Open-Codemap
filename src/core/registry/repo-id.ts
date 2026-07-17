/**
 * Repository identity.
 *
 * A `repo_id` is a stable SHA-256 derived from the normalized absolute path,
 * optionally salted with the git remote URL. The same path (and remote) always
 * yields the same id, so indexes are reproducible and never duplicated.
 */

import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const execFileAsync = promisify(execFile);

/** Normalize an absolute path to POSIX style (`/` separators), resolving `..` etc. */
export function normalizeRepoPath(absPath: string): string {
  return path.resolve(absPath).replace(/\\/g, '/');
}

/** Best-effort git remote detection; never throws (returns null for non-repos). */
export async function detectGitRemote(repoPath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['config', '--get', 'remote.origin.url'], {
      cwd: repoPath,
      windowsHide: true,
      timeout: 3000,
    });
    const url = stdout.trim();
    return url.length ? url : null;
  } catch {
    return null;
  }
}

/**
 * Compute the stable `repo_id` for a path.
 * @param absPath   absolute or resolvable repo path
 * @param gitRemote explicit remote to salt with; `undefined` = auto-detect,
 *                  `null` = force path-only (ignore git).
 */
export async function repoId(absPath: string, gitRemote?: string | null): Promise<string> {
  const resolved = normalizeRepoPath(absPath);
  const remote = gitRemote !== undefined ? gitRemote : await detectGitRemote(absPath);
  const seed = remote ? `${resolved}\n${remote}` : resolved;
  return createHash('sha256').update(seed).digest('hex');
}
