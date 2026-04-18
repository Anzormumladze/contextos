import type { PatternRule } from './patterns.js';

const GO = ['go'];

export const GO_RULES: PatternRule[] = [
  {
    id: 'go/ignored-error',
    category: 'api-contract', level: 'MEDIUM', languages: GO,
    pattern: /^\s*(?:_|_\s*,\s*_)\s*:?=\s*[\w\.]+\s*\(/,
    title: 'Error value assigned to _ (ignored)',
    reason: 'Discarding `err` silently buries failures — the caller can never react.',
    suggestedTests: ['should propagate error when dependency fails'],
  },
  {
    id: 'go/http-no-close-body',
    category: 'async', level: 'MEDIUM', languages: GO,
    pattern: /http\.(?:Get|Post|Do)\s*\(/,
    notPattern: /defer\s+\w+\.Body\.Close/,
    blockAware: true,
    title: 'HTTP response body not deferred for Close',
    reason: 'Not closing response bodies leaks file descriptors and wedges Keep-Alive.',
    suggestedFix: 'Add `defer resp.Body.Close()` immediately after the call.',
  },
  {
    id: 'go/sql-string-concat',
    category: 'security', level: 'CRITICAL', languages: GO,
    pattern: /(?:SELECT|INSERT|UPDATE|DELETE)\s[^"]*"\s*\+\s*\w+|fmt\.Sprintf\s*\(\s*"[^"]*(?:SELECT|INSERT|UPDATE|DELETE)/i,
    title: 'SQL via string concatenation / Sprintf',
    reason: 'SQL injection vector. Use parameterised queries.',
    suggestedFix: 'Use db.Query("... WHERE id = $1", id) instead of Sprintf.',
  },
  {
    id: 'go/exec-command-shell',
    category: 'security', level: 'HIGH', languages: GO,
    pattern: /exec\.Command\s*\(\s*"(?:sh|bash|cmd)"\s*,\s*"-c"/,
    title: 'exec.Command invoking a shell',
    reason: 'Spawning `sh -c` with interpolated input is a shell-injection vector.',
  },
  {
    id: 'go/context-no-timeout',
    category: 'async', level: 'LOW', languages: GO,
    pattern: /context\.Background\s*\(\s*\)/,
    notPattern: /WithTimeout|WithDeadline|WithCancel/,
    title: 'context.Background used without deadline/cancel',
    reason: 'Long-running requests without a deadline can hang goroutines indefinitely.',
    suggestedTests: ['should cancel when upstream exceeds deadline'],
  },
  {
    id: 'go/nil-map-write',
    category: 'edge-case', level: 'MEDIUM', languages: GO,
    pattern: /var\s+\w+\s+map\s*\[/,
    notPattern: /=\s*make\s*\(map|=\s*map\s*\[/,
    title: 'Declared map without make() — write will panic',
    reason: 'Writing to a nil map panics at runtime.',
    suggestedTests: ['should not panic when map is populated'],
  },
];
