const DEFAULT_PATTERNS = [
  { id: 'private-key', re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g },
  { id: 'github-token', re: /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g },
  { id: 'openai-key', re: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
  { id: 'aws-access-key', re: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g },
  { id: 'bearer-token', re: /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}\b/gi },
  { id: 'connection-secret', re: /\b(?:postgres(?:ql)?|mysql|redis):\/\/[^\s:@]+:[^\s@]+@[^\s]+/gi }
];

const SENSITIVE_KEY = /token|secret|password|passwd|authorization|cookie|private.?key|client.?secret|access.?key|refresh.?token/i;

function scanString(value, patterns) {
  let text = String(value);
  const findings = [];
  for (const pattern of patterns) {
    pattern.re.lastIndex = 0;
    if (pattern.re.test(text)) findings.push(pattern.id);
    pattern.re.lastIndex = 0;
    text = text.replace(pattern.re, `[REDACTED:${pattern.id}]`);
  }
  return { value: text, findings };
}

export class SecretScanner {
  constructor({ patterns = DEFAULT_PATTERNS } = {}) { this.patterns = patterns; }

  sanitize(input) {
    const findings = [];
    const walk = (value, key = null, path = '$') => {
      if (key && SENSITIVE_KEY.test(key)) { findings.push({ type: 'sensitive-key', path }); return '[REDACTED]'; }
      if (typeof value === 'string') {
        const scanned = scanString(value, this.patterns);
        for (const type of scanned.findings) findings.push({ type, path });
        return scanned.value;
      }
      if (Array.isArray(value)) return value.map((item, index) => walk(item, null, `${path}[${index}]`));
      if (!value || typeof value !== 'object') return value;
      return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, walk(child, childKey, `${path}.${childKey}`)]));
    };
    return { value: walk(input), findings };
  }

  containsSecret(input) { return this.sanitize(input).findings.length > 0; }
}

export const defaultSecretScanner = new SecretScanner();
