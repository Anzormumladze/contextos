import type { RiskConfig } from './schema.js';

/** Known top-level config keys. Unknown keys become warnings (likely typos). */
const KNOWN_TOP = new Set<keyof RiskConfig>([
  'criticalPaths', 'strictAreas', 'ignoredPaths',
  'minimumCoverage', 'decisionThresholds', 'weights',
  'blockedCategories', 'coverageReportPath', 'projectRoot',
  'customRules', 'diff', 'limits',
]);

const KNOWN_CATEGORIES = new Set([
  'coverage', 'edge-case', 'regression', 'async', 'state',
  'api-contract', 'security', 'critical-path', 'custom',
]);
const KNOWN_LEVELS = new Set(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);

/**
 * Best-effort config validator. Returns a list of human-readable warnings.
 * Never throws — we want partial / typo'd configs to still load.
 */
export function validateConfig(config: unknown): string[] {
  const warnings: string[] = [];
  if (!config || typeof config !== 'object') return warnings;
  const c = config as Record<string, unknown>;

  for (const k of Object.keys(c)) {
    if (!KNOWN_TOP.has(k as keyof RiskConfig)) {
      warnings.push(`Unknown config key "${k}" — ignored. (Known keys: ${Array.from(KNOWN_TOP).join(', ')})`);
    }
  }

  const check = (ok: boolean, msg: string) => { if (!ok) warnings.push(msg); };

  if ('criticalPaths' in c) check(Array.isArray(c.criticalPaths), 'criticalPaths must be an array of glob strings');
  if ('strictAreas' in c) check(Array.isArray(c.strictAreas), 'strictAreas must be an array of glob strings');
  if ('ignoredPaths' in c) check(Array.isArray(c.ignoredPaths), 'ignoredPaths must be an array of glob strings');

  if ('decisionThresholds' in c && c.decisionThresholds && typeof c.decisionThresholds === 'object') {
    const t = c.decisionThresholds as Record<string, unknown>;
    if (typeof t.warn === 'number' && typeof t.block === 'number' && t.warn >= t.block) {
      warnings.push(`decisionThresholds.warn (${t.warn}) must be < decisionThresholds.block (${t.block}).`);
    }
  }

  if ('minimumCoverage' in c && c.minimumCoverage && typeof c.minimumCoverage === 'object') {
    const m = c.minimumCoverage as Record<string, unknown>;
    for (const k of ['lines', 'branches', 'functions', 'changedLines']) {
      if (k in m && (typeof m[k] !== 'number' || (m[k] as number) < 0 || (m[k] as number) > 100)) {
        warnings.push(`minimumCoverage.${k} must be a number in [0,100].`);
      }
    }
  }

  if ('blockedCategories' in c) {
    if (!Array.isArray(c.blockedCategories)) {
      warnings.push('blockedCategories must be an array.');
    } else {
      for (const cat of c.blockedCategories) {
        if (typeof cat !== 'string' || !KNOWN_CATEGORIES.has(cat)) {
          warnings.push(`Unknown blockedCategories entry "${String(cat)}". Valid: ${Array.from(KNOWN_CATEGORIES).join(', ')}`);
        }
      }
    }
  }

  if ('customRules' in c && Array.isArray(c.customRules)) {
    for (let i = 0; i < c.customRules.length; i += 1) {
      const r = c.customRules[i] as Record<string, unknown>;
      if (!r || typeof r !== 'object') { warnings.push(`customRules[${i}] must be an object.`); continue; }
      if (typeof r.id !== 'string') warnings.push(`customRules[${i}].id must be a string.`);
      if (typeof r.pattern !== 'string') warnings.push(`customRules[${i}].pattern must be a string.`);
      if (typeof r.level !== 'string' || !KNOWN_LEVELS.has(r.level as string)) warnings.push(`customRules[${i}].level must be LOW|MEDIUM|HIGH|CRITICAL.`);
      if (typeof r.category !== 'string' || !KNOWN_CATEGORIES.has(r.category as string)) warnings.push(`customRules[${i}].category is invalid.`);
      if (typeof r.pattern === 'string') {
        try { new RegExp(r.pattern, typeof r.flags === 'string' ? r.flags : ''); }
        catch (err) { warnings.push(`customRules[${i}].pattern is not a valid RegExp: ${(err as Error).message}`); }
        // Flag classic catastrophic-backtrack shapes.
        if (/(\([^)]*\+\)\+|\([^)]*\*\)\+|\([^)]*\+\)\*)/.test(r.pattern)) {
          warnings.push(`customRules[${i}].pattern shows a catastrophic-backtrack shape ("(x+)+" / "(x*)+"). Tighten the regex.`);
        }
      }
    }
  }

  return warnings;
}
