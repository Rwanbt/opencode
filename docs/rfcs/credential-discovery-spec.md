# RFC: Multi-Provider Credential Discovery for OpenCode VS Code Extension

## Problem

Users run multiple AI CLIs (Claude Code, Codex/ChatGPT, Gemini CLI) authenticated
via their personal accounts (OAuth, not pay-per-token API keys). The OpenCode VS
Code extension needs to discover these existing credentials so users can switch
between models without re-authenticating or pasting API keys.

## Credential Map — Where Each CLI Stores Auth

### 1. Claude Code (Anthropic)

**Auth type**: OAuth (Pro/Max subscription via claude.ai)
**Storage**: JSON file on disk

| OS | Path |
|----|------|
| Windows | `%USERPROFILE%\.claude\.credentials.json` |
| macOS | `~/.claude/.credentials.json` |
| Linux | `~/.claude/.credentials.json` |

**Schema** (relevant fields only):
```jsonc
{
  "claudeAiOauth": {
    "accessToken": "sk-ant-oat01-...",      // OAuth access token (NOT an API key)
    "refreshToken": "sk-ant-ort01-...",      // For refreshing expired tokens
    "expiresAt": 1782092037922,              // Unix epoch ms
    "scopes": ["user:inference", ...],
    "subscriptionType": "max",               // "pro" | "max" | "free"
    "rateLimitTier": "default_claude_max_5x"
  }
}
```

**Detection logic**:
```typescript
interface ClaudeCredentials {
  accessToken: string
  refreshToken: string
  expiresAt: number
  subscriptionType: string
  rateLimitTier: string
}

function discoverClaude(): ClaudeCredentials | null {
  const home = process.env.USERPROFILE || process.env.HOME
  const credPath = path.join(home, '.claude', '.credentials.json')
  if (!fs.existsSync(credPath)) return null

  const raw = JSON.parse(fs.readFileSync(credPath, 'utf-8'))
  const oauth = raw.claudeAiOauth
  if (!oauth?.accessToken) return null

  return {
    accessToken: oauth.accessToken,
    refreshToken: oauth.refreshToken,
    expiresAt: oauth.expiresAt,
    subscriptionType: oauth.subscriptionType || 'unknown',
    rateLimitTier: oauth.rateLimitTier || 'unknown',
  }
}
```

**Key behaviors**:
- `accessToken` prefix `sk-ant-oat01-` = OAuth token. Does NOT work as `ANTHROPIC_API_KEY`.
- To use in a subprocess: write the entire `.credentials.json` to `~/.claude/.credentials.json`
  in the target environment, then call `claude --print "prompt"`.
- Token refresh: Claude Code CLI handles refresh automatically when the file exists.
- `subscriptionType` reveals the plan: `"free"`, `"pro"`, `"max"`.

---

### 2. Codex / ChatGPT (OpenAI)

**Auth type**: ChatGPT OAuth (free or Plus account via chatgpt.com)
**Storage**: JSON file on disk

| OS | Path |
|----|------|
| Windows | `%USERPROFILE%\.codex\auth.json` |
| macOS | `~/.codex/auth.json` |
| Linux | `~/.codex/auth.json` |

**Schema**:
```jsonc
{
  "auth_mode": "chatgpt",           // "chatgpt" (OAuth) or "api" (API key)
  "OPENAI_API_KEY": null,           // null when using OAuth
  "tokens": {
    "id_token": "eyJ...",           // JWT with user identity
    "access_token": "eyJ...",       // JWT for API calls (audience: api.openai.com/v1)
    "refresh_token": "rt.1.AAB...", // For refreshing expired tokens
    "account_id": "..."
  },
  "last_refresh": "2026-06-16T10:41:54.930Z"
}
```

