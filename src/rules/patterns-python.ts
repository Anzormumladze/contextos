import type { PatternRule } from './patterns.js';

const PY = ['python'];

export const PYTHON_RULES: PatternRule[] = [
  {
    id: 'py/bare-except',
    category: 'async', level: 'MEDIUM', languages: PY,
    pattern: /^\s*except\s*:/,
    title: 'Bare except clause',
    reason: '`except:` swallows SystemExit and KeyboardInterrupt. Catch specific exceptions.',
    suggestedTests: ['should surface unexpected exceptions rather than swallow them'],
    suggestedFix: 'Narrow the except (e.g. `except (ValueError, KeyError) as e:`).',
  },
  {
    id: 'py/requests-no-timeout',
    category: 'async', level: 'MEDIUM', languages: PY,
    pattern: /\brequests\.(?:get|post|put|delete|patch)\s*\(/,
    notPattern: /timeout\s*=/,
    title: 'requests.* call without a timeout',
    reason: 'Without `timeout=`, a slow server will hang your process indefinitely.',
    suggestedTests: ['should time out when upstream is slow'],
  },
  {
    id: 'py/json-loads-no-try',
    category: 'api-contract', level: 'MEDIUM', languages: PY,
    pattern: /json\.loads\s*\(/,
    notPattern: /try\s*:|except/,
    blockAware: true,
    title: 'json.loads without try/except',
    reason: 'Malformed JSON raises ValueError; unhandled → 500.',
    suggestedTests: ['should handle malformed JSON gracefully'],
  },
  {
    id: 'py/sql-string-format',
    category: 'security', level: 'CRITICAL', languages: PY,
    pattern: /(?:SELECT|INSERT|UPDATE|DELETE)\s[^'"]*(?:\s%s|\s\{\w+\}|\"\s*%\s*\w+|\.format\s*\()/i,
    title: 'SQL built via string formatting',
    reason: 'String-formatted SQL is a direct injection vector. Use bind parameters.',
    suggestedFix: 'Use parameterised queries (`cursor.execute(sql, params)`).',
  },
  {
    id: 'py/subprocess-shell-true',
    category: 'security', level: 'HIGH', languages: PY,
    pattern: /subprocess\.(?:call|run|Popen|check_output)\s*\([^)]*shell\s*=\s*True/,
    title: 'subprocess with shell=True',
    reason: 'shell=True is a shell-injection vector when any input is user-controlled.',
    suggestedFix: 'Use an args list (e.g. `subprocess.run(["ls", path])`).',
  },
  {
    id: 'py/eval-exec',
    category: 'security', level: 'CRITICAL', languages: PY,
    pattern: /\beval\s*\(|\bexec\s*\(/,
    title: 'Dynamic code execution (eval/exec)',
    reason: 'eval/exec enable code injection when inputs are attacker-controlled.',
    suggestedFix: 'Replace with a parser or explicit mapping.',
  },
  {
    id: 'py/print-secret',
    category: 'security', level: 'HIGH', languages: PY,
    pattern: /print\s*\([^)]*\b(?:token|password|secret|api[_-]?key|jwt)\b/i,
    title: 'Potential secret in print/log',
    reason: 'Printing credentials leaks them to stdout / logs.',
  },
  {
    id: 'py/division-by-var',
    category: 'edge-case', level: 'MEDIUM', languages: PY,
    pattern: /[\w)\]]\s*\/\s*[a-zA-Z_]\w*/,
    notPattern: /\/\//,
    title: 'Division by variable — zero path not obviously guarded',
    reason: 'Division by a dynamic value raises ZeroDivisionError.',
    suggestedTests: ['should handle divisor = 0 without crashing'],
  },
];
