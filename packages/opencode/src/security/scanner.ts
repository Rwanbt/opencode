/**
 * Vulnerability scanner for code modified by the agent.
 * Detects hardcoded secrets, injection patterns, and unsafe API usage.
 * Runs after edit/write operations and appends warnings to tool output.
 */
import { Log } from "../util/log"

const log = Log.create({ service: "security.scanner" })

export interface Finding {
  severity: "critical" | "warning" | "info"
  rule: string
  message: string
  line: number
  match: string
}

interface Rule {
  id: string
  severity: "critical" | "warning" | "info"
  pattern: RegExp
  message: string
  /** File extensions to apply this rule to (empty = all) */
  extensions?: string[]
  /** If true, the pattern matches the full file content (not per-line) */
  multiline?: boolean
}

const RULES: Rule[] = [
  // ── Hardcoded Secrets ──────────────────────────────────────────────
  {
    id: "hardcoded-api-key",
    severity: "critical",
    pattern: /(?:api[_-]?key|apikey)\s*[:=]\s*["'][A-Za-z0-9_\-]{20,}["']/i,
    message: "Hardcoded API key detected. Use environment variables instead.",
  },
  {
    id: "hardcoded-secret",
    severity: "critical",
    pattern: /(?:secret|password|passwd|token|auth_token|access_token|private_key)\s*[:=]\s*["'][^\s"']{8,}["']/i,
    message: "Hardcoded secret/password detected. Use environment variables or a secrets manager.",
  },
  {
    id: "aws-access-key",
    severity: "critical",
    pattern: /AKIA[0-9A-Z]{16}/,
    message: "AWS access key ID detected. Never commit AWS credentials.",
  },
  {
    id: "private-key-block",
    severity: "critical",
    pattern: /-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----/,
    message: "Private key detected in source code.",
  },
  {
    id: "jwt-token",
    severity: "warning",
    pattern: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_\-]+/,
    message: "JWT token detected in source code. Tokens should not be hardcoded.",
  },

  // ── Injection Vulnerabilities ──────────────────────────────────────
  {
    id: "sql-injection",
    severity: "critical",
    pattern: /(?:SELECT|INSERT|UPDATE|DELETE|DROP)\s+.*(?:\$\{|\+\s*(?:req|user|input|param|query|body))/i,
    message: "Potential SQL injection: string concatenation in SQL query. Use parameterized queries.",
    extensions: [".ts", ".js", ".mjs", ".cjs", ".py", ".rb", ".php", ".java", ".go"],
  },
  {
    id: "command-injection",
    severity: "critical",
    pattern: /(?:exec|execSync|spawn|system|popen|child_process)\s*\(\s*(?:`[^`]*\$\{|["'][^"']*["']\s*\+)/,
    message: "Potential command injection: user input in shell command. Sanitize inputs or use parameterized APIs.",
    extensions: [".ts", ".js", ".mjs", ".cjs", ".py", ".rb", ".php"],
  },
  {
    id: "eval-usage",
    severity: "warning",
    pattern: /\beval\s*\(/,
    message: "Use of eval() detected. Avoid eval() as it can execute arbitrary code.",
    extensions: [".ts", ".js", ".mjs", ".cjs", ".py"],
  },
  {
    id: "innerhtml-xss",
    severity: "warning",
    pattern: /\.innerHTML\s*=\s*(?!["'`]<)/,
    message: "Dynamic innerHTML assignment may lead to XSS. Use textContent or sanitize HTML.",
    extensions: [".ts", ".js", ".jsx", ".tsx", ".mjs"],
  },
  {
    id: "dangerously-set-innerhtml",
    severity: "warning",
    pattern: /dangerouslySetInnerHTML/,
    message: "dangerouslySetInnerHTML usage detected. Ensure input is sanitized.",
    extensions: [".tsx", ".jsx", ".js", ".ts"],
  },

  // ── Unsafe Patterns ────────────────────────────────────────────────
  {
    id: "cors-wildcard",
    severity: "warning",
    pattern: /(?:Access-Control-Allow-Origin|origin)\s*[:=]\s*["']\*["']/i,
    message: "CORS wildcard (*) allows any origin. Restrict to specific domains in production.",
  },
  {
    id: "http-no-tls",
    severity: "info",
    pattern: /["']http:\/\/(?!localhost|127\.0\.0\.1|0\.0\.0\.0|::1)/,
    message: "Non-TLS HTTP URL detected. Use HTTPS in production.",
  },
  {
    id: "disabled-security",
    severity: "warning",
    pattern: /(?:verify\s*[:=]\s*false|rejectUnauthorized\s*[:=]\s*false|NODE_TLS_REJECT_UNAUTHORIZED\s*[:=]\s*["']0["'])/,
    message: "TLS/SSL verification disabled. This allows man-in-the-middle attacks.",
  },
  {
    id: "unsafe-deserialization",
    severity: "warning",
    pattern: /(?:pickle\.loads?|yaml\.load\s*\((?!.*Loader)|unserialize|JSON\.parse\s*\(\s*(?:req|user|input|body))/i,
    message: "Potentially unsafe deserialization of untrusted input.",
    extensions: [".py", ".rb", ".php", ".ts", ".js"],
  },
]

/** Scan file content for security issues. */
export function scan(content: string, filePath: string): Finding[] {
  const findings: Finding[] = []
  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase()
  const lines = content.split("\n")

  for (const rule of RULES) {
    // Skip rules not applicable to this file type
    if (rule.extensions?.length && !rule.extensions.includes(ext)) continue

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const match = line.match(rule.pattern)
      if (match) {
        // Mask sensitive values in the match output
        const masked = maskSensitive(match[0])
        findings.push({
          severity: rule.severity,
          rule: rule.id,
          message: rule.message,
          line: i + 1,
          match: masked,
        })
      }
    }
  }

  if (findings.length > 0) {
    log.info("security scan findings", { file: filePath, count: findings.length })
  }

  return findings
}

/** Format findings as a markdown block for tool output. */
export function formatFindings(findings: Finding[], filePath: string): string {
  if (findings.length === 0) return ""

  const critical = findings.filter((f) => f.severity === "critical")
  const warnings = findings.filter((f) => f.severity === "warning")
  const info = findings.filter((f) => f.severity === "info")

  const sections: string[] = []
  sections.push(`\n\nSecurity scan detected ${findings.length} issue(s) in ${filePath}:`)

  if (critical.length > 0) {
    sections.push(
      `<security-critical>\n${critical.map((f) => `Line ${f.line}: [${f.rule}] ${f.message}\n  → ${f.match}`).join("\n")}\n</security-critical>`,
    )
  }
  if (warnings.length > 0) {
    sections.push(
      `<security-warning>\n${warnings.map((f) => `Line ${f.line}: [${f.rule}] ${f.message}\n  → ${f.match}`).join("\n")}\n</security-warning>`,
    )
  }
  if (info.length > 0) {
    sections.push(
      `<security-info>\n${info.map((f) => `Line ${f.line}: [${f.rule}] ${f.message}`).join("\n")}\n</security-info>`,
    )
  }

  if (critical.length > 0) {
    sections.push("⚠ CRITICAL security issues found. Please fix before committing.")
  }

  return sections.join("\n")
}

/** Mask sensitive values to avoid leaking them in output. */
function maskSensitive(text: string): string {
  // Mask anything after = or : that looks like a secret value
  return text.replace(/([:=]\s*["']?)([A-Za-z0-9_\-/+]{4})[A-Za-z0-9_\-/+]{8,}(["']?)/g, "$1$2********$3")
}
