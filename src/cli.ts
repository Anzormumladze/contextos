#!/usr/bin/env node
import { Command } from 'commander';
import { runStdio } from './server/index.js';
import { buildContext } from './engines/context-builder.js';
import { runFullPipeline } from './engines/pipeline.js';
import { TOOLS, getTool } from './tools/index.js';

const program = new Command();
program
  .name('contextos-risk')
  .description('Local release-safety MCP server (coverage + edge-case + risk intelligence)')
  .version('1.0.0');

program
  .command('serve', { isDefault: true })
  .description('Start the MCP server over stdio')
  .action(async () => {
    await runStdio();
  });

program
  .command('analyze')
  .description('Run the full pipeline once and print the AnalysisResult as JSON')
  .option('-b, --base <ref>', 'git ref to diff against', 'HEAD')
  .option('-c, --coverage <path>', 'coverage report path')
  .option('--cwd <path>', 'working directory')
  .option('--pretty', 'pretty-print JSON')
  .option('--summary', 'print a short human summary instead of JSON')
  .action((opts: { base: string; coverage?: string; cwd?: string; pretty?: boolean; summary?: boolean }) => {
    const ctx = buildContext({ cwd: opts.cwd, base: opts.base, coverageReportPath: opts.coverage });
    const result = runFullPipeline(ctx);
    if (opts.summary) {
      process.stdout.write(
        `[${result.decision}] score=${result.overallRiskScore} level=${result.overallRiskLevel}\n` +
        `${result.summary}\n` +
        (result.findings.length ? `\nTop findings:\n${result.findings.slice(0, 8).map((f) => `  [${f.level}] ${f.file}: ${f.title}`).join('\n')}\n` : '') +
        (result.missingEdgeCases.length ? `\nMissing edge cases:\n${result.missingEdgeCases.slice(0, 8).map((e) => `  - ${e}`).join('\n')}\n` : ''),
      );
    } else {
      process.stdout.write(JSON.stringify(result, null, opts.pretty ? 2 : 0) + '\n');
    }
    process.exit(result.decision === 'BLOCK' ? 2 : result.decision === 'WARN' ? 1 : 0);
  });

program
  .command('tools')
  .description('List registered MCP tools')
  .action(() => {
    for (const t of TOOLS) {
      process.stdout.write(`- ${t.name}\n    ${t.description}\n`);
    }
  });

program
  .command('run <tool>')
  .description('Invoke a single tool and print its JSON result')
  .option('-b, --base <ref>', 'git ref to diff against')
  .option('-c, --coverage <path>', 'coverage report path')
  .option('--cwd <path>', 'working directory')
  .action((tool: string, opts: { base?: string; coverage?: string; cwd?: string }) => {
    const def = getTool(tool);
    if (!def) {
      process.stderr.write(`Unknown tool: ${tool}\n`);
      process.exit(64);
    }
    const result = def.handler({ cwd: opts.cwd, base: opts.base, coverageReportPath: opts.coverage });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  });

program.parseAsync(process.argv).catch((err) => {
  process.stderr.write(`[contextos-risk] fatal: ${(err as Error).stack ?? String(err)}\n`);
  process.exit(1);
});