**Detection logic**:
```typescript
interface CodexCredentials {
  authMode: 'chatgpt' | 'api'
  accessToken: string | null
  refreshToken: string | null
  apiKey: string | null
  plan: string   // extracted from JWT
  email: string  // extracted from JWT
}

function discoverCodex(): CodexCredentials | null {
  const home = process.env.USERPROFILE || process.env.HOME
  const authPath = path.join(home, '.codex', 'auth.json')
  if (!fs.existsSync(authPath)) return null

  const raw = JSON.parse(fs.readFileSync(authPath, 'utf-8'))
  if (raw.auth_mode === 'api' && raw.OPENAI_API_KEY) {
    return {
      authMode: 'api',
      accessToken: null,
      refreshToken: null,
      apiKey: raw.OPENAI_API_KEY,
      plan: 'api',
      email: '',
    }
  }

  if (raw.auth_mode === 'chatgpt' && raw.tokens?.access_token) {
    // Decode JWT payload (base64url, no verification needed for display)
    const payload = JSON.parse(
      Buffer.from(raw.tokens.access_token.split('.')[1], 'base64url').toString()
    )
    return {
      authMode: 'chatgpt',
      accessToken: raw.tokens.access_token,
      refreshToken: raw.tokens.refresh_token,
      apiKey: null,
      plan: payload?.['https://api.openai.com/auth']?.chatgpt_plan_type || 'unknown',
      email: payload?.['https://api.openai.com/profile']?.email || '',
    }
  }

  return null
}
```

**Key behaviors**:
- `access_token` is a JWT, NOT usable as `OPENAI_API_KEY` env var. Returns 401.
- To use in a subprocess: write the entire `auth.json` to `~/.codex/auth.json`
  in the target environment, then call `codex exec "prompt"`.
- `auth_mode: "chatgpt"` = OAuth free/Plus account. `auth_mode: "api"` = direct API key.
- JWT's `chatgpt_plan_type` reveals plan: `"free"`, `"plus"`, `"pro"`, `"team"`.
- Codex model selection is in `~/.codex/config.toml` → `model = "gpt-5.5"`.

---

### 3. Gemini CLI (Google)

**Auth type**: API key from AI Studio (OAuth deprecated June 2025 for individuals)
**Storage**: OS credential manager (NOT a plain file)

| OS | Mechanism | Key name |
|----|-----------|----------|
| Windows | Windows Credential Manager | `gemini-cli-api-key/default-api-key` |
| macOS | macOS Keychain | `gemini-cli-api-key/default-api-key` |
| Linux | libsecret / GNOME Keyring | `gemini-cli-api-key` (via `secret-tool`) |

**Blob format** (JSON inside the credential blob):
```jsonc
{
  "serverName": "default-api-key",
  "token": {
    "accessToken": "AQ.Ab8RN6..."    // the actual API key
  },
  "updatedAt": 1782063455431
}
```

**Detection logic (Windows — Node.js via native addon or PowerShell)**:
```typescript
// Option A: Shell out to PowerShell (simplest, Windows only)
function discoverGeminiWindows(): string | null {
  const script = `
    Add-Type -TypeDefinition @"
    using System; using System.Runtime.InteropServices; using System.Text;
    public class Cred {
      [DllImport("advapi32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
      public static extern bool CredRead(string t, int ty, int f, out IntPtr c);
      [DllImport("advapi32.dll")] public static extern bool CredFree(IntPtr c);
      [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
      public struct CR { public int F; public int T; public string TN; public string Co;
        public long LW; public int CBS; public IntPtr CB; public int P; public int AC;
        public IntPtr A; public string TA; public string UN; }
      public static string Get(string t) { IntPtr p;
        if(CredRead(t,1,0,out p)){CR c=(CR)Marshal.PtrToStructure(p,typeof(CR));
        byte[] b=new byte[c.CBS];Marshal.Copy(c.CB,b,0,c.CBS);CredFree(p);
        return Encoding.UTF8.GetString(b);}return null;}
    }
"@
    $r = [Cred]::Get("gemini-cli-api-key/default-api-key")
    if($r){($r|ConvertFrom-Json).token.accessToken}
  `
  try {
    const result = execSync(
      `powershell -NoProfile -Command "${script.replace(/"/g, '\\"')}"`,
      { encoding: 'utf-8', timeout: 5000 }
    ).trim()
    return result || null
  } catch { return null }
}

