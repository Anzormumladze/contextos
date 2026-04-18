import { spawnSync } from 'node:child_process';

export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
}

export function exec(cmd: string, args: string[], cwd: string): ExecResult {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return {
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
    code: typeof r.status === 'number' ? r.status : -1,
  };
}
