/**
 * `open-codemap serve <repo>` — start the HTTP API for a repo.
 *
 * Thin adapter: builds the core instances and hands them to the Fastify app from
 * `../api`. All server logic lives in the API module; this command only wires it.
 */

import path from 'node:path';
import { Command } from 'commander';
import { Indexer } from '../../core/indexer.js';
import { TreeSitterParser } from '../../core/parser/index.js';
import { WorkspaceRegistry } from '../../core/registry/index.js';
import { buildEmbedder } from '../embedder-factory.js';
import { configSchema } from '../../schemas/index.js';
import { renderError } from '../error.js';
import { createApp } from '../../api/index.js';

export function registerServe(cmd: Command): void {
  cmd
    .command('serve <repo>')
    .description('Start the HTTP API for <repo>')
    .option('--port <n>', 'port to listen on', '8787')
    .option('--host <h>', 'host to bind', '127.0.0.1')
    .option(
      '--embedder <kind>',
      'embedder backend used to build the index: mock | voyage | jina',
      'mock',
    )
    .option('--model <name>', 'model name override (voyage/jina)')
    .action(async (repo: string, opts: Record<string, unknown>) => {
      try {
        const cfg = configSchema.parse({ embedder: opts.embedder, model: opts.model });
        const abs = path.resolve(repo);
        const embedder = buildEmbedder({ kind: cfg.embedder, model: cfg.model });
        const registry = new WorkspaceRegistry();
        const indexer = new Indexer({
          embedder,
          parser: new TreeSitterParser(),
          registry,
        });

        const app = createApp({ indexer, registry, embedder });
        const port = Number(opts.port);
        const host = String(opts.host);
        await app.listen({ port, host });
        process.stdout.write(
          `Open-Codemap API listening on http://${host}:${port} (repo: ${abs})\n`,
        );
      } catch (cause) {
        renderError(cause);
        process.exitCode = 1;
      }
    });
}
