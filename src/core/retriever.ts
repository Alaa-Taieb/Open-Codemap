/**
 * Retriever — hybrid vector ⊕ BM25 ⊕ graph retrieval, fused with Reciprocal
 * Rank Fusion (RRF; k=60).
 *
 * `retrieve(req)`:
 *   1. Vector: embed the query, KNN over stored embeddings (cosine).
 *   2. BM25: keyword search over chunk text (exact identifiers / names win here).
 *   3. Graph (optional, `req.expandGraph`): for top vector hits, expand to
 *      their symbols' graph neighbors (imports / calls).
 *   4. Fuse all candidate sets by RRF score and truncate to `topK`.
 *
 * Consistency: `embedder.dims` MUST equal the dims the index was built with,
 * or KNN distances are meaningless. The indexer enforces this at index time;
 * library callers are reminded in the docs.
 *
 * Graceful degradation: if the embedder fails at query time we still return the
 * BM25 (+graph) results with a `lastError` warning rather than throwing (research §10.4).
 */

import type { Embedder } from './embed/index.js';
import type { Store, Bm25Hit, GraphHit } from './store/index.js';
import type { QueryRequest, QueryResult, RepoChunk, SymbolNode } from '../types/index.js';
import { createLogger, type Logger } from '../logger.js';
import { ConfigError } from '../errors.js';

/** RRF constant — higher k = flatter fusion (rank matters less). k=60 is standard. */
const RRF_K = 60;

export interface Reranker {
  rerank(results: QueryResult[], query: string): Promise<QueryResult[]>;
}

export interface RetrieverDeps {
  store: Store;
  embedder: Embedder;
  /**
   * The single workspace this retriever queries. A `Store` is scoped to one
   * workspace, so the retriever must know its `repoId` to read chunks/symbols.
   * Pass the same id the indexer used (e.g. via `WorkspaceRegistry.resolveRepoId`).
   */
  repoId: string;
  /** Optional reranker hook (shipped undefined for MVP — RRF-only). */
  reranker?: Reranker;
  logger?: Logger;
}

interface Scored {
  chunk: RepoChunk;
  score: number; // accumulated RRF sum (unchanged)
  mode: QueryResult['mode'];
  bestRrf: number; // largest single RRF contribution
  bestMode: QueryResult['mode'];
}

export class Retriever {
  private readonly store: Store;
  private readonly embedder: Embedder;
  private readonly repoId: string;
  private readonly reranker?: Reranker;
  private readonly log: Logger;

  constructor(deps: RetrieverDeps) {
    if (!deps.repoId) {
      throw new ConfigError('Retriever requires a `repoId` (the same id the indexer used).', {
        details: {
          hint: 'Obtain via WorkspaceRegistry.resolveRepoId() or repoId(repoPath).',
        },
      });
    }
    this.store = deps.store;
    this.embedder = deps.embedder;
    this.repoId = deps.repoId;
    this.reranker = deps.reranker;
    this.log = deps.logger ?? createLogger('retriever');
  }

  /** Last embedder error encountered during a graceful-degradation run (or null). */
  lastError: Error | null = null;

  async retrieve(req: QueryRequest): Promise<QueryResult[]> {
    this.lastError = null;
    const topK = req.topK ?? 10;
    // Over-fetch from each modality so fusion has enough candidates to rank well.
    const rho = 3;
    const fetchK = Math.max(topK * rho, topK + 4);

    const scored = new Map<string, Scored>();
    const bump = (chunk: RepoChunk, rrf: number, mode: QueryResult['mode']): void => {
      const key = chunk.id;
      const existing = scored.get(key);
      if (existing) {
        existing.score += rrf; // accumulate RRF across modalities (unchanged)
        const incomingRank = modeRank(mode);
        const bestRank = modeRank(existing.bestMode);
        if (rrf > existing.bestRrf || (rrf === existing.bestRrf && incomingRank > bestRank)) {
          existing.bestRrf = rrf;
          existing.bestMode = mode;
          existing.mode = mode;
        }
      } else {
        scored.set(key, { chunk, score: rrf, mode, bestRrf: rrf, bestMode: mode });
      }
    };

    // 1) BM25 — always available, no embedder needed.
    const bm25Hits = this.safeBm25(req.text, fetchK);
    this.bm25Rrf(bm25Hits, bump);

    // 2) Vector — best-effort; degrade to BM25-only on failure.
    let vectorChunks: RepoChunk[] = [];
    try {
      const vec = await this.embedder.embed([req.text]);
      const knn = this.store.knn(vec[0]!, fetchK);
      vectorChunks = this.chunksForIds(knn.map((h) => h.chunkId));
      const order = knn.map((h) => String(h.chunkId));
      this.applyRrfOrder(order, vectorChunks, 'vector', bump);
    } catch (cause) {
      const err = cause instanceof Error ? cause : new Error(String(cause));
      this.lastError = err;
      this.log.warn(
        `embedder failed during retrieve(); returning BM25/graph results: ${err.message}`,
      );
    }

    // 3) Graph expansion (optional) — neighbors of top vector hits' symbols.
    if (req.expandGraph && vectorChunks.length > 0) {
      const neighborChunks = this.expandGraph(vectorChunks);
      const order = neighborChunks.map((c) => c.id);
      this.applyRrfOrder(order, neighborChunks, 'graph', bump);
    }

    // 4) Fuse by accumulated RRF score and truncate.
    const fused = [...scored.values()].sort((a, b) => b.score - a.score).slice(0, topK);

    let results: QueryResult[] = fused.map((s) => ({
      chunk: s.chunk,
      score: s.score,
      mode: s.mode,
    }));

    // Optional reranker hook (shipped undefined for MVP).
    if (this.reranker) {
      results = await this.reranker.rerank(results, req.text);
      results = results.slice(0, topK);
    }

    // Optional language/file filter.
    if (req.filters) {
      results = results.filter((r) => {
        if (req.filters!.language && r.chunk.language !== req.filters!.language) return false;
        if (req.filters!.file && r.chunk.file !== req.filters!.file) return false;
        return true;
      });
    }

    return results;
  }

