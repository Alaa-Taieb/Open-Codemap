/**
 * Fastify API — thin HTTP adapter over the core engine.
 *
 * Routes:
 *   POST /index        -> background job, returns { jobId }
 *   GET  /jobs/:id     -> poll job status/progress
 *   POST /query        -> synchronous hybrid retrieval
 *   GET  /workspaces   -> list workspaces for a repo
 *
 * All inputs are validated through the shared zod schemas so the CLI and API
 * never diverge. Typed `CodemapError`s are mapped to a consistent JSON body.
 */

import Fastify from 'fastify';
import type { Indexer } from '../core/indexer.js';
import type { Embedder } from '../core/embed/index.js';
import type { WorkspaceRegistry } from '../core/registry/index.js';
import { CodemapError } from '../errors.js';
import { JobStore } from './jobs.js';
import { registerIndexRoute } from './routes/index.js';
import { registerJobsRoute } from './routes/jobs.js';
import { registerQueryRoute } from './routes/query.js';
import { registerWorkspacesRoute } from './routes/workspaces.js';

export interface ApiDeps {
  indexer: Indexer;
  registry: WorkspaceRegistry;
  embedder: Embedder;
  /** Inject a JobStore (mainly for tests). */
  jobs?: JobStore;
}

/** Build (but do not start) the Fastify app. */
export function createApp(deps: ApiDeps): Fastify.FastifyInstance {
  const app = Fastify({ logger: false });
  const jobs = deps.jobs ?? new JobStore();

  // Consistent error envelope for typed core errors.
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof CodemapError) {
      return reply.code(400).send({ error: error.code, message: error.message });
    }
    if ((error as { validation?: unknown }).validation) {
      return reply.code(400).send({ error: 'validation_error', message: error.message });
    }
    app.log.error(error);
    return reply.code(500).send({ error: 'internal_error', message: error.message });
  });

  registerIndexRoute(app, { indexer: deps.indexer, registry: deps.registry, jobs });
  registerJobsRoute(app, { jobs });
  registerQueryRoute(app, { registry: deps.registry, embedder: deps.embedder });
  registerWorkspacesRoute(app, { registry: deps.registry });

  return app;
}
