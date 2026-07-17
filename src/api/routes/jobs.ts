/**
 * `GET /jobs/:id` — poll a background job's status + progress.
 */

import type { FastifyInstance } from 'fastify';
import type { JobStore } from '../jobs.js';

export function registerJobsRoute(app: FastifyInstance, deps: { jobs: JobStore }): void {
  const { jobs } = deps;

  app.get('/jobs/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const job = jobs.get(id);
    if (!job) {
      return reply.code(404).send({ error: 'not_found', message: `no job with id ${id}` });
    }
    return job;
  });
}
