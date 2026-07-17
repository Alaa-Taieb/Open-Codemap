/**
 * Command registration barrel. Each `registerX` wires one sub-command onto the
 * commander program. Keeping them separate keeps the CLI a thin adapter.
 */

import type { Command } from 'commander';
import { registerIndex } from './index-command.js';
import { registerQuery } from './query.js';
import { registerList } from './list.js';
import { registerServe } from './serve.js';

/** Register every CLI sub-command onto `program`. */
export function registerCommands(program: Command): void {
  registerIndex(program);
  registerQuery(program);
  registerList(program);
  registerServe(program);
}
