/**
 * `open-codemap index <repo>` — build (or update) a workspace index.
 *
 * Thin adapter: parses flags through the shared schemas, builds the core
 * `Indexer`, runs it, and renders progress with `ora`. No indexing logic here.
 */

import path from 'node:path';
import { Command } from 'commander';
import ora from 'ora';
import { Indexer } from '../../core/indexer.js';
import { TreeSitterParser } from '../../core/parser/index.js';
import { WorkspaceRegistry } from '../../core/registry/index.js';
import { startWatch } from '../../core/watch.js';
import type { IndexOptions, IndexProgress } from '../../types/index.js';
import { buildEmbedder } from '../embedder-factory.js';
import { configSchema, indexOptionsSchema } from '../../schemas/index.js';
import { renderError } from '../error.js';

export function registerIndex(cmd: Command): void {
  cmd
    .command('index <repo>')
    .description('Build or update a code index for <repo>')
    .option('--embedder <kind>', 'embedder backend: mock | voyage | jina', 'mock')
    .option('--model <name>', 'model name override (voyage/jina)')
    .option('--rebuild', 'drop and recreate the index (required when switching embedder dims)')
    .option('--watch', 'stay alive and re-index on file changes')
    .option('--ignore <globs...>', 'extra glob patterns to ignore')
    .action(async (repo: string, opts: Record<string, unknown>) => {
      try {
        const cfg = configSchema.parse({
          embedder: opts.embedder,
          model: opts.model,
        });
        const idxOpts = indexOptionsSchema.parse({
          reindex: Boolean(opts.rebuild),
          watch: Boolean(opts.watch),
          ignore: opts.ignore,
        }) as IndexOptions;

        const embedder = buildEmbedder({ kind: cfg.embedder, model: cfg.model });
        const indexer = new Indexer({
          embedder,
          parser: new TreeSitterParser(),
          registry: new WorkspaceRegistry(),
        });

        const abs = path.resolve(repo);
        const spinner = ora('Indexing…').start();

        let lastPhase = '';
        indexer.on('progress', (p: IndexProgress) => {
          if (p.phase !== lastPhase) {
            lastPhase = p.phase;
          }
          const label = p.file ? `${p.phase}: ${p.file}` : p.phase;
          spinner.text = `${label} (${p.done}/${p.total})`;
        });

        const final = await indexer.index(abs, idxOpts);
        spinner.succeed(`Indexed ${repo} — ${final.total} files processed.`);

        if (idxOpts.watch) {
          await startWatch(abs, indexer, { ignore: idxOpts.ignore });
        }
      } catch (cause) {
        renderError(cause);
        process.exitCode = 1;
      }
    });
}
