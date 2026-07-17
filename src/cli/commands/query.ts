/**
 * `open-codemap query <repo> "<text>"` — ask the index a question.
 *
 * Thin adapter: validates input through the shared `querySchema`, opens the
 * workspace store, builds a `Retriever`, and prints ranked chunks (table or JSON).
 */

import path from 'node:path';
import { Command } from 'commander';
import { Retriever } from '../../core/retriever.js';
import { WorkspaceRegistry } from '../../core/registry/index.js';
import type { QueryRequest } from '../../types/index.js';
import { buildEmbedder } from '../embedder-factory.js';
import { configSchema, querySchema } from '../../schemas/index.js';
import { renderError } from '../error.js';

export function registerQuery(cmd: Command): void {
  cmd
    .command('query <repo> <text>')
    .description('Query an indexed repo with a natural-language or identifier question')
    .option('--top-k <n>', 'number of results to return', '10')
    .option('--expand-graph', 'include graph neighbors of top semantic hits')
    .option('--json', 'emit raw JSON instead of a table')
    .option(
      '--embedder <kind>',
      'embedder backend used to build the index: mock | voyage | jina',
      'mock',
    )
    .option('--model <name>', 'model name override (voyage/jina)')
    .action(async (repo: string, text: string, opts: Record<string, unknown>) => {
      try {
        const cfg = configSchema.parse({ embedder: opts.embedder, model: opts.model });
        const req = querySchema.parse({
          text,
          topK: Number(opts.topK),
          expandGraph: Boolean(opts.expandGraph),
        }) as QueryRequest;

        const abs = path.resolve(repo);
        const registry = new WorkspaceRegistry();
        const rid = await registry.resolveRepoId(abs);

        // Open the existing workspace store built with the same embedder dims.
        const embedder = buildEmbedder({ kind: cfg.embedder, model: cfg.model });
        const store = await registry.open(abs, { dims: embedder.dims });

        const retriever = new Retriever({ store, embedder, repoId: rid });
        const results = await retriever.retrieve(req);
        store.close();

        if (opts.json) {
          process.stdout.write(JSON.stringify(results, null, 2) + '\n');
          return;
        }

        if (results.length === 0) {
          process.stdout.write('No matching chunks found.\n');
          return;
        }
        for (const r of results) {
          const c = r.chunk;
          process.stdout.write(
            `${r.score.toFixed(4)}  [${r.mode}]  ${c.file}:${c.startLine}-${c.endLine}` +
              (c.symbol ? `  (${c.symbol})` : '') +
              `\n  ${c.content.replace(/\n/g, '\n  ').slice(0, 200)}\n\n`,
          );
        }
      } catch (cause) {
        renderError(cause);
        process.exitCode = 1;
      }
    });
}
