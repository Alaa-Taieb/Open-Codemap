/**
 * `open-codemap list <repo>` — enumerate indexed workspaces under a repo.
 *
 * Thin adapter over `WorkspaceRegistry.list`.
 */

import path from 'node:path';
import { Command } from 'commander';
import { WorkspaceRegistry } from '../../core/registry/index.js';
import { renderError } from '../error.js';

export function registerList(cmd: Command): void {
  cmd
    .command('list <repo>')
    .description('List indexed workspaces for <repo>')
    .action(async (repo: string) => {
      try {
        const abs = path.resolve(repo);
        const registry = new WorkspaceRegistry();
        const entries = registry.list(abs);
        if (entries.length === 0) {
          process.stdout.write(`No workspaces found for ${repo} (run \`index\` first).\n`);
          return;
        }
        for (const e of entries) {
          const langs = e.languageSet.length ? e.languageSet.join(',') : '(none recorded)';
          process.stdout.write(`${e.repoId}  dims=${e.dims} langs=[${langs}]  ${e.dbPath}\n`);
        }
      } catch (cause) {
        renderError(cause);
        process.exitCode = 1;
      }
    });
}
