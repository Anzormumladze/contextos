import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildContext, buildContextDetailed, type BuildContextOptions } from '../engines/context-builder.js';
import { analyzeCoverage } from '../engines/coverage.js';
import { analyzeEdgeCases } from '../engines/edge-case.js';
import { analyzeAsyncRisk } from '../engines/async-risk.js';
import { analyzeStateRisk } from '../engines/state-risk.js';
import { analyzeApiContractRisk } from '../engines/api-contract.js';
import { analyzeSecurityRisk } from '../engines/security.js';
import { analyzeRegressionRisk } from '../engines/regression.js';
import { analyzeRemovalRisk } from '../engines/removal-risk.js';
import { analyzeCustomRules } from '../engines/custom-rules.js';
import { scoreAnalysis } from '../engines/scoring.js';
import { normalize } from '../engines/normalizer.js';
import { runFullPipeline } from '../engines/pipeline.js';
import { ALL_PATTERN_RULES } from '../rules/patterns.js';
import { PYTHON_RULES } from '../rules/patterns-python.js';
import { GO_RULES } from '../rules/patterns-go.js';
import type { Finding, AnalysisResult } from '../types/index.js';

export interface ToolInput extends BuildContextOptions {
  useCache?: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (input: ToolInput & Record<string, unknown>) => unknown;
}

const COMMON_INPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    cwd: { type: 'string', description: 'Project root to analyze. Defaults to server CWD.' },
    base: { type: 'string', description: 'Git base to diff against. Defaults to HEAD (working tree).' },
    diff: { type: 'string', description: 'Raw unified-diff text to analyze instead of running git.' },
    coverageReportPath: { type: 'string', description: 'Explicit path to coverage-summary.json / coverage-final.json / lcov.info.' },
    includeUntracked: { type: 'boolean', description: 'Include untracked files as added-diff. Default true.' },
    useCache: { type: 'boolean', description: 'Use the in-memory per-session analysis cache. Default true.' },
  },
  additionalProperties: false,
};

const EXPLAIN_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    ...COMMON_INPUT_SCHEMA.properties as Record<string, unknown>,
    file: { type: 'string', description: 'File path of the finding to explain.' },
    ruleId: { type: 'string', description: 'The ruleId of the finding to explain (from AnalysisResult.findings[].ruleId).' },
    contextLines: { type: 'number', description: 'Extra lines of surrounding source to return. Default 3.' },
  },
  required: ['file', 'ruleId'],
  additionalProperties: false,
};

function intoResult(findings: Finding[], extra: Partial<AnalysisResult> = {}): Partial<AnalysisResult> & { findings: Finding[] } {
  return { findings, ...extra };
}

const ALL_RULES = [...ALL_PATTERN_RULES, ...PYTHON_RULES, ...GO_RULES];

export const TOOLS: ToolDefinition[] = [
  {
    name: 'evaluate_release_safety',
    description: 'Run the full risk pipeline (coverage + edge-case + async + state + api + security + regression + removal + custom) and return a final PASS/WARN/BLOCK decision with a normalized AnalysisResult. Call this before proposing code changes, fixes, or commits.',
    inputSchema: COMMON_INPUT_SCHEMA,
    handler: (input) => {
      const { context, skippedFiles, configWarnings } = buildContextDetailed(input);
      return runFullPipeline(context, { skippedFiles, configWarnings, useCache: input.useCache });
    },
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
      const edge = analyzeEdgeCases(buildContext(input));
      return { findings: edge.findings, missingEdgeCases: edge.missingEdgeCases };
    },
  },
  {
    name: 'predict_regression_risk',
    description: 'Score regression risk from change size, criticality of changed files, coupling (imports), bug-prone markers (TODO/FIXME/@ts-ignore), and removed safeguards (catch, status checks, auth gates).',
    inputSchema: COMMON_INPUT_SCHEMA,
    handler: (input) => {
      const ctx = buildContext(input);
      const reg = analyzeRegressionRisk(ctx);
      const rem = analyzeRemovalRisk(ctx);
      return { findings: [...reg.findings, ...rem], perFile: reg.perFile };
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
        ...analyzeRemovalRisk(ctx),
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
      const rem = analyzeRemovalRisk(ctx);
      const findings = [...edge.findings, ...async_, ...api, ...sec, ...rem];
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
  {
    name: 'explain_finding',
    description: 'Return the full rule metadata, source excerpt (±contextLines around affected lines), and suggested remediation for a single finding. Use after `evaluate_release_safety` to drill into a specific risk.',
    inputSchema: EXPLAIN_SCHEMA,
    handler: (input) => {
      const file = String(input.file ?? '');
      const ruleId = String(input.ruleId ?? '');
      const contextLines = typeof input.contextLines === 'number' ? input.contextLines : 3;
      const ctx = buildContext(input);
      const full = runFullPipeline(ctx, { useCache: input.useCache });
      const finding = full.findings.find((f) => f.file === file && f.ruleId === ruleId);
      const rule = ALL_RULES.find((r) => r.id === ruleId);
      if (!finding && !rule) {
        return { found: false, message: `No finding or rule matched file=${file} ruleId=${ruleId}` };
      }
      // Best-effort excerpt from the live file.
      let excerpt: Array<{ lineNo: number; text: string }> = [];
      const abs = resolve(ctx.projectRoot, file);
      if (existsSync(abs)) {
        try {
          const lines = readFileSync(abs, 'utf8').split('\n');
          const affected = new Set(finding?.affectedLines ?? []);
          const windows = new Set<number>();
          for (const l of affected) {
            for (let d = -contextLines; d <= contextLines; d += 1) {
              const n = l + d;
              if (n >= 1 && n <= lines.length) windows.add(n);
            }
          }
          excerpt = Array.from(windows).sort((a, b) => a - b).map((n) => ({ lineNo: n, text: lines[n - 1]! }));
        } catch { /* ignore */ }
      }
      return {
        found: true,
        finding: finding ?? null,
        rule: rule
          ? { id: rule.id, category: rule.category, level: rule.level, title: rule.title, reason: rule.reason, suggestedTests: rule.suggestedTests, suggestedFix: rule.suggestedFix, pattern: String(rule.pattern), languages: rule.languages }
          : null,
        excerpt,
      };
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
