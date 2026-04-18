import type { Category, RiskLevel } from '../types/index.js';

export interface PatternRule {
  id: string;
  category: Category;
  level: RiskLevel;
  /** Applies only to these language IDs (omit = all). */
  languages?: string[];
  /** Regex. Multi-line not used; patterns are per-line for speed. */
  pattern: RegExp;
  /** Optional negative regex — if matches, skip. */
  notPattern?: RegExp;
  /** If true, matches on lines inside a try/catch block are suppressed. */
  blockAware?: boolean;
  title: string;
  reason: string;
  suggestedTests?: string[];
  suggestedFix?: string;
}

const JS_LIKE = ['typescript', 'javascript'];

export const ASYNC_RULES: PatternRule[] = [
  {
    id: 'async/unawaited-promise-method',
    category: 'async', level: 'HIGH', languages: JS_LIKE,
    pattern: /^[^\/]*(?<![\w.])(?:fetch|axios\.(?:get|post|put|delete|patch)|api\.\w+|trpc\.\w+|supabase\.\w+)\s*\(/,
    notPattern: /(?:await|return|\.then|\.catch|yield|Promise\.all|=\s*$)/,
    title: 'Possible unawaited network call',
    reason: 'Async call result is not awaited, returned, or chained — errors and timing will be lost.',
    suggestedTests: [
      'should handle network call failure (rejected promise)',
      'should not fire-and-forget — verify caller awaits the response',
    ],
  },
  {
    id: 'async/then-without-catch',
    category: 'async', level: 'MEDIUM', languages: JS_LIKE,
    pattern: /\.then\s*\(/,
    notPattern: /\.catch\s*\(|\.finally\s*\(/,
    title: '.then without .catch',
    reason: 'Rejected promises will surface as unhandled rejections and may crash the process.',
    suggestedTests: ['should handle promise rejection path'],
  },
  {
    id: 'async/try-without-catch-network',
    category: 'async', level: 'MEDIUM', languages: JS_LIKE,
    pattern: /await\s+(?:fetch|axios|api\.|trpc\.|supabase\.)/,
    notPattern: /try\s*\{|catch\s*\(/,
    blockAware: true,
    title: 'Awaited network call without visible try/catch',
    reason: 'Network rejections in this hunk are not wrapped — surface errors and loading/error states may leak.',
    suggestedTests: [
      'should surface error state on 4xx/5xx',
      'should not get stuck in loading state after rejection',
    ],
  },
  {
    id: 'async/settimeout-no-cleanup',
    category: 'async', level: 'MEDIUM', languages: JS_LIKE,
    pattern: /setTimeout\s*\(|setInterval\s*\(/,
    notPattern: /clearTimeout|clearInterval|return\s*\(\s*\)\s*=>/,
    title: 'Timer without visible cleanup',
    reason: 'Unclean timers cause leaks, stale state, and double-fire bugs on unmount or re-run.',
    suggestedTests: ['should clear timer on unmount / when inputs change'],
  },
  {
    id: 'async/retry-without-cap',
    category: 'async', level: 'HIGH', languages: JS_LIKE,
    pattern: /retry|backoff|while\s*\(.*retr/i,
    notPattern: /maxRetries|retries\s*<|attempts\s*<|limit|cap/,
    title: 'Retry loop without visible cap',
    reason: 'Retries without a max will burn quota, hang UIs, and mask the real failure.',
    suggestedTests: [
      'should stop retrying after N attempts',
      'should surface exhausted-retry error to caller',
    ],
  },
];

export const STATE_RULES: PatternRule[] = [
  {
    id: 'state/useeffect-missing-deps',
    category: 'state', level: 'MEDIUM', languages: JS_LIKE,
    pattern: /useEffect\s*\(\s*(?:async\s*)?\(\s*\)\s*=>\s*\{/,
    notPattern: /\]\s*\)\s*$|,\s*\[/,
    title: 'useEffect without visible dependency array',
    reason: 'Effects without deps run every render, causing extra network calls or flicker.',
    suggestedTests: ['should not trigger side effect on every render'],
  },
  {
    id: 'state/optimistic-without-rollback',
    category: 'state', level: 'HIGH', languages: JS_LIKE,
    pattern: /optimistic|setQueryData|updateCache|mutate\s*\(/i,
    notPattern: /rollback|onError|revert|setPrevious|invalidate/,
    title: 'Optimistic update without visible rollback',
    reason: 'Optimistic updates without rollback leave local and server state diverged on failure.',
    suggestedTests: [
      'should roll back optimistic update on mutation error',
      'should not leave orphaned optimistic entries after refetch',
    ],
  },
  {
    id: 'state/persistence-write-no-read-guard',
    category: 'state', level: 'MEDIUM', languages: JS_LIKE,
    pattern: /(?:AsyncStorage|localStorage|SecureStore|MMKV)\.(?:setItem|set)\s*\(/,
    notPattern: /JSON\.stringify|try\s*\{/,
    title: 'Persistence write without stringify / try-catch',
    reason: 'Raw writes to storage corrupt state and crash on read-back when types mismatch.',
    suggestedTests: [
      'should recover from corrupted persisted state',
      'should handle storage quota / write failure',
    ],
  },
];

export const API_CONTRACT_RULES: PatternRule[] = [
  {
    id: 'api/unsafe-deep-access',
    category: 'api-contract', level: 'MEDIUM', languages: JS_LIKE,
    pattern: /\b(?:data|res|response|result|body|payload)\.[\w]+\.[\w]+\.[\w]+/,
    notPattern: /\?\.[\w]+\.[\w]+|\?\.[\w]+\?\.[\w]+/,
    title: 'Unsafe deep property access without optional chaining',
    reason: 'Deep paths on API responses crash the caller when any intermediate field is null/missing.',
    suggestedTests: [
      'should handle missing nested field in API response',
      'should handle partial API response with null inner object',
    ],
  },
  {
    id: 'api/array-index-no-length',
    category: 'api-contract', level: 'MEDIUM', languages: JS_LIKE,
    pattern: /\b(?:items|list|results|data|rows|entries)\[0\]/,
    notPattern: /\.length\s*(?:>|>=)\s*0|\?\./,
    title: 'Index [0] without length guard',
    reason: 'Empty list response returns undefined; downstream code often assumes truthy.',
    suggestedTests: ['should handle empty list response'],
  },
  {
    id: 'api/json-parse-no-try',
    category: 'api-contract', level: 'MEDIUM', languages: JS_LIKE,
    pattern: /JSON\.parse\s*\(/,
    notPattern: /try\s*\{|catch\s*\(|\|\|\s*\{/,
    title: 'JSON.parse without try/catch',
    reason: 'Malformed responses throw SyntaxError and crash the handler.',
    suggestedTests: ['should handle malformed JSON response'],
  },
  {
    id: 'api/fetch-no-status-check',
    category: 'api-contract', level: 'MEDIUM', languages: JS_LIKE,
    pattern: /await\s+fetch\s*\(/,
    notPattern: /\.ok|response\.status|res\.status/,
    title: 'fetch without status check',
    reason: 'fetch does not throw on 4xx/5xx — unchecked responses will parse error bodies as data.',
    suggestedTests: [
      'should handle 401 unauthorized',
      'should handle 403 forbidden',
      'should handle 429 rate limited',
      'should handle 500 server error',
    ],
  },
];

export const SECURITY_RULES: PatternRule[] = [
  {
    id: 'security/eval',
    category: 'security', level: 'CRITICAL', languages: JS_LIKE,
    pattern: /\beval\s*\(|new\s+Function\s*\(/,
    title: 'Dynamic code execution',
    reason: 'eval / new Function enables code injection when inputs are attacker-controlled.',
    suggestedFix: 'Replace with a parser or explicit switch over allowed operations.',
  },
  {
    id: 'security/dangerous-html',
    category: 'security', level: 'HIGH', languages: JS_LIKE,
    pattern: /dangerouslySetInnerHTML|\.innerHTML\s*=/,
    title: 'Dangerous HTML injection sink',
    reason: 'Unsanitized HTML insertion is an XSS vector.',
    suggestedTests: ['should sanitize HTML from untrusted sources'],
  },
  {
    id: 'security/secret-in-log',
    category: 'security', level: 'HIGH', languages: JS_LIKE,
    pattern: /console\.(?:log|info|warn|error|debug)\s*\([^)]*\b(?:token|password|secret|api[_-]?key|authorization|refresh[_-]?token|session|cookie|jwt)\b/i,
    title: 'Potential secret in log output',
    reason: 'Logging credentials leaks them to log aggregators, crash reporters, and terminal history.',
    suggestedFix: 'Redact the field or log a fingerprint (last 4 chars) instead.',
  },
  {
    id: 'security/plain-token-storage',
    category: 'security', level: 'HIGH', languages: JS_LIKE,
    pattern: /(?:localStorage|AsyncStorage)\.(?:setItem|set)\s*\(\s*['"][^'"]*(?:token|secret|password|key|jwt)[^'"]*['"]/i,
    title: 'Sensitive value in plaintext storage',
    reason: 'localStorage / AsyncStorage are not encrypted — tokens should live in SecureStore/Keychain.',
    suggestedFix: 'Move to SecureStore / Keychain / EncryptedStorage.',
  },
  {
    id: 'security/shell-injection',
    category: 'security', level: 'CRITICAL', languages: JS_LIKE,
    pattern: /\bexec\s*\(\s*[`'"][^`'"]*\$\{/,
    title: 'Shell exec with interpolated value',
    reason: 'String-interpolated shell commands are classic injection vectors.',
    suggestedFix: 'Use spawn with an args array, never a shell string.',
  },
  {
    id: 'security/sql-string-concat',
    category: 'security', level: 'CRITICAL', languages: JS_LIKE,
    pattern: /(?:SELECT|INSERT|UPDATE|DELETE)\s[^'"`]*['"`]\s*\+\s*\w+|`[^`]*\$\{[^}]+\}[^`]*(?:SELECT|INSERT|UPDATE|DELETE)/i,
    title: 'SQL built via string concatenation',
    reason: 'Concatenated SQL is a direct injection vector. Use parameterised queries.',
    suggestedFix: 'Use bind parameters (?, $1) rather than string concat.',
  },
];

export const EDGE_CASE_RULES: PatternRule[] = [
  {
    id: 'edge/division',
    category: 'edge-case', level: 'MEDIUM', languages: JS_LIKE,
    pattern: /[\w)\]]\s*\/\s*[a-zA-Z_]\w*/,
    notPattern: /\/\/|\/\*|<\/|\/>/,
    title: 'Division by variable — zero path not obviously guarded',
    reason: 'Division / modulo by a dynamic value can produce Infinity, NaN, or crash.',
    suggestedTests: ['should handle divisor = 0 without crashing'],
  },
  {
    id: 'edge/parse-int-no-nan',
    category: 'edge-case', level: 'LOW', languages: JS_LIKE,
    pattern: /parseInt\s*\(|parseFloat\s*\(|Number\s*\(/,
    notPattern: /isNaN|Number\.isNaN|\?\?/,
    title: 'Number parse without NaN guard',
    reason: 'parseInt/parseFloat silently return NaN, which poisons downstream arithmetic.',
    suggestedTests: ['should handle unparseable input (returns NaN)'],
  },
  {
    id: 'edge/non-null-assertion',
    category: 'edge-case', level: 'MEDIUM', languages: ['typescript'],
    pattern: /[\w)\]]!(?:\.|\[|\()/,
    notPattern: /!==|!=|!\s*$/,
    title: 'Non-null assertion (!) used',
    reason: 'Non-null assertion lies to the type system — real null values will throw at runtime.',
    suggestedTests: ['should handle null/undefined on this path without non-null assertion'],
  },
  {
    id: 'edge/array-map-possibly-null',
    category: 'edge-case', level: 'LOW', languages: JS_LIKE,
    pattern: /\b(?:items|list|results|data|rows|entries|children)\.(?:map|filter|forEach|reduce|some|every)\s*\(/,
    notPattern: /\?\.(?:map|filter|forEach|reduce|some|every)|Array\.isArray|&&\s*\w+\.(?:map|filter)/,
    title: 'Array method on possibly-null value',
    reason: 'If the API omits the field, iterating throws TypeError.',
    suggestedTests: [
      'should render empty state when list is missing',
      'should handle null/undefined list response',
    ],
  },
];

export const ALL_PATTERN_RULES: PatternRule[] = [
  ...ASYNC_RULES,
  ...STATE_RULES,
  ...API_CONTRACT_RULES,
  ...SECURITY_RULES,
  ...EDGE_CASE_RULES,
];
