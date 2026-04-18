import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import type { CoverageReport, CoverageFileSummary } from '../types/index.js';

const CANDIDATE_PATHS = [
  'coverage/coverage-summary.json',
  'coverage/coverage-final.json',
  'coverage/lcov.info',
  '.nyc_output/coverage-summary.json',
];

function emptyReport(source: CoverageReport['source'] = 'none'): CoverageReport {
  return {
    source,
    files: {},
    totals: {
      lines: { total: 0, covered: 0, pct: 0 },
      branches: { total: 0, covered: 0, pct: 0 },
      functions: { total: 0, covered: 0, pct: 0 },
    },
  };
}

function pct(covered: number, total: number): number {
  if (total === 0) return 100;
  return Math.round((covered / total) * 1000) / 10;
}

function normalizePath(root: string, p: string): string {
  const abs = resolve(p);
  const rel = relative(root, abs);
  return rel.replace(/\\/g, '/');
}

function parseLcov(text: string, root: string): CoverageReport {
  const report = emptyReport('lcov');
  let current: CoverageFileSummary | null = null;
  let uncoveredLines: number[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('SF:')) {
      const path = normalizePath(root, line.slice(3));
      current = {
        path,
        lines: { total: 0, covered: 0, pct: 0 },
        branches: { total: 0, covered: 0, pct: 0 },
        functions: { total: 0, covered: 0, pct: 0 },
        uncoveredLines: [],
        partiallyCoveredBranches: [],
      };
      uncoveredLines = [];
    } else if (current && line.startsWith('DA:')) {
      const [lineNo, hits] = line.slice(3).split(',').map((n) => parseInt(n, 10));
      current.lines.total += 1;
      if ((hits ?? 0) > 0) current.lines.covered += 1;
      else if (lineNo !== undefined) uncoveredLines.push(lineNo);
    } else if (current && line.startsWith('BRDA:')) {
      const parts = line.slice(5).split(',');
      const lineNo = parseInt(parts[0]!, 10);
      const hits = parts[3] === '-' ? 0 : parseInt(parts[3]!, 10);
      current.branches.total += 1;
      if (hits > 0) current.branches.covered += 1;
      else if (!current.partiallyCoveredBranches.includes(lineNo)) current.partiallyCoveredBranches.push(lineNo);
    } else if (current && line.startsWith('FNDA:')) {
      const hits = parseInt(line.slice(5).split(',')[0]!, 10);
      current.functions.total += 1;
      if (hits > 0) current.functions.covered += 1;
    } else if (line === 'end_of_record' && current) {
      current.lines.pct = pct(current.lines.covered, current.lines.total);
      current.branches.pct = pct(current.branches.covered, current.branches.total);
      current.functions.pct = pct(current.functions.covered, current.functions.total);
      current.uncoveredLines = uncoveredLines.slice().sort((a, b) => a - b);
      report.files[current.path] = current;
      report.totals.lines.total += current.lines.total;
      report.totals.lines.covered += current.lines.covered;
      report.totals.branches.total += current.branches.total;
      report.totals.branches.covered += current.branches.covered;
      report.totals.functions.total += current.functions.total;
      report.totals.functions.covered += current.functions.covered;
      current = null;
    }
  }
  report.totals.lines.pct = pct(report.totals.lines.covered, report.totals.lines.total);
  report.totals.branches.pct = pct(report.totals.branches.covered, report.totals.branches.total);
  report.totals.functions.pct = pct(report.totals.functions.covered, report.totals.functions.total);
  return report;
}

interface IstanbulSummaryEntry {
  lines?: { total: number; covered: number; pct: number };
  branches?: { total: number; covered: number; pct: number };
  functions?: { total: number; covered: number; pct: number };
}

interface IstanbulFileReport {
  path?: string;
  statementMap?: Record<string, { start: { line: number } }>;
  s?: Record<string, number>;
  branchMap?: Record<string, { line: number }>;
  b?: Record<string, number[]>;
  fnMap?: Record<string, unknown>;
  f?: Record<string, number>;
}

