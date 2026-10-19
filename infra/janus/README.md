# DAP aggregators for creator analytics (Janus)

Two separate Docker Compose stacks for Tier 2 creator analytics ("how people found
you", `docs/ANALYTICS.md`, `docs/ANALYTICS_IMPLEMENTATION.md`):

| Stack | Who runs it | What it is |
|---|---|---|
| `leader/` | the creator's home instance | Janus aggregator (DAP endpoint for uploads and collection), aggregation job creator and driver, collection job driver, garbage collector, Postgres 15 |
| `helper/` | **an independent operator**: Divvi Up, a partner nonprofit, or an unrelated paired instance | Janus aggregator (in DAP-09 the helper is one process the leader calls), Postgres 15 |

**The helper must not be run by the leader's operator**, nor share a host, admin, cloud
account or database with it. Each viewer report is split into two secret shares, one
for each aggregator. If one party holds both, it can add them back together and read
every viewer's channel. These are two stacks, not one, to make that hard to do by
accident.

Janus [divviup/janus](https://github.com/divviup/janus) (MPL-2.0, run unmodified as a
separate program) **0.7.143**, branch `release/0.7`, implements
[draft-ietf-ppm-dap-09](https://datatracker.ietf.org/doc/draft-ietf-ppm-dap/09/). That is
the newest draft the TypeScript client (`@divviup/dap` 0.9.1) speaks; see
`docs/ANALYTICS_IMPLEMENTATION.md`, "Protocol versions".

| File | What it is |
|---|---|
| `leader/compose.yaml`, `helper/compose.yaml` | the stacks. Images pinned by digest; read-only root filesystems, uid 65534, no capabilities, `no-new-privileges`; Postgres on an `internal: true` network |
| `*/config/*.yaml` | Janus component configs (based on Janus `docs/samples/basic_config`) |
| `*/.env.example` | per-deployment secrets: `PGPASSWORD`, `DATASTORE_KEYS`; never share them between the two stacks |
| `Caddyfile` | optional TLS front (`--profile tls`), no access log |
| `scripts/new-task.mjs` | makes one creator's task: the two task YAMLs, the creator's collector credentials and the public task config |
| `test/*.e2e.yaml` | local-only overrides used by `packages/analytics/test/e2e.test.ts` |

Images (pinned when written, 2026-10-19):

| Image | Digest |
|---|---|
| `us-west2-docker.pkg.dev/divviup-artifacts-public/janus/janus_aggregator:0.7.143` (one binary for aggregator, job drivers, `janus_cli`, chosen by `BINARY`) | `sha256:a3bd90477d202ffb990b2b1f813e283da7b473121b3d3c2c5ef534f0b726a293` |
| `.../janus_db_migrator:0.7.143` (sqlx + migrations) | `sha256:bde44db3290fe8c17c26989783729ab073f6d05f99efe14a032701759495a1fa` |
| `.../janus_interop_collector:0.7.143` (tests only) | `sha256:4ca4a247fdfc3985137f8f1cb533ae57b15d85a408f9c177024be49d0b1b857e` |
| `postgres:15-alpine` (15.19) | `sha256:f7d23353e1b15400d22ebe31189f4d314b87a4c129cc400c8c2d8d4ca127bf81` |
| `caddy:2.11.7-alpine` | `sha256:d8542f48d34a9cf4e4c11a478865229840e87e4c96ea3f439101f31a5d35f75f` |

Set `DOCKERHUB=mirror.gcr.io` in `.env` to pull the Postgres image through Google's
Docker Hub mirror; the digest is the same.

## Running a leader (creator's instance)

```sh
cd infra/janus/leader
cp .env.example .env && $EDITOR .env      # PGPASSWORD, DATASTORE_KEYS, LEADER_DOMAIN, ACME_EMAIL
docker compose --profile tls up -d --wait  # or without the profile behind your own TLS proxy (127.0.0.1:9001)
```

## Running a helper (independent operator)

```sh
cd infra/janus/helper
cp .env.example .env && $EDITOR .env      # its OWN PGPASSWORD, DATASTORE_KEYS, HELPER_DOMAIN
docker compose --profile tls up -d --wait
```

## Adding a creator's task

1. The creator makes a collector key and task (on their own machine, or the instance does
   it for them; the collector private key must end up only with the creator):

   ```sh
   node infra/janus/scripts/new-task.mjs --name alice --creator alice@videos.example \
     --leader-url https://dap.videos.example/ --helper-url https://helper.example.org/ \
     --helper-operator "Example Helper Org" --epsilon 1
   ```

   Output: `leader/tasks/alice.leader.yaml`, `helper/tasks/alice.helper.yaml`,
   `creator/alice/collector.secret.json` and `collector-credential.json` (0600, the
   creator's only), and `creator/alice/task-config.json` (public).
   All of these are git-ignored.

2. Leader: `docker compose run --rm cli provision-tasks --generate-missing-parameters /tasks/alice.leader.yaml`.
3. Send `alice.helper.yaml` to the helper operator over an encrypted channel and delete
   your copy. It holds the shared VDAF verify key and the hash of the leader's auth token.
   The helper runs the same `provision-tasks` command in its stack.
4. `hpke_keys: []` plus `--generate-missing-parameters` makes **each aggregator generate
   its own HPKE keypair in its own database**. No HPKE private key passes between
   operators or through the script.
5. The task files are written 0600. The containers run as uid 65534, so make them readable
   to the container (`chmod 644`, or `chown 65534`) for the provisioning run, then remove them.
6. The job creator reloads tasks every 5 minutes (`tasks_update_frequency_s: 300`), or
   immediately on `docker compose restart aggregation_job_creator`.
7. The creator publishes `task-config.json` (see `packages/analytics/src/config.ts`): as
   a kind 30078 Nostr event with `d` = `match-feed/discovery-task/v1`, or at an https URL on
   their instance named in the channel description (`discovery-stats: https://...`).

What the task sets, and why:

| Parameter | Value | Why |
|---|---|---|
| VDAF | `Prio3Histogram`, length 8, chunk length 3 | one-hot over the 8 channels; Prio3's proof rejects anything not exactly one-hot |
| `dp_strategy` | `PureDpDiscreteLaplace`, epsilon from `--epsilon` (default 1) | **Janus adds the noise natively**: each aggregator adds discrete Laplace noise (sensitivity 2) to its own aggregate share |
| `time_precision` | 2,419,200 s (28 days) | reports carry only their window; a batch is one window |
| `min_batch_size` | 20 (minimum) | Janus refuses to collect a smaller batch |
| `max_batch_query_count` | 1 | a batch is aggregated once; re-asking returns the same noisy result (verified in the e2e test) |
| `query_type` | `TimeInterval` | batches are windows |
| `report_expiry_age` | 90 days | reports for window W arrive up to 6 days after it closes, timestamped at its start |
| `tolerable_clock_skew` | 300 s | |

## Collecting (the creator)

Janus's `collect` tool is in the `janus_tools` crate, which is not on crates.io. Build it
from the release branch:

```sh
git clone -b release/0.7 https://github.com/divviup/janus && cd janus
cargo build --release -p janus_tools --bin collect
```

Then, for the window that closed at least 7 days ago (`START` is a multiple of 2419200):

```sh
./target/release/collect --task-id "$TASK_ID" --leader https://dap.videos.example/ \
  --collector-credential-file creator/alice/collector-credential.json \
  --vdaf histogram --length 8 \
  --batch-interval-start "$START" --batch-interval-duration 2419200 \
  | node --experimental-strip-types packages/analytics/bin/discovery-report.ts
```

`collector-credential.json` (Janus `PrivateCollectorCredential` format: HPKE keypair plus
Bearer token) is written by `new-task.mjs` when it generated the collector key. `collect`
needs no chunk length for Prio3Histogram (unsharding does not use it).
`discovery-report.ts` maps negative noisy counts back from the field, hides anything under
20 and prints the shares; `--publishable` prints only what may be published, `--json` all of it.

## Local end-to-end test

```sh
cd packages/analytics && npm run test:e2e
```

Brings both stacks up as separate compose projects (`mf-e2e-leader`, `mf-e2e-helper`) on
host ports 19001/19002, joins them with a Docker network standing in for the internet
(`mf-dap-e2e`), runs Janus's interop collector on 19003, provisions a task, uploads
synthetic reports through `packages/analytics`, collects, checks the noise and thresholds,
and tears everything down (`KEEP_STACKS=1` keeps it).

## Operations

- **Backups:** the databases hold report shares until garbage collection (90 days), then
  only aggregates. Back up with `DATASTORE_KEYS` kept separately (the sensitive columns are
  encrypted with them). Losing them loses the task's state.
- **Logs:** Janus logs no client IPs at `info`. Caddy keeps no access log.
- **Key rotation:** HPKE keys are per task here. To rotate, re-provision with a new keypair
  appended; clients refetch on `outdatedConfig`.
- **Updating:** stay on `release/0.7` (DAP-09) until the browser client supports a newer
  draft (see `docs/ANALYTICS_IMPLEMENTATION.md`). Bump tag and digest together; Janus
  migrations run on start (`migrate` service).
