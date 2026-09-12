# Team V3 Performance Validation — 2026-07-29

Status: **LOCAL PERFORMANCE GATES PASSED — REAL PROVIDER LATENCY NOT CERTIFIED**

Measured by `bun test test/team --timeout 30000` on the current Windows checkout:

| Gate | Measurement | Result |
|---|---:|---|
| K01 scheduling, 1,000 tasks, cap 4, p95 | 1.142 ms | PASS |
| K01 scheduling, 4,096 tasks, cap 8, p95 | 1.808 ms | PASS |
| K02 scheduling, 500 tasks, p95 | 1.944 ms | PASS |
| K03 concurrency apply, p95 | 0.100 us | PASS |
| K02 deadlock simulation | 100,000 cases in 261.97 ms | PASS |

The full Team suite completed 814 tests in 52.15 s. The CLI subprocess E2E completed 12 scenarios in 64.17 s on Windows; most of that cost is process startup.

Not measured here: provider network latency, real model throughput, desktop frame latency under a large live run, mobile device performance, and sustained multi-hour soak. These remain release-environment gates.
