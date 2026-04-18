import type { AnalysisContext, ChangedFile, Finding, RiskLevel } from '../types/index.js';
import { matchAny } from '../utils/glob.js';

const COUPLING_IMPORT_RE = /^\s*(?:import\s.+from\s+['"]([^'"]+)['"]|const\s+.+=\s*require\s*\(\s*['"]([^'"]+)['"]\))/;

function changeSizeLevel(loc: number): RiskLevel {
  if (loc >= 300) return 'CRITICAL';
  if (loc >= 120) return 'HIGH';
  if (loc >= 40) return 'MEDIUM';
  return 'LOW';
}

function countImports(file: ChangedFile): number {
  if (!file.content) return 0;
  let n = 0;
  for (const line of file.content.split('\n')) if (COUPLING_IMPORT_RE.test(line)) n += 1;
  return n;
}

export interface RegressionAnalysis {
  findings: Finding[];
  perFile: Array<{
    path: string;
    loc: number;
    isCritical: boolean;
    isStrict: boolean;
    imports: number;
    bugProneMarkers: number;
  }>;
}

export function analyzeRegressionRisk(ctx: AnalysisContext): RegressionAnalysis {
  const findings: Finding[] = [];
  const perFile: RegressionAnalysis['perFile'] = [];

  for (const file of ctx.changedFiles) {
    if (matchAny(file.path, ctx.config.ignoredPaths)) continue;

    const loc = file.totalAdded + file.totalRemoved;
    const isCritical = matchAny(file.path, ctx.config.criticalPaths);
    const isStrict = matchAny(file.path, ctx.config.strictAreas);
    const imports = countImports(file);

    let bugProneMarkers = 0;
    const markers: number[] = [];
    for (const hunk of file.hunks) {
      for (const l of hunk.addedLines) {
        if (/\b(?:TODO|FIXME|HACK|XXX|@ts-ignore|@ts-expect-error|eslint-disable)\b/.test(l.text)) {
          bugProneMarkers += 1;
          markers.push(l.lineNo);
        }
      }
    }
    perFile.push({ path: file.path, loc, isCritical, isStrict, imports, bugProneMarkers });

    if (loc >= 40) {
      findings.push({
        file: file.path,
        category: 'regression',
        level: isCritical ? 'HIGH' : changeSizeLevel(loc),
        title: `Large change (${loc} lines) — elevated regression risk`,
        reason: `Changes over 40 LOC correlate strongly with post-merge regressions, particularly in ${isCritical ? 'critical paths' : 'shared modules'}.`,
        suggestedTests: ['Add regression tests around the specific behaviors you changed, not just the happy path.'],
        ruleId: 'regression/large-change',
      });
    }
    if (isCritical) {
      findings.push({
        file: file.path,
        category: 'critical-path',
        level: loc >= 40 ? 'HIGH' : 'MEDIUM',
        title: 'Critical-path file modified',
        reason: 'File lives under a configured criticalPaths glob — regressions here affect auth, payment, navigation, or storage.',
        ruleId: 'regression/critical-path',
      });
    }
    if (bugProneMarkers > 0) {
      findings.push({
        file: file.path,
        category: 'regression',
        level: bugProneMarkers >= 3 ? 'HIGH' : 'MEDIUM',
        title: `${bugProneMarkers} bug-prone marker(s) added (TODO/FIXME/@ts-ignore)`,
        reason: 'Markers added in this change indicate acknowledged-but-unresolved risk. Treat as open defect surface.',
        affectedLines: markers,
        ruleId: 'regression/bug-prone-markers',
      });
    }
    if (imports >= 20 && loc >= 40) {
      findings.push({
        file: file.path,
        category: 'regression',
        level: 'MEDIUM',
        title: `Highly coupled file (${imports} imports) with substantial change`,
        reason: 'Coupling amplifies blast radius. Verify downstream callers still behave correctly.',
        ruleId: 'regression/coupling',
      });
    }
  }
  return { findings, perFile };
}
