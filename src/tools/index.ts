import { buildContext, type BuildContextOptions } from '../engines/context-builder.js';
import { analyzeCoverage } from '../engines/coverage.js';
import { analyzeEdgeCases } from '../engines/edge-case.js';
import { analyzeAsyncRisk } from '../engines/async-risk.js';
import { analyzeStateRisk } from '../engines/state-risk.js';
import { analyzeApiContractRisk } from '../engines/api-contract.js';
import { analyzeSecurityRisk } from '../engines/security.js';
import { analyzeRegressionRisk } from '../engines/regression.js';
import { analyzeCustomRules } from '../engines/custom-rules.js';
import { scoreAnalysis } from '../engines/scoring.js';
import { normalize } from '../engines/normalizer.js';
import { runFullPipeline } from '../engines/pipeline.js';
import type { Finding, AnalysisResult } from '../types/index.js';

export interface ToolInput extends BuildContextOptions {
  /** When true, re-runs on raw diff text supplied by caller (no git required). */
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (input: ToolInput) => unknown;
}

const COMMON_INPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    cwd: { type: 'string', description: 'Project root to analyze. Defaults to server CWD.' },
    base: { type: 'string', description: 'Git base to diff against. Defaults to HEAD (working tree).' },
    diff: { type: 'string', description: 'Raw unified-diff text to analyze instead of running git.' },
    coverageReportPath: { type: 'string', description: 'Explicit path to coverage-summary.json / coverage-final.json / lcov.info.' },
    includeUntracked: { type: 'boolean', description: 'Include untracked files as added-diff. Default true.' },
  },
  additionalProperties: false,
};

function intoResult(findings: Finding[], extra: Partial<AnalysisResult> = {}): Partial<AnalysisResult> & { findings: Finding[] } {
  return { findings, ...extra };
}

