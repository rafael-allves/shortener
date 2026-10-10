# Replica-set and load simulation

Run from the repository root:

```bash
# Build the image used by the runner without restarting the main API.
docker compose build api
# Starts the isolated MongoDB members and runs the simulation.
docker compose -f compose.replica.yaml run --rm simulation
# Stop the lab when finished; keeps its replica-set configuration volumes.
docker compose -f compose.replica.yaml down
```

The lab has its own network and volumes and publishes no ports. It initializes
three voting data-bearing members (`rsLab`), uses majority writes, and runs the
actual URL controllers against a uniquely named temporary database. The runner
removes that database on completion. The main application database is untouched.
The MongoDB lab containers remain running until `down` is executed.

The HTTP fixture intentionally omits rate limiting and Redis so the results
measure URL service/database behavior. It runs one API process and its load
generator in the same container. This does not test horizontal API scaling,
load balancing, host failure, network partitions, or production capacity.
All MongoDB members share one physical host; replication here demonstrates
protocol behavior rather than protection against host failure.

Workloads include distinct creation at concurrency 1/10/50, concurrent duplicate
creation, indexed lookup, pagination with exact counts, and writes overlapping
an explicit primary step-down. The script checks that duplicate creation stores
one document, a different primary is elected, and all expected documents remain.
The failover timing includes the write workload, not election time alone.

## Observed run: 2026-10-09 America/Sao_Paulo

| Workload | Requests | Concurrency | Requests/sec | p95 milliseconds |
| --- | ---: | ---: | ---: | ---: |
| Create | 200 | 1 | 149.5 | 9.35 |
| Create | 200 | 10 | 316.3 | 43.84 |
| Create | 200 | 50 | 339.1 | 519.34 |
| Duplicate create | 200 | 50 | 784.4 | 112.29 |
| Indexed lookup | 500 | 50 | 1067.9 | 63.35 |
| List with count | 200 | 20 | 559.2 | 45.65 |
| Writes during failover | 200 | 20 | 383.3 | 72.77 |

Duplicate creation produced one 201 and 199 replay responses. Failover moved
primary from mongo1 to mongo2. All 200 overlapping writes returned 201; the final
count was 801 documents. Workload plus election took approximately 538 ms.

This is a short exploratory run with small data, no separate warm-up, and shared
CPU/disk resources. Its throughput is not a production sizing number. Increased
concurrency raised latency much more than throughput in this sample; investigate
CPU, driver pool wait, disk, query plans and repeat measurements before assigning
a bottleneck to MongoDB. Replica sets do not distribute writes among primaries.

Next experiments: separate API/load-generator processes, a larger preloaded
dataset, repeated steady-state runs, deep offset versus cursor pagination, and
Redis-cached versus uncached lookups. Then simulate abrupt member termination
and retry behavior separately from this graceful step-down.
