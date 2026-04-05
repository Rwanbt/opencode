/**
 * Data Loss Prevention (DLP) / AgentShield
 *
 * Scans content before it is sent to the LLM provider to prevent
 * accidental leakage of secrets, credentials, and sensitive data.
 * Redacts detected patterns and logs warnings.
 */
import { Log } from "../util/log"
import { Config } from "../config/config"

const log = Log.create({ service: "security.dlp" })

interface DLPRule {
  id: string
  pattern: RegExp
  replacement: string
  description: string
}

const RULES: DLPRule[] = [
  // ── API Keys & Tokens ──────────────────────────────────────────────
  {
    id: "aws-access-key",
    pattern: /\b(AKIA[0-9A-Z]{16})\b/g,
    replacement: "[REDACTED:AWS_KEY]",
    description: "AWS access key ID",
  },
  {
    id: "aws-secret-key",
    pattern: /\b([0-9a-zA-Z/+]{40})(?=\s|["']|$)/g,
    // Only match when preceded by common secret key indicators
    replacement: "[REDACTED:AWS_SECRET]",
    description: "AWS secret access key",
  },
  {
    id: "github-token",
    pattern: /\b(ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{82}|gho_[A-Za-z0-9]{36}|ghu_[A-Za-z0-9]{36}|ghs_[A-Za-z0-9]{36})\b/g,
    replacement: "[REDACTED:GITHUB_TOKEN]",
    description: "GitHub personal access token",
  },
  {
    id: "openai-key",
    pattern: /\b(sk-[A-Za-z0-9]{20,}T3BlbkFJ[A-Za-z0-9]{20,})\b/g,
    replacement: "[REDACTED:OPENAI_KEY]",
    description: "OpenAI API key",
  },
  {
    id: "anthropic-key",
    pattern: /\b(sk-ant-[A-Za-z0-9\-]{80,})\b/g,
    replacement: "[REDACTED:ANTHROPIC_KEY]",
    description: "Anthropic API key",
  },
  {
    id: "stripe-key",
    pattern: /\b(sk_(?:live|test)_[A-Za-z0-9]{24,})\b/g,
    replacement: "[REDACTED:STRIPE_KEY]",
    description: "Stripe API key",
  },
  {
    id: "slack-token",
    pattern: /\b(xox[bporas]-[A-Za-z0-9\-]{10,})\b/g,
    replacement: "[REDACTED:SLACK_TOKEN]",
    description: "Slack API token",
  },

  // ── Private Keys ───────────────────────────────────────────────────
  {
    id: "private-key",
    pattern: /(-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----)/g,
    replacement: "[REDACTED:PRIVATE_KEY]",
    description: "Private key block",
  },

  // ── Connection Strings ─────────────────────────────────────────────
  {
    id: "database-url",
    pattern: /\b((?:mysql|postgres|postgresql|mongodb|redis|amqp):\/\/[^\s"'`]{10,})\b/g,
    replacement: "[REDACTED:DATABASE_URL]",
    description: "Database connection string with credentials",
  },

  // ── JWT Tokens ─────────────────────────────────────────────────────
  {
    id: "jwt-token",
    pattern: /\b(eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_\-]+)\b/g,
    replacement: "[REDACTED:JWT]",
    description: "JSON Web Token",
  },

  // ── Generic High-Entropy Secrets ───────────────────────────────────
  {
    id: "env-secret",
    pattern: /(?<=(?:SECRET|PASSWORD|PASSWD|TOKEN|AUTH|CREDENTIAL|PRIVATE_KEY|API_KEY|ACCESS_KEY)\s*[:=]\s*["']?)([A-Za-z0-9+/=_\-]{32,})(?=["']?\s*$)/gim,
    replacement: "[REDACTED:SECRET]",
    description: "Environment variable containing a secret value",
  },
]

export interface DLPResult {
  /** The redacted text */
  text: string
  /** Number of redactions made */
  redactions: number
  /** Details of what was redacted */
  findings: { rule: string; description: string; count: number }[]
}

/** Scan and redact sensitive content from a single string. */
export function redact(text: string): DLPResult {
  let redacted = text
  let totalRedactions = 0
  const findings: DLPResult["findings"] = []

  for (const rule of RULES) {
    // Reset regex state (global flag)
    rule.pattern.lastIndex = 0
    const matches = redacted.match(rule.pattern)
    if (matches && matches.length > 0) {
      rule.pattern.lastIndex = 0
      redacted = redacted.replace(rule.pattern, rule.replacement)
      totalRedactions += matches.length
      findings.push({
        rule: rule.id,
        description: rule.description,
        count: matches.length,
      })
    }
  }

  return { text: redacted, redactions: totalRedactions, findings }
}

/** Check if DLP is enabled in config. */
export function isEnabled(): boolean {
  try {
    const cfg = Config.info()
    return cfg?.experimental?.dlp?.enabled === true
  } catch {
    return false
  }
}

/**
 * Scan an array of model messages and redact sensitive content.
 * Returns the redacted messages and a summary of findings.
 */
export function scanMessages(messages: { role: string; content: unknown }[]): {
  messages: typeof messages
  totalRedactions: number
  findings: DLPResult["findings"]
} {
  if (!isEnabled()) return { messages, totalRedactions: 0, findings: [] }

  let totalRedactions = 0
  const allFindings: DLPResult["findings"] = []

  const redactedMessages = messages.map((msg) => {
    if (typeof msg.content === "string") {
      const result = redact(msg.content)
      totalRedactions += result.redactions
      allFindings.push(...result.findings)
      return { ...msg, content: result.text }
    }
    if (Array.isArray(msg.content)) {
      const redactedParts = msg.content.map((part: any) => {
        if (part.type === "text" && typeof part.text === "string") {
          const result = redact(part.text)
          totalRedactions += result.redactions
          allFindings.push(...result.findings)
          return { ...part, text: result.text }
        }
        return part
      })
      return { ...msg, content: redactedParts }
    }
    return msg
  })

  if (totalRedactions > 0) {
    // Deduplicate findings
    const deduped = new Map<string, DLPResult["findings"][0]>()
    for (const f of allFindings) {
      const existing = deduped.get(f.rule)
      if (existing) existing.count += f.count
      else deduped.set(f.rule, { ...f })
    }
    const findings = [...deduped.values()]
    log.warn("DLP redacted sensitive content before sending to LLM", {
      totalRedactions,
      rules: findings.map((f) => `${f.rule}(${f.count})`).join(", "),
    })
    return { messages: redactedMessages, totalRedactions, findings }
  }

  return { messages, totalRedactions: 0, findings: [] }
}