// Option B: Cross-platform via keytar (npm package, uses OS keychain)
// npm install keytar
import * as keytar from 'keytar'
async function discoverGeminiCrossPlatform(): Promise<string | null> {
  const blob = await keytar.getPassword('gemini-cli-api-key', 'default-api-key')
  if (!blob) return null
  try {
    const parsed = JSON.parse(blob)
    return parsed.token?.accessToken || null
  } catch { return null }
}
```

**Key behaviors**:
- Unlike Claude/Codex, the extracted value WORKS directly as `GEMINI_API_KEY` env var.
- Google deprecated OAuth for individual Gemini CLI users (error #3501). API key is now the
  only path for individuals.
- `~/.gemini/google_accounts.json` exists but contains only the old OAuth email, not the key.
- In a subprocess: `GEMINI_API_KEY=<key> gemini -p "prompt" --skip-trust`

---

### 4. Bonus: OpenAI API Key (direct, no CLI)

Some users have a standalone API key without Codex CLI.

| OS | Mechanism |
|----|-----------|
| All | Env var `OPENAI_API_KEY` (user or system scope) |
| All | `~/.openai/credentials` (rare) |

```typescript
function discoverOpenAIApiKey(): string | null {
  return process.env.OPENAI_API_KEY || null
}
```

### 5. Bonus: Anthropic API Key (direct, no CLI)

| OS | Mechanism |
|----|-----------|
| All | Env var `ANTHROPIC_API_KEY` |

```typescript
function discoverAnthropicApiKey(): string | null {
  return process.env.ANTHROPIC_API_KEY || null
}
```

---

## Unified Discovery Interface

```typescript
interface DiscoveredProvider {
  provider: 'anthropic' | 'openai' | 'google'
  authType: 'oauth' | 'api-key'
  plan: string                    // "free", "pro", "max", "plus", "api"
  email?: string
  models: string[]                // available models for this auth level
  credentialPath: string          // where the credential lives (for UI display)
  isExpired: boolean
  expiresAt?: number

  // How to use this credential in a subprocess
  inject: () => Record<string, string>   // env vars to set
  injectFiles: () => Array<{             // files to write
    path: string
    content: string
  }>
}

