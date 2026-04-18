/**
 * Zero-dependency ANSI formatter. All helpers degrade to plain text when
 * stdout is not a TTY or `NO_COLOR` is set, so output stays clean in CI.
 */
const isTTY = Boolean(process.stdout.isTTY) && process.env.NO_COLOR === undefined;
const esc = (code: string) => `\x1b[${code}m`;

export const RESET = esc('0');
export const BOLD = esc('1');
export const DIM = esc('2');
export const RED = esc('31');
export const GREEN = esc('32');
export const YELLOW = esc('33');
export const BLUE = esc('34');
export const MAGENTA = esc('35');
export const CYAN = esc('36');
export const GRAY = esc('90');

export function paint(s: string, ...codes: string[]): string {
  if (!isTTY) return s;
  return `${codes.join('')}${s}${RESET}`;
}

export function levelColor(level: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'): string {
  switch (level) {
    case 'CRITICAL': return RED + BOLD;
    case 'HIGH':     return RED;
    case 'MEDIUM':   return YELLOW;
    case 'LOW':      return GRAY;
  }
}

export function decisionBanner(decision: 'PASS' | 'WARN' | 'BLOCK', score: number): string {
  const icon = decision === 'PASS' ? '✓' : decision === 'WARN' ? '!' : '✗';
  const color = decision === 'PASS' ? GREEN : decision === 'WARN' ? YELLOW : RED;
  return paint(`${icon} ${decision}`, color, BOLD) + ' ' + paint(`— risk ${score}/100`, GRAY);
}

export function hr(width = 60): string {
  return paint('─'.repeat(width), GRAY);
}

export function bullet(s: string, marker = '•'): string {
  return `  ${paint(marker, GRAY)} ${s}`;
}
