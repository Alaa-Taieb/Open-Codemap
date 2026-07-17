/**
 * In-memory job tracker for the HTTP API.
 *
 * Indexing runs in the background (the endpoint returns immediately with a job
 * id); clients poll `GET /jobs/:id` for progress. Jobs never hang: a failed run
 * is recorded with `status:"failed"` + the error message. This is intentionally
 * in-memory (single-process API); a multi-worker deployment would swap this for
 * a shared store.
 */

import { randomUUID } from 'node:crypto';
import type { IndexProgress, Job } from '../types/index.js';

export class JobStore {
  private readonly jobs = new Map<string, Job>();

  create(): Job {
    const now = Date.now();
    const job: Job = {
      id: randomUUID(),
      status: 'pending',
      progress: null,
      createdAt: now,
      updatedAt: now,
    };
    this.jobs.set(job.id, job);
    return job;
  }

  get(id: string): Job | undefined {
    return this.jobs.get(id);
  }

  start(id: string): void {
    this.update(id, { status: 'running' });
  }

  progress(id: string, p: IndexProgress): void {
    this.update(id, { status: 'running', progress: p });
  }

  done(id: string, result?: unknown): void {
    this.update(id, { status: 'done', result: result ?? null });
  }

  failed(id: string, error: string): void {
    this.update(id, { status: 'failed', error });
  }

  private update(id: string, patch: Partial<Job>): void {
    const job = this.jobs.get(id);
    if (!job) return;
    Object.assign(job, patch, { updatedAt: Date.now() });
  }
}
