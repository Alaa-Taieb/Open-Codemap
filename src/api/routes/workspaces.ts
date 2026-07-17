/**
 * `GET /workspaces` — list workspaces recorded for a repo.
 */

import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { WorkspaceRegistry } from '../../core/registry/index.js';

export function registerWorkspacesRoute(
  app: FastifyInstance,
  deps: { registry: WorkspaceRegistry },
): void {
  const { registry } = deps;

  app.get('/workspaces', async (request) => {
    const { repo } = request.query as { repo?: string };
    if (!repo) {
      return { workspaces: [] };
    }
    const abs = path.resolve(repo);
    return { workspaces: registry.list(abs) };
  });
}
