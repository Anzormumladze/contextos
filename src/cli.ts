#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { ToolRegistry } from './registry.js';
import { McpProxy, resolveConfig } from './proxy.js';
import { TokenBudget, countJsonTokens } from './budget.js';
import { compressFile } from './compressor.js';
import { CONTEXTOS_SCHEMA_TOKENS } from './constants.js';

const program = new Command();
program
  .name('contextos')
  .description('Meta-MCP proxy — zero schema bloat, full tool access')
  .version('0.4.0');

// ── serve ─────────────────────────────────────────────────────────────────────
program
  .command('serve')
  .description('Start the ContextOS MCP server (stdio)')
  .option('-c, --config <path>', 'Path to mcp config JSON')
  .action(async (opts) => {
    const { startMcpServer } = await import('./server.js');
    await startMcpServer(opts.config);
  });

// ── scan ──────────────────────────────────────────────────────────────────────
program
  .command('scan')
  .description('Scan and index all MCP servers, show token breakdown')
  .option('-c, --config <path>', 'Path to mcp config JSON')
  .action(async (opts) => {
    // Fix #3: load config once via resolveConfig
    let found;
    try {
      found = resolveConfig(opts.config);
    } catch (e: any) {
      console.error(chalk.red(e.message));
      process.exit(1);
    }

    if (!found) {
      console.error(chalk.red('No MCP config found. Checked .mcp.json, ~/.claude.json'));
      console.log(chalk.dim('Pass --config <path> to specify location'));
      process.exit(1);
    }

    // Fix #12: surface warnings from config discovery
    if (found.warnings.length) {
      for (const w of found.warnings) console.warn(chalk.yellow(`⚠ ${w}`));
    }

    console.log(chalk.dim(`Config: ${found.path}\n`));
    const proxy = new McpProxy(found.config);
    const registry = new ToolRegistry();
    const budget = new TokenBudget();
    const servers = proxy.getServerNames();

    console.log(`Indexing ${servers.length} servers...\n`);

    const allTools: { name: string; description: string; inputSchema: unknown }[] = [];
    for (const s of servers) {
      process.stdout.write(`  ${chalk.cyan(s.padEnd(24))}`);
      try {
        const tools = await proxy.listServerTools(s);
        registry.register(s, tools);
        allTools.push(...tools);
        const tok = tools.reduce((sum, t) => sum + countJsonTokens(t), 0);
        console.log(chalk.green('✓') + ` ${tools.length} tools  ~${(tok / 1000).toFixed(1)}k tokens`);
      } catch (e: any) {
        console.log(chalk.red('✗') + ` ${e.message}`);
      }
    }

    await proxy.closeAll();
    budget.registerFullLibrary(allTools);
    const stats = budget.stats;

    // Fix #14: use real token count for ContextOS overhead (not hardcoded "3 tool schemas")
    console.log(`\n${chalk.bold('Total if naively loaded:')}  ${chalk.red((stats.fullLibrary / 1000).toFixed(1) + 'k')} tokens`);
    console.log(`${chalk.bold('ContextOS overhead:')}       ${chalk.green(CONTEXTOS_SCHEMA_TOKENS + '')} tokens (4 real tool stubs)`);
    console.log(`${chalk.bold('Max reduction:')}            ${chalk.green(stats.reductionPct + '%')} (at session start)`);

    console.log(`\n${chalk.dim('Add to your .mcp.json:')}`);
    console.log(chalk.cyan(JSON.stringify({
      mcpServers: {
        contextos: {
          command: 'npx',
          args: ['contextos', 'serve', '--config', found.path],
        },
      },
    }, null, 2)));
  });

// ── compress ──────────────────────────────────────────────────────────────────
program
  .command('compress <file>')
  .description('Compress a CLAUDE.md or context file')
  .option('-m, --mode <mode>', '"ai" (requires ANTHROPIC_API_KEY) or "local"', 'local')
  .option('-w, --write', 'Write result back to file (creates .bak backup)')
  .action(async (file, opts) => {
    const fp = resolve(file);
    if (!existsSync(fp)) { console.error(chalk.red(`Not found: ${fp}`)); process.exit(1); }
    console.log(chalk.dim(`Compressing ${file} (${opts.mode} mode)...`));
    try {
      const r = await compressFile(fp, opts.mode, opts.write ?? false);
      console.log(`\n  Original:   ${chalk.white(r.originalTokens)} tokens`);
      console.log(`  Compressed: ${chalk.green(r.compressedTokens)} tokens`);
      console.log(`  Saved:      ${chalk.bold.green(r.saved + ' tokens (' + r.pct + '%)')}`);
      if (!opts.write) {
        console.log('\n' + chalk.bold('Preview:'));
        console.log(chalk.dim('─'.repeat(60)));
        r.compressed.split('\n').slice(0, 20).forEach(l => console.log('  ' + l));
        if (r.compressed.split('\n').length > 20) console.log(chalk.dim('  ...'));
        console.log(chalk.dim('\nRun with --write to apply. A .bak file will be created.'));
      } else {
        console.log(chalk.green(`\n✓ Written. Backup: ${file}.bak`));
      }
    } catch (e: any) {
      console.error(chalk.red(e.message));
      process.exit(1);
    }
  });

// ── search ────────────────────────────────────────────────────────────────────
program
  .command('search <query>')
  .description('Search tools across all MCP servers')
  .option('-c, --config <path>', 'Path to mcp config JSON')
  .action(async (query, opts) => {
    let found;
    try {
      found = resolveConfig(opts.config);
    } catch (e: any) {
      console.error(chalk.red(e.message));
      process.exit(1);
    }

    if (!found) { console.error(chalk.red('No MCP config found')); process.exit(1); }

    if (found.warnings.length) {
      for (const w of found.warnings) console.warn(chalk.yellow(`⚠ ${w}`));
    }

    const proxy = new McpProxy(found.config);
    const registry = new ToolRegistry();

    process.stdout.write(chalk.dim('Indexing...'));
    for (const s of proxy.getServerNames()) {
      try { registry.register(s, await proxy.listServerTools(s)); } catch {}
    }
    await proxy.closeAll();
    console.log(chalk.dim(` ${registry.totalTools} tools\n`));

    const results = registry.search(query, 8);
    if (!results.length) { console.log(chalk.yellow('No results')); return; }

    for (const r of results) {
      console.log(`${chalk.cyan(r.entry.id)}`);
      console.log(`  ${chalk.dim(r.entry.description.slice(0, 100))}`);
      console.log(`  ${chalk.dim('score: ' + r.score.toFixed(1) + ' | ~' + Math.round(r.entry.tokens) + ' tokens')}\n`);
    }
  });

program.parse();
