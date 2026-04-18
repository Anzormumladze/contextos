#!/usr/bin/env node
import { Command } from 'commander';
import { runStdio } from './server/index.js';
import { buildContextDetailed } from './engines/context-builder.js';
import { runFullPipeline } from './engines/pipeline.js';
import { TOOLS, getTool } from './tools/index.js';
import { runInit, runUninstall } from './cli/init.js';
import { runDoctor } from './cli/doctor.js';
import { runCheck } from './cli/check.js';

const program = new Command();
program
  .name('contextos-risk')
  .description('Local release-safety MCP server (coverage + edge-case + risk intelligence)')
  .version('1.0.0');

program
  .command('init')
  .description('Auto-install the MCP into the current project (.mcp.json + risk.config.json + CLAUDE.md)')
  .option('-y, --yes', 'non-interactive; use defaults', true)
  .option('--local', 'reference this install by absolute path (dev) instead of `npx contextos-risk serve`', true)
  .option('--no-local', 'use `npx contextos-risk serve` in .mcp.json (published-package mode)')
  .option('--no-claude-md', 'do not touch CLAUDE.md')
  .option('--no-config', 'do not create risk.config.json')
  .option('--dry-run', 'print the plan without writing files')
  .option('--force', 'overwrite risk.config.json if it already exists')
  .action((opts) => { process.exit(runInit(opts)); });

program
  .command('uninstall')
  .description('Remove the `risk` entry from .mcp.json (leaves config + CLAUDE.md intact)')
  .action(() => { process.exit(runUninstall()); });

program
  .command('doctor')
  .description('Check node version, MCP config, risk.config.json, coverage discoverability, and MCP handshake')
  .action(async () => { process.exit(await runDoctor()); });

program
  .command('check')
  .description('Run the full risk pipeline and print a human-readable summary. Exit 0=PASS, 1=WARN, 2=BLOCK.')
  .option('-b, --base <ref>', 'git ref to diff against', 'HEAD')
  .option('-c, --coverage <path>', 'coverage report path')
  .option('--cwd <path>', 'working directory')
  .option('--json', 'emit raw JSON instead')
  .option('--markdown', 'emit Markdown instead')
  .action(async (opts) => { process.exit(await runCheck(opts)); });

program
  .command('serve')
  .description('Start the MCP server over stdio')
  .action(async () => { await runStdio(); });

program
  .command('analyze')
  .description('Run the full pipeline once and print the AnalysisResult as JSON (alias for `check --json`)')
  .option('-b, --base <ref>', 'git ref to diff against', 'HEAD')
  .option('-c, --coverage <path>', 'coverage report path')
  .option('--cwd <path>', 'working directory')
  .option('--pretty', 'pretty-print JSON')
  .option('--summary', 'print a short human summary instead of JSON')
  .action((opts: { base: string; coverage?: string; cwd?: string; pretty?: boolean; summary?: boolean }) => {
    const { context, skippedFiles, configWarnings } = buildContextDetailed({ cwd: opts.cwd, base: opts.base, coverageReportPath: opts.coverage });
    const result = runFullPipeline(context, { skippedFiles, configWarnings });
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
    for (const t of TOOLS) process.stdout.write(`- ${t.name}\n    ${t.description}\n`);
  });

program
  .command('run <tool>')
  .description('Invoke a single tool and print its JSON result')
  .option('-b, --base <ref>', 'git ref to diff against')
  .option('-c, --coverage <path>', 'coverage report path')
  .option('--cwd <path>', 'working directory')
  .action((tool: string, opts: { base?: string; coverage?: string; cwd?: string }) => {
    const def = getTool(tool);
    if (!def) { process.stderr.write(`Unknown tool: ${tool}\n`); process.exit(64); }
    const result = def.handler({ cwd: opts.cwd, base: opts.base, coverageReportPath: opts.coverage } as Parameters<typeof def.handler>[0]);
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  });

// Default command when no args → show help
if (process.argv.length <= 2) {
  program.help();
}

program.parseAsync(process.argv).catch((err) => {
  process.stderr.write(`[contextos-risk] fatal: ${(err as Error).stack ?? String(err)}\n`);
  process.exit(1);
});