  // ---- internals ----

  private safeBm25(query: string, k: number): Bm25Hit[] {
    try {
      return this.store.bm25(query, k);
    } catch (cause) {
      this.log.warn(`bm25 failed: ${cause instanceof Error ? cause.message : String(cause)}`);
      return [];
    }
  }

  /** Map KNN/BM25 id order to chunks actually present in the store. */
  private chunksForIds(ids: number[]): RepoChunk[] {
    const all = this.store.allChunks(this.repoId);
    const byRow = new Map<number, RepoChunk>();
    for (const c of all) byRow.set(Number(c.id), c);
    return ids.map((id) => byRow.get(id)).filter((c): c is RepoChunk => c !== undefined);
  }

  private expandGraph(vectorChunks: RepoChunk[]): RepoChunk[] {
    const symbols = this.store.allSymbols(this.repoId);
    const symbolByFileAndName = new Map<string, SymbolNode>();
    for (const s of symbols) symbolByFileAndName.set(`${s.file}#${s.name}`, s);

    const neighborIds = new Set<string>();
    for (const chunk of vectorChunks) {
      // The chunk's symbol (if any) is the anchor for graph neighbors.
      if (!chunk.symbol) continue;
      const sym = symbolByFileAndName.get(`${chunk.file}#${chunk.symbol}`);
      if (!sym) continue;
      const hits: GraphHit[] = this.store.graphNeighbors(sym.id);
      for (const h of hits) neighborIds.add(h.neighborId);
    }

    if (neighborIds.size === 0) return [];
    const all = this.store.allChunks(this.repoId);
    const byId = new Map<string, RepoChunk>();
    for (const c of all) byId.set(c.id, c);
    const out: RepoChunk[] = [];
    for (const nid of neighborIds) {
      const c = byId.get(nid);
      if (c) out.push(c);
    }
    return out;
  }

  /** Apply RRF: score += 1/(k + rank) for a ranked id list. */
  private applyRrfOrder(
    order: string[],
    chunks: RepoChunk[],
    mode: QueryResult['mode'],
    bump: (c: RepoChunk, s: number, m: QueryResult['mode']) => void,
  ): void {
    order.forEach((id, idx) => {
      const chunk = chunks.find((c) => c.id === id);
      if (!chunk) return;
      const rrf = 1 / (RRF_K + idx + 1);
      bump(chunk, rrf, mode);
    });
  }

  /** Apply RRF for BM25 hits (ids are rowids, resolved against the store). */
  private bm25Rrf(
    hits: Bm25Hit[],
    bump: (c: RepoChunk, s: number, m: QueryResult['mode']) => void,
  ): void {
    const all = this.store.allChunks(this.repoId);
    const byId = new Map<number, RepoChunk>();
    for (const c of all) byId.set(Number(c.id), c);
    hits.forEach((h, idx) => {
      const chunk = byId.get(h.chunkId);
      if (!chunk) return;
      const rrf = 1 / (RRF_K + idx + 1);
      bump(chunk, rrf, 'bm25');
    });
  }
}

/**
 * Tie-breaker rank for choosing the displayed `mode` when two modalities contribute
 * an equal RRF term to the same chunk. We prefer the more *specific* textual signal:
 * BM25 (exact identifier/keyword match) > vector (semantic) > graph (structural).
 * So on an RRF tie, an exact-identifier query surfaces as `bm25`, while a purely
 * semantic match (no BM25 contribution) surfaces as `vector`.
 */
function modeRank(m: QueryResult['mode']): number {
  switch (m) {
    case 'bm25':
      return 3;
    case 'vector':
      return 2;
    case 'graph':
      return 1;
    case 'rrf':
      return 0;
  }
}
