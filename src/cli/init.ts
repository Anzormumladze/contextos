import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { dirname, resolve, relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { paint, GREEN, YELLOW, GRAY, BOLD, CYAN } from './format.js';

export interface InitOptions {
  cwd?: string;
  yes?: boolean;
  local?: boolean;
  dryRun?: boolean;
  noClaudeMd?: boolean;
  noConfig?: boolean;
  force?: boolean;
}

interface Plan {
  projectRoot: string;
  mcpPath: string;
  mcpEntry: { command: string; args: string[] };
  writeMcp: { before: string | null; after: string };
  configPath: string;
  writeConfig: { before: string | null; after: string } | null;
  claudeMdPath: string;
  writeClaudeMd: { before: string | null; after: string } | null;
}

function findRepoRoot(start: string): string {
  let dir = resolve(start);
  const root = resolve('/');
  while (dir !== root) {
    if (existsSync(join(dir, '.git'))) return dir;
    if (existsSync(join(dir, 'package.json'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return start;
    dir = parent;
  }
  return start;
}

function resolveLocalServerCommand(): { command: string; args: string[] } {
  // This file lives in dist/cli/init.js when compiled. `dist/cli.js` is the CLI entrypoint.
  const here = fileURLToPath(import.meta.url);
  const cliEntry = resolve(dirname(here), '..', 'cli.js');
  if (existsSync(cliEntry)) {
    return { command: 'node', args: [cliEntry, 'serve'] };
  }
  return { command: 'npx', args: ['-y', 'contextos-risk', 'serve'] };
}

function loadJson(p: string): Record<string, unknown> | null {
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>; }
  catch { return null; }
}

function buildPlan(opts: InitOptions): Plan {
  const projectRoot = findRepoRoot(opts.cwd ?? process.cwd());
  const mcpPath = join(projectRoot, '.mcp.json');
  const entry = opts.local === false
    ? { command: 'npx', args: ['-y', 'contextos-risk', 'serve'] }
    : resolveLocalServerCommand();

  const currentMcp = loadJson(mcpPath) ?? { mcpServers: {} };
  const mcpServers = (currentMcp.mcpServers && typeof currentMcp.mcpServers === 'object')
    ? { ...(currentMcp.mcpServers as Record<string, unknown>) }
    : {};
  mcpServers.risk = entry;
  const nextMcp = { ...currentMcp, mcpServers };
  const writeMcp = {
    before: existsSync(mcpPath) ? readFileSync(mcpPath, 'utf8') : null,
    after: JSON.stringify(nextMcp, null, 2) + '\n',
  };

  // risk.config.json — only create if missing (never clobber)
  const configPath = join(projectRoot, 'risk.config.json');
  let writeConfig: Plan['writeConfig'] = null;
  if (!opts.noConfig && (!existsSync(configPath) || opts.force)) {
    writeConfig = {
      before: existsSync(configPath) ? readFileSync(configPath, 'utf8') : null,
      after: JSON.stringify(defaultProjectConfig(), null, 2) + '\n',
    };
  }

  // CLAUDE.md — add/append the risk-mcp section
  const claudeMdPath = join(projectRoot, 'CLAUDE.md');
  let writeClaudeMd: Plan['writeClaudeMd'] = null;
  if (!opts.noClaudeMd) {
    const current = existsSync(claudeMdPath) ? readFileSync(claudeMdPath, 'utf8') : '';
    if (!current.includes('contextos-risk')) {
      writeClaudeMd = {
        before: current || null,
        after: (current ? current.trimEnd() + '\n\n' : '') + claudeMdStanza() + '\n',
      };
    }
  }

  return { projectRoot, mcpPath, mcpEntry: entry, writeMcp, configPath, writeConfig, claudeMdPath, writeClaudeMd };
}

function defaultProjectConfig(): Record<string, unknown> {
  return {
    criticalPaths: ['src/auth/**', 'src/payment/**', 'src/checkout/**', 'src/navigation/**', 'src/storage/**', 'src/migrations/**'],
    strictAreas: ['src/api/**', 'src/hooks/**', 'src/state/**', 'src/store/**', 'src/services/**'],
    ignoredPaths: ['node_modules/**', 'dist/**', 'build/**', 'coverage/**', '**/*.test.{ts,tsx,js,jsx}', '**/*.spec.{ts,tsx,js,jsx}', '**/__tests__/**', '**/*.d.ts'],
    minimumCoverage: { lines: 80, branches: 70, functions: 80, changedLines: 85 },
    decisionThresholds: { warn: 30, block: 65 },
    blockedCategories: ['security'],
    diff: { base: 'HEAD', includeUntracked: true },
  };
}

function claudeMdStanza(): string {
  return [
    '## Risk gate — contextos-risk',
    '',
    'Before proposing edits, fixes, or commits in this repo, call the `evaluate_release_safety`',
    'tool from the `risk` MCP server. Interpret the decision as:',
    '',
    '- **PASS** — proceed.',
    '- **WARN** — proceed only after adding the missing tests listed in `missingEdgeCases`.',
    '- **BLOCK** — do not ship. Resolve CRITICAL/HIGH findings or the hard-blocked category.',
    '',
    'Run `npx contextos-risk check` locally for a human summary (exit 0=PASS, 1=WARN, 2=BLOCK).',
  ].join('\n');
}

function diffSummary(plan: Plan): string {
  const lines: string[] = [];
  lines.push(paint('Plan:', BOLD));
  lines.push(`  ${paint('•', GRAY)} write ${paint(relative(plan.projectRoot, plan.mcpPath), CYAN)}  ${paint('(MCP entry for `risk`)', GRAY)}`);
  if (plan.writeConfig) lines.push(`  ${paint('•', GRAY)} write ${paint(relative(plan.projectRoot, plan.configPath), CYAN)}  ${paint('(default config)', GRAY)}`);
  else lines.push(`  ${paint('•', GRAY)} keep  ${paint('risk.config.json', GRAY)}  ${paint('(already present — skipping)', GRAY)}`);
  if (plan.writeClaudeMd) lines.push(`  ${paint('•', GRAY)} ${plan.writeClaudeMd.before ? 'append' : 'create'} ${paint('CLAUDE.md', CYAN)}  ${paint('(risk gate stanza)', GRAY)}`);
  else lines.push(`  ${paint('•', GRAY)} keep  ${paint('CLAUDE.md', GRAY)}  ${paint('(already references contextos-risk)', GRAY)}`);
  return lines.join('\n');
}

export function runInit(opts: InitOptions = {}): number {
  const plan = buildPlan(opts);

  process.stdout.write(paint('\ncontextos-risk init\n', BOLD));
  process.stdout.write(paint(`  project: ${plan.projectRoot}\n`, GRAY));
  process.stdout.write(paint(`  server : ${plan.mcpEntry.command} ${plan.mcpEntry.args.join(' ')}\n\n`, GRAY));
  process.stdout.write(diffSummary(plan) + '\n\n');

  if (opts.dryRun) {
    process.stdout.write(paint('(dry-run — no files written)\n\n', YELLOW));
    return 0;
  }

  // Write files
  writeFileSafely(plan.mcpPath, plan.writeMcp.after);
  if (plan.writeConfig) writeFileSafely(plan.configPath, plan.writeConfig.after);
  if (plan.writeClaudeMd) writeFileSafely(plan.claudeMdPath, plan.writeClaudeMd.after);

  process.stdout.write(paint('✓ installed\n', GREEN, BOLD));
  process.stdout.write('\nNext:\n');
  process.stdout.write(`  ${paint('1.', GRAY)} Restart Claude Code or reload MCP servers.\n`);
  process.stdout.write(`  ${paint('2.', GRAY)} Try it: ${paint('npx contextos-risk check', CYAN)}\n`);
  process.stdout.write(`  ${paint('3.', GRAY)} Ask Claude: "call evaluate_release_safety before editing."\n\n`);
  return 0;
}

function writeFileSafely(p: string, content: string): void {
  const dir = dirname(p);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  // Preserve trailing newline convention
  const final = content.endsWith('\n') ? content : content + '\n';
  writeFileSync(p, final);
}

export function runUninstall(opts: InitOptions = {}): number {
  const projectRoot = findRepoRoot(opts.cwd ?? process.cwd());
  const mcpPath = join(projectRoot, '.mcp.json');
  if (!existsSync(mcpPath)) {
    process.stdout.write(paint('nothing to remove — .mcp.json not found\n', GRAY));
    return 0;
  }
  const data = loadJson(mcpPath) ?? {};
  const servers = (data.mcpServers && typeof data.mcpServers === 'object')
    ? { ...(data.mcpServers as Record<string, unknown>) } : {};
  if (!servers.risk) {
    process.stdout.write(paint('nothing to remove — `risk` MCP entry not found\n', GRAY));
    return 0;
  }
  delete servers.risk;
  const next = { ...data, mcpServers: servers };
  writeFileSync(mcpPath, JSON.stringify(next, null, 2) + '\n');
  process.stdout.write(paint('✓ removed `risk` MCP entry from .mcp.json\n', GREEN, BOLD));
  process.stdout.write(paint('(risk.config.json and CLAUDE.md left in place)\n', GRAY));
  // silence unused
  void statSync;
  return 0;
}
