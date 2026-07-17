/**
 * `POST /index` — kick off a background indexing job and return its id.
 *
 * The work runs asynchronously; clients poll `GET /jobs/:id` for progress.
 */

import type { FastifyInstance } from 'fastify';
import type { Indexer } from '../../core/indexer.js';
import type { WorkspaceRegistry } from '../../core/registry/index.js';
import type { JobStore } from '../jobs.js';
import { indexRequestSchema } from '../../schemas/index.js';
import { CodemapError } from '../../errors.js';

export function registerIndexRoute(
  app: FastifyInstance,
  deps: { indexer: Indexer; registry: WorkspaceRegistry; jobs: JobStore },
): void {
  const { indexer, jobs } = deps;

  app.post('/index', async (request, reply) => {
    const parsed = indexRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_request', details: parsed.error.issues });
    }
    const { repo, reindex, watch, ignore } = parsed.data;

    const job = jobs.create();
    // Run in the background — do not await.
    void (async () => {
      try {
        jobs.start(job.id);
        // Attach a progress listener for polling. The core Indexer is an EventEmitter.
        indexer.on('progress', (p: import('../../types/index.js').IndexProgress) => {
          jobs.progress(job.id, p);
        });
        const final = await indexer.index(repo, { reindex, watch, ignore });
        jobs.done(job.id, final);
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        jobs.failed(job.id, message);
        if (!(cause instanceof CodemapError)) {
          request.log.error(cause, 'index job failed');
        }
      }
    })();

    return reply.code(202).send({ jobId: job.id });
  });
}
