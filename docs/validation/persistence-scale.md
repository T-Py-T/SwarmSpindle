# Persistence scale measurement — 2026-09-07

The bounded local benchmark in tooling/swarm-scale.ts completed in 7.325 seconds. It used synthetic data and made zero provider requests. Both scenarios created 30 agents, performed 30 reservation/settlement pairs, retained three 256 KiB artifact revisions, appended 200 traces, and verified all 297 resulting events, the reference bytes, revision history, roster, and money conservation.

| Stable reference | Scenario time | Trace append p95 / maximum | Status read p95 | Event tail p95 | Process RSS at finish |
| --- | --- | --- | --- | --- | --- |
| 1 MiB | 1.800 s | 9.88 / 12.12 ms | 1.54 ms | 2.12 ms | 319 MB |
| 5 MiB | 5.504 s | 21.22 / 32.60 ms | 4.67 ms | 4.41 ms | 872 MB |

Both integrity checks passed. Peak observed SQLite/WAL/SHM sizes were 11.10 MB and 25.17 MB; these are snapshots, not cumulative SSD writes. RSS is process-level memory, not an isolated per-scenario allocation measurement. The initial benchmark attempt failed immediately because its placeholder model ID was rejected by the exact-model schema; correcting only that fixture allowed measurement.

Decision: retain the transactional aggregate for the initial integration rather than rewrite storage before measuring real mission behavior. These small-history results meet the review's suggested latency gates. They do not establish performance with thousands of large trace payloads or hundreds of artifact revisions. Full-aggregate serialization and historical-content validation remain a known scaling limit; the live runs must be observed for event-loop lag and growing memory. Immutable content and indexed append-only events are the next justified improvement if that limit becomes material.
