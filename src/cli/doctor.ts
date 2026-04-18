import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { spawn } from 'node:child_process';
import { paint, GREEN, RED, YELLOW, GRAY, BOLD } from './format.js';
import { loadConfig } from '../config/loader.js';

interface Check { name: string; ok: boolean; detail?: string; fix?: string; info?: boolean }

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

function nodeVersionOk(): boolean {
  const [major] = process.versions.node.split('.').map((n) => parseInt(n, 10));
  return (major ?? 0) >= 20;
}

async function probeMcp(command: string, args: string[], cwd: string, timeoutMs = 5000): Promise<Check> {
  return new Promise((resolvePromise) => {
    const proc = spawn(command, args, { cwd });
    let stdout = '';
    let closed = false;
    const timer = setTimeout(() => { if (!closed) proc.kill('SIGTERM'); }, timeoutMs);
    proc.stdout.on('data', (b) => { stdout += b.toString('utf8'); });
    proc.on('error', (err) => {
      closed = true; clearTimeout(timer);
      resolvePromise({ name: 'MCP server handshake', ok: false, detail: err.message, fix: 'Check that `node` is installed and the server command is correct.' });
    });
    proc.on('close', () => {
      closed = true; clearTimeout(timer);
      const first = stdout.split('\n').find((l) => l.trim().startsWith('{'));
      if (!first) { resolvePromise({ name: 'MCP server handshake', ok: false, detail: 'no protocol frames returned', fix: 'Run `contextos-risk serve` manually to see errors.' }); return; }
      try {
        const frame = JSON.parse(first);
        const ok = frame?.result?.serverInfo?.name === 'contextos-risk';
        resolvePromise({ name: 'MCP server handshake', ok, detail: ok ? `v${frame.result.serverInfo.version}` : 'unexpected server response' });
      } catch (e) {
        resolvePromise({ name: 'MCP server handshake', ok: false, detail: (e as Error).message });
      }
    });
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'doctor', version: '0' } } }) + '\n');
    setTimeout(() => proc.stdin.end(), 200);
  });
}

export async function runDoctor(cwd: string = process.cwd()): Promise<number> {
  const projectRoot = findRepoRoot(cwd);
  const checks: Check[] = [];

  checks.push({
    name: 'Node.js >= 20',
    ok: nodeVersionOk(),
    detail: process.versions.node,
    fix: 'Upgrade to Node 20 or later.',
  });

  // .mcp.json
  const mcpPath = join(projectRoot, '.mcp.json');
  const mcp = existsSync(mcpPath) ? (() => { try { return JSON.parse(readFileSync(mcpPath, 'utf8')); } catch { return null; } })() : null;
  const hasRisk = mcp?.mcpServers?.risk && mcp.mcpServers.risk.command;
  checks.push({
    name: '.mcp.json has `risk` entry',
    ok: !!hasRisk,
    detail: hasRisk ? `${mcp.mcpServers.risk.command} ${(mcp.mcpServers.risk.args ?? []).join(' ')}` : 'missing',
    fix: 'Run `npx contextos-risk init`.',
  });

  // risk.config.json + warnings
  const { configPath, warnings } = loadConfig(projectRoot);
  checks.push({
    name: 'risk.config.json loads cleanly',
    ok: warnings.length === 0,
    detail: configPath ? configPath : '(defaults — no file present)',
    fix: warnings.length > 0 ? warnings.join(' | ') : undefined,
  });

  // coverage presence (informational)
  const covCandidates = ['coverage/coverage-summary.json', 'coverage/coverage-final.json', 'coverage/lcov.info'];
  const cov = covCandidates.find((p) => existsSync(join(projectRoot, p)));
  checks.push({
    name: 'coverage report discoverable',
    ok: !!cov,
    info: !cov, // not a failure — tighter gate is optional
    detail: cov ?? 'none found — changed-line coverage gate is disabled',
    fix: 'Run `jest --coverage` / `vitest --coverage` before analyzing for a stricter gate.',
  });

  // MCP server probe
  if (hasRisk) {
    const { command, args } = mcp.mcpServers.risk as { command: string; args: string[] };
    checks.push(await probeMcp(command, args, projectRoot));
  }

  // Render
  process.stdout.write(paint('\ncontextos-risk doctor\n', BOLD));
  process.stdout.write(paint(`  project: ${projectRoot}\n\n`, GRAY));
  let fails = 0;
  for (const c of checks) {
    const icon = c.ok ? paint('✓', GREEN, BOLD)
      : c.info ? paint('·', YELLOW, BOLD)
      : paint('✗', RED, BOLD);
    process.stdout.write(`${icon} ${c.name}`);
    if (c.detail) process.stdout.write(paint(`  (${c.detail})`, GRAY));
    process.stdout.write('\n');
    if (!c.ok && c.fix) process.stdout.write(paint(`    → ${c.fix}\n`, YELLOW));
    if (!c.ok && !c.info) fails += 1;
  }
  process.stdout.write('\n');
  return fails > 0 ? 1 : 0;
}
