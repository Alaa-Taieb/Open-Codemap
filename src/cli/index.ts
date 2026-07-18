#!/usr/bin/env node
/**
 * `open-codemap` CLI entry point.
 *
 * A thin adapter: parses global + per-command flags, validates them through the
 * shared zod schemas, builds the core `Indexer`/`Retriever`/`Store`, and renders
 * output. No business logic lives here.
 */

import { Command } from 'commander';
import { registerCommands } from './commands/registry.js';

const program = new Command();

program
  .name('open-codemap')
  .description('Local-first codebase indexer + retriever (CLI / library / API)')
  .version('0.1.1');

registerCommands(program);

program.parseAsync(process.argv).catch((cause: unknown) => {
  // renderError handles the known types; this is a last-resort guard.
  if (cause instanceof Error) {
    process.stderr.write(`Fatal: ${cause.message}\n`);
  } else {
    process.stderr.write(`Fatal: ${String(cause)}\n`);
  }
  process.exitCode = 1;
});