function parseIstanbulSummary(text: string, root: string): CoverageReport {
  const data = JSON.parse(text) as Record<string, IstanbulSummaryEntry>;
  const report = emptyReport('istanbul-json');
  for (const [key, entry] of Object.entries(data)) {
    if (key === 'total') continue;
    const path = normalizePath(root, key);
    const lines = entry.lines ?? { total: 0, covered: 0, pct: 0 };
    const branches = entry.branches ?? { total: 0, covered: 0, pct: 0 };
    const functions = entry.functions ?? { total: 0, covered: 0, pct: 0 };
    report.files[path] = {
      path,
      lines: { ...lines, pct: lines.pct ?? pct(lines.covered, lines.total) },
      branches: { ...branches, pct: branches.pct ?? pct(branches.covered, branches.total) },
      functions: { ...functions, pct: functions.pct ?? pct(functions.covered, functions.total) },
      uncoveredLines: [],
      partiallyCoveredBranches: [],
    };
    report.totals.lines.total += lines.total;
    report.totals.lines.covered += lines.covered;
    report.totals.branches.total += branches.total;
    report.totals.branches.covered += branches.covered;
    report.totals.functions.total += functions.total;
    report.totals.functions.covered += functions.covered;
  }
  report.totals.lines.pct = pct(report.totals.lines.covered, report.totals.lines.total);
  report.totals.branches.pct = pct(report.totals.branches.covered, report.totals.branches.total);
  report.totals.functions.pct = pct(report.totals.functions.covered, report.totals.functions.total);
  return report;
}

function parseIstanbulFinal(text: string, root: string): CoverageReport {
  const data = JSON.parse(text) as Record<string, IstanbulFileReport>;
  const report = emptyReport('istanbul-json');
  for (const [key, file] of Object.entries(data)) {
    const path = normalizePath(root, file.path ?? key);
    const statements = file.s ?? {};
    const statementMap = file.statementMap ?? {};
    let lineTotal = 0, lineCovered = 0;
    const uncoveredLines: number[] = [];
    for (const [sid, hits] of Object.entries(statements)) {
      const loc = statementMap[sid];
      if (!loc) continue;
      lineTotal += 1;
      if (hits > 0) lineCovered += 1;
      else uncoveredLines.push(loc.start.line);
    }
    const branchHits = file.b ?? {};
    const branchMap = file.branchMap ?? {};
    let brTotal = 0, brCovered = 0;
    const partial: number[] = [];
    for (const [bid, hitsArr] of Object.entries(branchHits)) {
      for (const hit of hitsArr) {
        brTotal += 1;
        if (hit > 0) brCovered += 1;
        else {
          const line = branchMap[bid]?.line;
          if (line && !partial.includes(line)) partial.push(line);
        }
      }
    }
    const fnHits = file.f ?? {};
    let fnTotal = 0, fnCovered = 0;
    for (const hits of Object.values(fnHits)) {
      fnTotal += 1;
      if (hits > 0) fnCovered += 1;
    }
    report.files[path] = {
      path,
      lines: { total: lineTotal, covered: lineCovered, pct: pct(lineCovered, lineTotal) },
      branches: { total: brTotal, covered: brCovered, pct: pct(brCovered, brTotal) },
      functions: { total: fnTotal, covered: fnCovered, pct: pct(fnCovered, fnTotal) },
      uncoveredLines: uncoveredLines.sort((a, b) => a - b),
      partiallyCoveredBranches: partial.sort((a, b) => a - b),
    };
    report.totals.lines.total += lineTotal;
    report.totals.lines.covered += lineCovered;
    report.totals.branches.total += brTotal;
    report.totals.branches.covered += brCovered;
    report.totals.functions.total += fnTotal;
    report.totals.functions.covered += fnCovered;
  }
  report.totals.lines.pct = pct(report.totals.lines.covered, report.totals.lines.total);
  report.totals.branches.pct = pct(report.totals.branches.covered, report.totals.branches.total);
  report.totals.functions.pct = pct(report.totals.functions.covered, report.totals.functions.total);
  return report;
}

export function loadCoverage(projectRoot: string, explicitPath?: string): CoverageReport {
  const tryPaths = explicitPath ? [explicitPath] : CANDIDATE_PATHS;
  for (const rel of tryPaths) {
    const abs = resolve(projectRoot, rel);
    if (!existsSync(abs)) continue;
    try {
      const st = statSync(abs);
      if (!st.isFile()) continue;
      const text = readFileSync(abs, 'utf8');
      if (abs.endsWith('.info')) return parseLcov(text, projectRoot);
      if (abs.endsWith('coverage-summary.json')) return parseIstanbulSummary(text, projectRoot);
      if (abs.endsWith('coverage-final.json')) return parseIstanbulFinal(text, projectRoot);
    } catch {
      /* try next */
    }
  }
  return emptyReport();
}