export const TOOLS: ToolDefinition[] = [
  {
    name: 'evaluate_release_safety',
    description: 'Run the full risk pipeline (coverage + edge-case + async + state + api + security + regression + custom) and return a final PASS/WARN/BLOCK decision with a normalized AnalysisResult. Call this before proposing code changes, fixes, or commits.',
    inputSchema: COMMON_INPUT_SCHEMA,
    handler: (input) => runFullPipeline(buildContext(input)),
  },
  {
    name: 'analyze_test_coverage',
    description: 'Compute line/branch/function coverage with emphasis on CHANGED-line coverage for the current diff. Flags files below configured thresholds and identifies uncovered changed lines.',
    inputSchema: COMMON_INPUT_SCHEMA,
    handler: (input) => {
      const ctx = buildContext(input);
      const cov = analyzeCoverage(ctx);
      return {
        source: ctx.coverage.source,
        totals: ctx.coverage.totals,
        changedLineCoverage: cov.changedLineCoverage,
        perFile: cov.perFile,
        findings: cov.findings,
      };
    },
  },
  {
    name: 'detect_edge_cases',
    description: 'Rule-based and heuristic detection of missing edge cases: null, empty, boundary, malformed input, timeout, unauthorized, race, rollback, critical-path scenarios. Returns findings plus concrete missing test names.',
    inputSchema: COMMON_INPUT_SCHEMA,
    handler: (input) => {
      const ctx = buildContext(input);
      const edge = analyzeEdgeCases(ctx);
      return { findings: edge.findings, missingEdgeCases: edge.missingEdgeCases };
    },
  },
  {
    name: 'predict_regression_risk',
    description: 'Score regression risk from change size, criticality of changed files, coupling (imports), and bug-prone markers (TODO/FIXME/@ts-ignore).',
    inputSchema: COMMON_INPUT_SCHEMA,
    handler: (input) => {
      const ctx = buildContext(input);
      const reg = analyzeRegressionRisk(ctx);
      return { findings: reg.findings, perFile: reg.perFile };
    },
  },
  {
    name: 'analyze_async_risk',
    description: 'Detect unawaited promises, missing catch/finally, timers without cleanup, retry loops without caps, and visible race conditions in changed code.',
    inputSchema: COMMON_INPUT_SCHEMA,
    handler: (input) => intoResult(analyzeAsyncRisk(buildContext(input))),
  },
  {
    name: 'analyze_state_risk',
    description: 'Detect stale state, useEffect-without-deps, optimistic-update-without-rollback, and unsafe persistence patterns in changed code.',
    inputSchema: COMMON_INPUT_SCHEMA,
    handler: (input) => intoResult(analyzeStateRisk(buildContext(input))),
  },
  {
    name: 'analyze_api_contract_risk',
    description: 'Detect unsafe deep property access, missing status checks, JSON.parse without try/catch, array index without length guard, and partial-response handling gaps.',
    inputSchema: COMMON_INPUT_SCHEMA,
    handler: (input) => intoResult(analyzeApiContractRisk(buildContext(input))),
  },
  {
    name: 'analyze_security_risk',
    description: 'Detect code-execution sinks, secret logging, plaintext token storage, shell/SQL injection vectors, and XSS sinks in changed code.',
    inputSchema: COMMON_INPUT_SCHEMA,
    handler: (input) => intoResult(analyzeSecurityRisk(buildContext(input))),
  },
  {
    name: 'suggest_missing_tests',
    description: 'Aggregate missing-test suggestions across all engines into a prioritized list of scenario + category + reason, ready for Claude Code to scaffold.',
    inputSchema: COMMON_INPUT_SCHEMA,
    handler: (input) => {
      const ctx = buildContext(input);
      const coverage = analyzeCoverage(ctx);
      const edge = analyzeEdgeCases(ctx);
      const findings = [
        ...coverage.findings,
        ...edge.findings,
        ...analyzeAsyncRisk(ctx),
        ...analyzeStateRisk(ctx),
        ...analyzeApiContractRisk(ctx),
        ...analyzeSecurityRisk(ctx),
        ...analyzeRegressionRisk(ctx).findings,
        ...analyzeCustomRules(ctx),
      ];
      const suggestions: Array<{ file: string; category: string; level: string; scenario: string; reason: string }> = [];
      const seen = new Set<string>();
      for (const f of findings) {
        for (const t of f.suggestedTests ?? []) {
          const key = `${f.file}::${t}`;
          if (seen.has(key)) continue;
          seen.add(key);
          suggestions.push({ file: f.file, category: f.category, level: f.level, scenario: t, reason: f.reason });
        }
      }
      return { suggestions, missingEdgeCases: edge.missingEdgeCases };
    },
  },
  {
    name: 'generate_test_matrix',
    description: 'Produce a structured scenario × input × expected table for each changed surface, grouped by file. Useful for scaffolding a test plan before writing tests.',
    inputSchema: COMMON_INPUT_SCHEMA,
    handler: (input) => {
      const ctx = buildContext(input);
      const edge = analyzeEdgeCases(ctx);
      const async_ = analyzeAsyncRisk(ctx);
      const api = analyzeApiContractRisk(ctx);
      const sec = analyzeSecurityRisk(ctx);
      const findings = [...edge.findings, ...async_, ...api, ...sec];
      const byFile: Record<string, Array<{ scenario: string; input: string; expected: string; category: string; level: string }>> = {};
      for (const f of findings) {
        for (const t of f.suggestedTests ?? []) {
          byFile[f.file] = byFile[f.file] ?? [];
          byFile[f.file]!.push({
            scenario: t,
            input: inferInput(t),
            expected: inferExpected(t),
            category: f.category,
            level: f.level,
          });
        }
      }
      return { matrix: byFile };
    },
  },
];

function inferInput(scenario: string): string {
  const s = scenario.toLowerCase();
  if (/empty/.test(s)) return 'empty array / empty string';
  if (/null|undefined|missing/.test(s)) return 'null or undefined';
  if (/401|unauthori[sz]ed/.test(s)) return 'mock 401 response';
  if (/403|forbidden/.test(s)) return 'mock 403 response';
  if (/429|rate limit/.test(s)) return 'mock 429 response';
  if (/500|server error/.test(s)) return 'mock 500 response';
  if (/timeout/.test(s)) return 'delayed / aborted response';
  if (/malformed/.test(s)) return 'invalid JSON body';
  if (/expired/.test(s)) return 'expired token';
  if (/divisor\s*=\s*0|zero/.test(s)) return 'zero / 0';
  if (/oversized|large/.test(s)) return 'file > max size';
  return 'boundary / adversarial input';
}

function inferExpected(scenario: string): string {
  const s = scenario.toLowerCase();
  if (/rollback/.test(s)) return 'local state is reverted, server state untouched';
  if (/logout/.test(s)) return 'session cleared, user redirected to login';
  if (/error state/.test(s)) return 'error UI visible, loading flag cleared';
  if (/render empty/.test(s)) return 'empty-state UI rendered, no crash';
  if (/not crash|without crashing/.test(s)) return 'no throw, graceful fallback';
  if (/stop retrying/.test(s)) return 'caller sees exhausted-retry error';
  if (/handle/.test(s)) return 'branch handled, user sees deterministic result';
  return 'no unhandled exception, deterministic outcome';
}

export function getTool(name: string): ToolDefinition | undefined {
  return TOOLS.find((t) => t.name === name);
}

export { buildContext, runFullPipeline, scoreAnalysis, normalize };
