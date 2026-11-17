Stage 5 performance tuning
==========================

Production changes are limited to git-store.ts and git-http.ts. main.ts is unchanged.

Receive-pack now validates only the new portion of the reachable object graph.
A repository-local WeakSet records object identities only after the entire traversal
succeeds. Missing objects still reject the push, failed traversals do not populate
the cache, and ref/fast-forward checks still execute for every command. Objects
enter the store through their canonical Git hash and are immutable. Metadata does
not keep discarded objects alive. This removes repeated full-history traversal
from sequential pushes without changing closure() used for fetch negotiation.

Upload-pack retains one successful response per repository, capped at 1 MiB with
request keys capped at 8 KiB. Keys include exact request bytes and protocol version;
object-store growth invalidates the response. Advertisements and ls-refs remain
live. The cached bytes include all shallow/unshallow and sideband framing, so hits
are byte-identical to generation. Repository deletion releases its cache.

Reproduce:

    node --experimental-strip-types tests/stage4.mts
    node --experimental-strip-types tests/stage5.mts
    node --experimental-strip-types tests/perf.mts

The performance harness imports the kit's program/env/src/bench.ts directly and
uses its exact payloads, warmups, rounds, concurrency and clients. An in-process
HTTP adapter replaces fetch because this sandbox rejects listen() with EPERM.
Thus these are comparative server-path timings, not official network timings or
predicted scores. PERF_APP_MODULE can select an absolute baseline app.ts path.
Baseline files were extracted from HEAD into /tmp/stage5-baseline before changes.
Three alternating baseline/current runs, each with three kit rounds, yielded the
following medians of run p50 values (milliseconds per workload round):

| Workload | Baseline run p50s | Current run p50s | Median before | Median after |
| --- | --- | --- | --- | --- |
| push, 200 sequential | 522.200, 371.947, 407.901 | 121.809, 153.997, 121.837 | 407.901 | 121.837 |
| clone, 50 concurrent | 27.061, 24.889, 34.780 | 21.162, 18.484, 19.810 | 27.061 | 19.810 |
| read, 2000 sequential | 92.438, 144.708, 98.601 | 92.945, 129.800, 94.489 | 98.601 | 94.489 |
| write, 200 sequential | 10.111, 10.950, 9.991 | 10.279, 11.842, 15.656 | 10.111 | 11.842 |

Push improves about 70%, clone about 27%. Read/write production paths were not
changed; the small write workload remains noisy and showed a 1.731 ms increase
in this sample. Official grade-local is needed to assess actual network scores.
No JSON/HTTP micro-optimizations were added.

Regression: 120/120 conformance checks and extra Stage 4 wire checks pass.
Stage 5 checks cover failed validation retries, reuse of a validated ancestor,
fetch cache hits/invalidation across depths and protocol versions, and pack
checksum failure atomicity. Baseline and optimized Stage 4 response replay SHA256:

    1033409883cd9fca744d62b11d90385753624f02330476c0b15f3bce78727445

No wall-clock or random values were introduced into stored or returned data;
all runtime dependencies remain Node standard library only.
