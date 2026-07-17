/**
 * `POST /query` — synchronous hybrid retrieval over an indexed repo.
 *
 * The retriever is built per-request (cheap) from the workspace store + embedder,
 * so a single API process can serve multiple repos.
 */

import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { Embedder } from '../../core/embed/index.js';
import type { WorkspaceRegistry } from '../../core/registry/index.js';
import { Retriever } from '../../core/retriever.js';
import { queryRequestSchema } from '../../schemas/index.js';
import type { QueryRequest } from '../../types/index.js';

export function registerQueryRoute(
  app: FastifyInstance,
  deps: { registry: WorkspaceRegistry; embedder: Embedder },
): void {
  const { registry, embedder } = deps;

  app.post('/query', async (request, reply) => {
    const parsed = queryRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_request', details: parsed.error.issues });
    }
    const { repo, text, topK, filters, expandGraph } = parsed.data;

    const abs = path.resolve(repo);
    const rid = await registry.resolveRepoId(abs);
    const store = await registry.open(abs, { dims: embedder.dims });

    try {
      const retriever = new Retriever({ store, embedder, repoId: rid });
      const results = await retriever.retrieve({
        text,
        topK,
        filters,
        expandGraph,
      } as QueryRequest);
      return results;
    } finally {
      store.close();
    }
  });
}
