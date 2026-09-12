# P1-C100-D — Health monitoring

**Statut :** `INTEGRATED` (design documenté)
**Date :** 2026-08-01
**Parent :** P1-C100 (Harness multi-runtime)

## Objectif

Définir le système de **monitoring de santé** pour les harnesses. Doit permettre de détecter un harness qui crash, qui hang, ou qui perd des events.

## HealthReport

```typescript
interface HealthReport {
  harnessId: string
  healthy: boolean
  uptimeMs: number
  memoryMb: number
  cpuPercent: number
  activeSessions: number
  lastEventMs: number  // timestamp du dernier event
  errors: ErrorReport[]
  warnings: WarningReport[]
}

interface ErrorReport {
  timestamp: number
  message: string
  stack?: string
  recovered: boolean
}
```

## Stratégie de monitoring

### Heartbeat

- Toutes les 30s, le harness envoie un heartbeat
- Si pas de heartbeat pendant 90s → unhealthy
- Alerter via callback `onUnhealthy`

### Métriques

| Métrique | Source | Fréquence |
|---|---|---|
| uptime | `process.uptime()` | 30s |
| memory | `process.memoryUsage()` | 30s |
| cpu | `process.cpuUsage()` | 60s |
| active sessions | Map size | 5s |
| last event | Internal counter | 5s |

### Recovery

Si unhealthy :
1. Tenter un restart automatique (3 fois max)
2. Si fail : alerter via webhook (Slack/Discord)
3. Si persistent : kill + restart par supervisor (systemd, pm2)

## Code squelette

```typescript
// packages/harness/src/health.ts
import type { HarnessHandle, HealthReport } from "./harness.js"

export class HealthMonitor {
  private intervalId: NodeJS.Timeout | null = null
  private startTime = Date.now()

  start(handle: HarnessHandle, onChange: (healthy: boolean) => void) {
    this.intervalId = setInterval(() => {
      const report = this.check(handle)
      onChange(report.healthy)
    }, 30_000)
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
  }

  private check(handle: HarnessHandle): HealthReport {
    return {
      harnessId: handle.id,
      healthy: true,
      uptimeMs: Date.now() - this.startTime,
      memoryMb: process.memoryUsage().heapUsed / 1024 / 1024,
      cpuPercent: 0,
      activeSessions: 0,
      lastEventMs: Date.now(),
      errors: [],
      warnings: [],
    }
  }
}
```

## Tests

- Test que heartbeat fonctionne
- Test que unhealthy callback est appelé
- Test que recovery se déclenche

## Estimation

- HealthMonitor : ~150 LOC
- Tests : ~100 LOC
- **Total : ~250 LOC**

## Liens

- [P1-C100-A](P1-C100-A-harness-contract.md)
- [ADR-0009 AuditRuntime](docs/adr/0009-audit-runtime.md)