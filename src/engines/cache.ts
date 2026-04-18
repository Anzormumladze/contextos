import { createHash } from 'node:crypto';
import type { AnalysisContext, AnalysisResult } from '../types/index.js';

/**
 * Trivial in-memory LRU keyed by a hash of (diff + config). Bounded by
 * `RiskConfig.limits.cacheSize`. Per-process only; does not persist.
 */
export class AnalysisCache {
  private readonly store = new Map<string, AnalysisResult>();

  constructor(private readonly maxEntries: number) {}

  private touch(key: string, val: AnalysisResult): void {
    this.store.delete(key);
    this.store.set(key, val);
    while (this.store.size > this.maxEntries) {
      const oldest = this.store.keys().next().value;
      if (oldest === undefined) break;
      this.store.delete(oldest);
    }
  }

  key(ctx: AnalysisContext): string {
    const diff = ctx.changedFiles.map((f) => `${f.status}:${f.path}:${f.totalAdded}:${f.totalRemoved}:${f.hunks.map((h) => h.contextText).join('\n')}`).join('\n---\n');
    const cfg = JSON.stringify({
      w: ctx.config.weights, t: ctx.config.decisionThresholds, m: ctx.config.minimumCoverage,
      b: ctx.config.blockedCategories, c: ctx.config.criticalPaths, s: ctx.config.strictAreas,
      i: ctx.config.ignoredPaths, r: ctx.config.customRules, l: ctx.config.limits,
    });
    const cov = ctx.coverage.source + ':' + JSON.stringify(ctx.coverage.totals);
    return createHash('sha256').update(diff).update(cfg).update(cov).digest('hex');
  }

  get(key: string): AnalysisResult | undefined {
    const hit = this.store.get(key);
    if (hit) this.touch(key, hit);
    return hit;
  }

  set(key: string, val: AnalysisResult): void {
    this.touch(key, val);
  }

  clear(): void { this.store.clear(); }
  size(): number { return this.store.size; }
}

let singleton: AnalysisCache | null = null;
export function getCache(maxEntries: number): AnalysisCache {
  if (!singleton || singleton['maxEntries'] !== maxEntries) {
    singleton = new AnalysisCache(maxEntries);
  }
  return singleton;
}
