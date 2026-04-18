import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { DEFAULT_CONFIG } from './defaults.js';
import type { RiskConfig, PartialRiskConfig } from './schema.js';

const CONFIG_FILENAMES = ['risk.config.json', '.riskrc.json', '.risk.json'];

function findConfigFile(start: string): string | null {
  let dir = resolve(start);
  const root = resolve('/');
  while (true) {
    for (const name of CONFIG_FILENAMES) {
      const candidate = join(dir, name);
      if (existsSync(candidate)) return candidate;
    }
    if (dir === root) return null;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function deepMerge<T>(base: T, override: unknown): T {
  if (override === null || override === undefined) return base;
  if (typeof base !== 'object' || base === null) return override as T;
  if (typeof override !== 'object') return base;
  if (Array.isArray(base) || Array.isArray(override)) return override as T;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(override as Record<string, unknown>)) {
    out[k] = deepMerge((base as Record<string, unknown>)[k] as unknown, v);
  }
  return out as T;
}

export interface LoadedConfig {
  config: RiskConfig;
  configPath: string | null;
  projectRoot: string;
}

export function loadConfig(cwd: string = process.cwd(), override?: PartialRiskConfig): LoadedConfig {
  const configPath = findConfigFile(cwd);
  let fileConfig: PartialRiskConfig = {};
  let projectRoot = cwd;
  if (configPath) {
    projectRoot = dirname(configPath);
    try {
      fileConfig = JSON.parse(readFileSync(configPath, 'utf8')) as PartialRiskConfig;
    } catch (err) {
      throw new Error(`Failed to parse config at ${configPath}: ${(err as Error).message}`);
    }
  }
  let config = deepMerge(DEFAULT_CONFIG, fileConfig);
  if (override) config = deepMerge(config, override);
  if (!config.projectRoot) config.projectRoot = projectRoot;
  return { config, configPath, projectRoot };
}
