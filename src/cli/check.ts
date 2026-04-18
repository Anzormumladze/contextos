import { buildContextDetailed } from '../engines/context-builder.js';
import { runFullPipeline } from '../engines/pipeline.js';
import { renderHuman } from './render.js';

export interface CheckOptions {
  cwd?: string;
  base?: string;
  coverage?: string;
  json?: boolean;
  markdown?: boolean;
}

/**
 * `check` = run the full pipeline against the current diff and produce a
 * human-readable terminal summary (or JSON / Markdown on request). Exit code
 * is 0 / 1 / 2 for PASS / WARN / BLOCK so it's a drop-in pre-commit / pre-push
 * gate.
 */
export async function runCheck(opts: CheckOptions = {}): Promise<number> {
  const { context, skippedFiles, configWarnings } = buildContextDetailed({
    cwd: opts.cwd, base: opts.base, coverageReportPath: opts.coverage,
  });
  const result = runFullPipeline(context, { skippedFiles, configWarnings });

  if (opts.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else if (opts.markdown) {
    const { renderMarkdown } = await import('./render.js');
    process.stdout.write(renderMarkdown(result) + '\n');
  } else {
    process.stdout.write(renderHuman(result));
  }
  return result.decision === 'BLOCK' ? 2 : result.decision === 'WARN' ? 1 : 0;
}