function discoverAll(): DiscoveredProvider[] {
  const providers: DiscoveredProvider[] = []

  // --- Anthropic (Claude) ---
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (apiKey) {
    providers.push({
      provider: 'anthropic', authType: 'api-key', plan: 'api',
      models: ['claude-sonnet-4-6', 'claude-opus-4-8', 'claude-haiku-4-5'],
      credentialPath: 'env:ANTHROPIC_API_KEY', isExpired: false,
      inject: () => ({ ANTHROPIC_API_KEY: apiKey }),
      injectFiles: () => [],
    })
  }

  const claude = discoverClaude()
  if (claude) {
    const modelsForPlan: Record<string, string[]> = {
      max:  ['claude-sonnet-4-6', 'claude-opus-4-8', 'claude-haiku-4-5'],
      pro:  ['claude-sonnet-4-6', 'claude-haiku-4-5'],
      free: ['claude-sonnet-4-6'],
    }
    providers.push({
      provider: 'anthropic', authType: 'oauth',
      plan: claude.subscriptionType,
      models: modelsForPlan[claude.subscriptionType] || modelsForPlan.free,
      credentialPath: '~/.claude/.credentials.json',
      isExpired: Date.now() > claude.expiresAt,
      expiresAt: claude.expiresAt,
      inject: () => ({}),  // OAuth token doesn't work as env var
      injectFiles: () => [{
        path: path.join(os.homedir(), '.claude', '.credentials.json'),
        content: fs.readFileSync(
          path.join(os.homedir(), '.claude', '.credentials.json'), 'utf-8'
        ),
      }],
    })
  }

  // --- OpenAI (Codex/ChatGPT) ---
  const oaiKey = process.env.OPENAI_API_KEY
  if (oaiKey) {
    providers.push({
      provider: 'openai', authType: 'api-key', plan: 'api',
      models: ['gpt-4.1', 'gpt-5.5', 'o3', 'o4-mini'],
      credentialPath: 'env:OPENAI_API_KEY', isExpired: false,
      inject: () => ({ OPENAI_API_KEY: oaiKey }),
      injectFiles: () => [],
    })
  }

  const codex = discoverCodex()
  if (codex) {
    providers.push({
      provider: 'openai', authType: codex.authMode === 'api' ? 'api-key' : 'oauth',
      plan: codex.plan, email: codex.email,
      models: codex.plan === 'free' ? ['gpt-4.1-mini'] : ['gpt-4.1', 'gpt-5.5', 'o3'],
      credentialPath: '~/.codex/auth.json',
      isExpired: false,  // JWT expiry is handled by Codex's refresh
      inject: () => codex.apiKey ? { OPENAI_API_KEY: codex.apiKey } : {},
      injectFiles: () => codex.authMode === 'chatgpt' ? [{
        path: path.join(os.homedir(), '.codex', 'auth.json'),
        content: fs.readFileSync(
          path.join(os.homedir(), '.codex', 'auth.json'), 'utf-8'
        ),
      }] : [],
    })
  }

  // --- Google (Gemini) ---
  const geminiKey = discoverGeminiWindows() // or discoverGeminiCrossPlatform()
  if (geminiKey) {
    providers.push({
      provider: 'google', authType: 'api-key', plan: 'free',
      models: ['gemini-2.5-pro', 'gemini-2.5-flash'],
      credentialPath: 'os-credential-manager:gemini-cli-api-key/default-api-key',
      isExpired: false,
      inject: () => ({ GEMINI_API_KEY: geminiKey }),
      injectFiles: () => [],
    })
  }

  return providers
}
```

---

## How to Pass Credentials to a Subprocess

Three patterns, depending on auth type:

### Pattern 1: Env Var (API keys, Gemini)
```typescript
// Works for: ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY
child_process.spawn('gemini', ['-p', prompt, '--skip-trust'], {
  env: { ...process.env, GEMINI_API_KEY: apiKey },
})
```

### Pattern 2: File Injection (OAuth — Claude, Codex)
```typescript
// Write the credential file, then call the CLI
// The CLI reads its own config dir and handles token refresh
for (const file of provider.injectFiles()) {
  fs.mkdirSync(path.dirname(file.path), { recursive: true })
  fs.writeFileSync(file.path, file.content)
}
child_process.spawn('claude', ['--print', prompt])
```

### Pattern 3: Hybrid (Docker/remote environments)
```typescript
// Pass file content as env var, write at startup via init script
const env = {
  ...provider.inject(),
  CLAUDE_CREDENTIALS_JSON: fs.readFileSync(credPath, 'utf-8'),
  CODEX_AUTH_JSON: fs.readFileSync(authPath, 'utf-8'),
}
// Init script in container writes these to the right paths
```

---

## Security Considerations

1. **Never log or display tokens** — show only prefix + `...` (e.g., `sk-ant-oat01-YjSx...`)
2. **File permissions** — credential files should be `0600` (owner read/write only)
3. **VS Code SecretStorage** — for any cached credentials, use `context.secrets` API
   (backed by OS keychain), never `context.globalState`
4. **Token refresh** — OAuth tokens expire. Claude: ~12h. Codex: ~12h. Read `expiresAt`
   and warn the user if expired. The CLIs auto-refresh when run interactively.
5. **No credential copying** — prefer spawning the original CLI which manages its own
   auth, rather than extracting and re-injecting tokens

---

## VS Code Extension Integration Points

```typescript
// Register a provider picker command
vscode.commands.registerCommand('opencode.switchProvider', async () => {
  const providers = discoverAll()
  const items = providers.map(p => ({
    label: `${p.provider} (${p.authType})`,
    description: `${p.plan} — ${p.models.join(', ')}`,
    detail: p.isExpired ? '⚠️ Token expired' : `via ${p.credentialPath}`,
    provider: p,
  }))
  const picked = await vscode.window.showQuickPick(items)
  if (picked) {
    // Store selection, use picked.provider.inject() when spawning
  }
})

// Status bar indicator showing active provider
const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right)
statusBar.text = '$(cloud) Claude Max'
statusBar.command = 'opencode.switchProvider'
statusBar.show()
```
