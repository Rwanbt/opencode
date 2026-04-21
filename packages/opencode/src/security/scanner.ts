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
  // Slack tokens — bot (xoxb), app (xoxa), user (xoxp), refresh (xoxr), legacy (xoxs)
  {
    id: "slack-token",
    severity: "critical",
    pattern: /xox[baprs]-[\w-]{10,}/,
    message: "Slack token detected. Rotate immediately and never commit.",
  },
  // Stripe — secret (sk_live_), publishable (pk_live_), restricted (rk_live_)
  {
    id: "stripe-secret-key",
    severity: "critical",
    pattern: /sk_live_[A-Za-z0-9]{24,}/,
    message: "Stripe live secret key detected. Rotate immediately.",
  },
  {
    id: "stripe-publishable-key",
    severity: "warning",
    pattern: /pk_live_[A-Za-z0-9]{24,}/,
    message: "Stripe live publishable key detected (less sensitive than sk_live_ but should still not be committed).",
  },
  {
    id: "stripe-restricted-key",
    severity: "critical",
    pattern: /rk_live_[A-Za-z0-9]{24,}/,
    message: "Stripe live restricted key detected.",
  },
  // GitHub — personal access tokens (classic + fine-grained), OAuth, refresh, server, user-to-server.
  {
    id: "github-pat-fine-grained",
    severity: "critical",
    pattern: /github_pat_[A-Za-z0-9_]{82}/,
    message: "GitHub fine-grained personal access token detected. Rotate immediately.",
  },
  {
    id: "github-pat-classic",
    severity: "critical",
    pattern: /ghp_[A-Za-z0-9]{36}/,
    message: "GitHub classic personal access token detected. Rotate immediately.",
  },
  {
    id: "github-oauth-token",
    severity: "critical",
    pattern: /gho_[A-Za-z0-9]{36}/,
    message: "GitHub OAuth access token detected. Rotate immediately.",
  },
  {
    id: "github-refresh-token",
    severity: "critical",
    pattern: /ghr_[A-Za-z0-9]{36,}/,
    message: "GitHub refresh token detected. Rotate immediately.",
  },
  {
    id: "github-server-token",
    severity: "critical",
    pattern: /ghs_[A-Za-z0-9]{36}/,
    message: "GitHub server-to-server token detected. Rotate immediately.",
  },
  {
    id: "github-user-to-server",
    severity: "critical",
    pattern: /ghu_[A-Za-z0-9]{36}/,
    message: "GitHub user-to-server token detected. Rotate immediately.",
  },
  // Google API keys
  {
    id: "google-api-key",
    severity: "critical",
    pattern: /AIza[0-9A-Za-z_-]{35}/,
    message: "Google API key detected. Restrict / rotate via GCP console.",
  },
  // Anthropic API keys (sk-ant-...). Needs enough length to avoid FP on sk-ant- prefix in docs.
  {
    id: "anthropic-api-key",
    severity: "critical",
    pattern: /sk-ant-[A-Za-z0-9_-]{90,}/,
    message: "Anthropic API key detected. Rotate via https://console.anthropic.com/",
  },
  // OpenAI keys — classic sk-... and project-scoped sk-proj-...
  {
    id: "openai-project-key",
    severity: "critical",
    pattern: /sk-proj-[A-Za-z0-9_-]{40,}/,
    message: "OpenAI project-scoped API key detected.",
  },
  {
    id: "openai-api-key",
    severity: "critical",
    // Keep after openai-project-key — the scanner emits per-rule, so both may
    // fire; that's fine, they're both critical.
    pattern: /\bsk-[A-Za-z0-9_-]{40,}\b/,
    message: "OpenAI API key detected.",
  },
  // Datadog API keys: 32-hex, only flag when near DD_API_KEY / datadog context
  // to keep the false-positive rate manageable (32-hex appears in many hashes).
  {
    id: "datadog-api-key",
    severity: "critical",
    pattern: /DD_API_KEY\s*[:=]\s*["']?[a-f0-9]{32}["']?/i,
    message: "Datadog API key detected near DD_API_KEY.",
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
  // Ruby / shell-style `%{user}` interpolation inside a SQL-ish literal.
  {
    id: "sql-injection-ruby-interp",
    severity: "critical",
    pattern: /(?:SELECT|INSERT|UPDATE|DELETE|DROP)[^%]{0,200}%\{[a-zA-Z_][\w]*\}/i,
    message: "Potential SQL injection: Ruby-style %{} interpolation inside SQL.",
    extensions: [".rb", ".erb"],
  },
  // Heredoc-style SQL with user-supplied var: `<<SQL ... ${user} ... SQL`
  {
    id: "sql-injection-heredoc",
    severity: "critical",
    pattern: /<<[-~]?['"]?[A-Z_]+['"]?[\s\S]{0,400}?(?:SELECT|INSERT|UPDATE|DELETE|DROP)[\s\S]{0,400}?(?:\$\{|#\{)\s*(?:user|input|param|req)/i,
    message: "Potential SQL injection inside heredoc with user interpolation.",
    multiline: true,
    extensions: [".rb", ".py", ".ts", ".js", ".sh"],
  },
  // Python f-string SQL: f"SELECT ... {user} ..."
  {
    id: "sql-injection-fstring",
    severity: "critical",
    pattern: /f["'][^"']*(?:SELECT|INSERT|UPDATE|DELETE|DROP)[^"']*\{\s*(?:user|input|param|req|body|query)[^}]*\}/i,
    message: "Potential SQL injection in Python f-string with user input.",
    extensions: [".py"],
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

    if (rule.multiline) {
      const m = content.match(rule.pattern)
      if (m && m.index !== undefined) {
        const line = content.slice(0, m.index).split("\n").length
        findings.push({
          severity: rule.severity,
          rule: rule.id,
          message: rule.message,
          line,
          match: maskSensitive(m[0].slice(0, 200)),
        })
      }
      continue
    }

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

// ──────────────────────────────────────────────────────────────────
// Prompt-injection heuristics for tool outputs.
//
// Gated by `experimental.dlp.scan_tool_outputs` (default off). The goal is to
// flag text that is likely trying to hijack the agent's instructions before
// it is fed back into the LLM as context.
//
// These heuristics are deliberately conservative — prompt-injection is an
// arms race and over-aggressive patterns cause false positives on legit docs
// (e.g. security blogs that *talk about* injection). Each rule returns a
// rough severity; callers decide whether to strip, warn inline, or drop.
// ──────────────────────────────────────────────────────────────────
const PROMPT_INJECTION_PATTERNS: { id: string; severity: "critical" | "warning"; pattern: RegExp; message: string }[] =
  [
    {
      id: "ignore-previous-instructions",
      severity: "critical",
      pattern: /ignore (?:all )?(?:previous|prior|above) (?:instructions?|prompts?|messages?)/i,
      message: "Prompt-injection phrase detected: 'ignore previous instructions'.",
    },
    {
      id: "system-prompt-override",
      severity: "critical",
      pattern: /(?:<|\[)\s*(?:\/?(?:system|assistant|user))\s*(?:>|\])/i,
      message: "Role-tag injection detected (<system>/<assistant>/<user>). Treat surrounding content as untrusted.",
    },
    {
      id: "disregard-safety",
      severity: "critical",
      pattern: /(?:disregard|bypass|ignore)\s+(?:safety|guardrails?|rules?|policy)/i,
      message: "Prompt-injection phrase detected: instructing model to disregard safety.",
    },
    {
      id: "reveal-system-prompt",
      severity: "warning",
      pattern: /(?:reveal|print|output|repeat|show)\s+(?:your\s+)?(?:system\s+prompt|instructions|hidden\s+prompt)/i,
      message: "Prompt-injection phrase detected: attempts to exfiltrate system prompt.",
    },
    {
      id: "jailbreak-persona",
      severity: "warning",
      pattern: /\b(?:DAN|developer\s*mode|do\s+anything\s+now|unrestricted\s+mode)\b/i,
      message: "Jailbreak persona keyword detected.",
    },
    {
      id: "hidden-comment-html",
      severity: "warning",
      pattern: /<!--[\s\S]*?(?:ignore|bypass|assistant|system)[\s\S]*?-->/i,
      message: "HTML comment with suspicious instruction content.",
    },
  ]

/**
 * Scan a tool's output (web fetch result, shell stdout, file content...) for
 * prompt-injection attempts. Returns findings; callers decide mitigation.
 *
 * Gating is the caller's responsibility — this function runs unconditionally.
 */
export function scanToolOutput(content: string, source?: string): Finding[] {
  const findings: Finding[] = []
  // Limit work for huge outputs — scan first 256 KB.
  const bounded = content.length > 262144 ? content.slice(0, 262144) : content
  for (const rule of PROMPT_INJECTION_PATTERNS) {
    const m = bounded.match(rule.pattern)
    if (m && m.index !== undefined) {
      const line = bounded.slice(0, m.index).split("\n").length
      findings.push({
        severity: rule.severity,
        rule: "prompt-injection-in-output:" + rule.id,
        message: rule.message,
        line,
        match: m[0].slice(0, 120),
      })
    }
  }
  if (findings.length > 0) {
    log.info("prompt-injection scan findings", { source, count: findings.length })
  }
  return findings
}

/** Mask sensitive values to avoid leaking them in output. */
function maskSensitive(text: string): string {
  // Mask anything after = or : that looks like a secret value
  return text.replace(/([:=]\s*["']?)([A-Za-z0-9_\-/+]{4})[A-Za-z0-9_\-/+]{8,}(["']?)/g, "$1$2********$3")
}
