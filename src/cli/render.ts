import type { AnalysisResult, Finding, RiskLevel } from '../types/index.js';
import { paint, decisionBanner, levelColor, hr, bullet, GRAY, BOLD, CYAN, RESET } from './format.js';

const LEVEL_ORDER: RiskLevel[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

function groupByLevel(findings: Finding[]): Record<RiskLevel, Finding[]> {
  const out: Record<RiskLevel, Finding[]> = { CRITICAL: [], HIGH: [], MEDIUM: [], LOW: [] };
  for (const f of findings) out[f.level].push(f);
  return out;
}

/** ANSI-coloured human summary for the `check` terminal command. */
export function renderHuman(result: AnalysisResult): string {
  const lines: string[] = [];
  const grouped = groupByLevel(result.findings);

  lines.push('');
  lines.push(decisionBanner(result.decision, result.overallRiskScore));
  lines.push(paint(result.summary, GRAY));
  lines.push(hr());

  for (const level of LEVEL_ORDER) {
    const items = grouped[level];
    if (items.length === 0) continue;
    if (level === 'LOW' && result.decision === 'PASS') continue; // don't drown a PASS in low-level nits
    lines.push(`${paint(level, levelColor(level), BOLD)} (${items.length})`);
    for (const f of items.slice(0, 6)) {
      const loc = f.affectedLines?.length ? paint(`:${f.affectedLines[0]}`, GRAY) : '';
      lines.push(`  ${paint('✗', levelColor(level))} ${paint(f.file, CYAN)}${loc} — ${f.title}`);
      if (f.evidence?.[0]) lines.push(`     ${paint('│', GRAY)}  ${paint(f.evidence[0].slice(0, 110), GRAY)}`);
      if (f.suggestedFix) lines.push(`     ${paint('└─', GRAY)} ${paint('fix:', BOLD)} ${f.suggestedFix}`);
    }
    if (items.length > 6) lines.push(paint(`  … and ${items.length - 6} more`, GRAY));
    lines.push('');
  }

  if (result.missingEdgeCases.length > 0) {
    lines.push(paint('Missing tests (top 8)', BOLD));
    for (const t of result.missingEdgeCases.slice(0, 8)) lines.push(bullet(t));
    lines.push('');
  }

  if (result.recommendedNextSteps.length > 0) {
    lines.push(paint('Next steps', BOLD));
    result.recommendedNextSteps.forEach((s, i) => lines.push(`  ${paint(String(i + 1) + '.', GRAY)} ${s}`));
    lines.push('');
  }

  const br = result.meta.scoringBreakdown;
  lines.push(paint(
    `findings=${br.findingsSubtotal} + coverage-gap=${br.coverageGapSubtotal} + change-size=${br.changeSizeSubtotal} → ${result.overallRiskScore}`,
    GRAY,
  ));
  if (result.meta.configWarnings.length > 0) {
    lines.push(paint(`⚠ ${result.meta.configWarnings.length} config warning(s). Run \`contextos-risk doctor\` to inspect.`, GRAY));
  }
  lines.push('');
  return lines.join('\n');
}

/**
 * Markdown summary — emitted as the primary content item of the MCP response.
 * Claude Code renders this directly; structured JSON still ships as the second
 * content item for programmatic use.
 */
export function renderMarkdown(result: AnalysisResult): string {
  const icon = result.decision === 'PASS' ? '✅' : result.decision === 'WARN' ? '⚠️' : '⛔';
  const md: string[] = [];
  md.push(`## ${icon} ${result.decision} — risk ${result.overallRiskScore}/100 (${result.overallRiskLevel})`);
  md.push('');
  md.push(result.summary);
  md.push('');

  const grouped = groupByLevel(result.findings);
  for (const level of LEVEL_ORDER) {
    const items = grouped[level];
    if (items.length === 0) continue;
    md.push(`### ${level} (${items.length})`);
    for (const f of items.slice(0, 10)) {
      const loc = f.affectedLines?.length ? `:${f.affectedLines[0]}` : '';
      md.push(`- **${f.file}${loc}** — ${f.title}`);
      if (f.evidence?.[0]) md.push(`  - \`${f.evidence[0].slice(0, 160).replace(/`/g, "'")}\``);
      if (f.suggestedFix) md.push(`  - Fix: ${f.suggestedFix}`);
    }
    if (items.length > 10) md.push(`- …and ${items.length - 10} more`);
    md.push('');
  }

  if (result.missingEdgeCases.length > 0) {
    md.push('### Missing tests');
    for (const t of result.missingEdgeCases.slice(0, 10)) md.push(`- ${t}`);
    md.push('');
  }

  if (result.recommendedNextSteps.length > 0) {
    md.push('### Next steps');
    result.recommendedNextSteps.forEach((s, i) => md.push(`${i + 1}. ${s}`));
    md.push('');
  }

  const br = result.meta.scoringBreakdown;
  md.push(`_Score: findings ${br.findingsSubtotal} + coverage-gap ${br.coverageGapSubtotal} + change-size ${br.changeSizeSubtotal} = **${result.overallRiskScore}**. ` +
    `coverageConsidered=${br.coverageConsidered}, maxFindingLevel=${br.maxFindingLevel}._`);
  if (result.meta.configWarnings.length > 0) {
    md.push('');
    md.push(`> ⚠ ${result.meta.configWarnings.length} config warning(s) — run \`contextos-risk doctor\` to inspect.`);
  }
  return md.join('\n');
}

// Silence unused-import warnings in minimal builds.
export const _unused = { RESET };
