# Backup and recovery runbook

PostgreSQL is the source of truth. Use managed encrypted automated backups with PITR, retention, and a quarterly clean-environment restore test. Record backup ID, start and end time, duration, migration version, row-count checks, canonical block checks, gaps, and follow-up actions.

Object storage uses versioning, retention locks, encryption, malware quarantine, and lifecycle rules. Store deployment manifests, ABIs, verified addresses, chain and launchpad registries, the official-token record, and feature flags in an encrypted offline copy. Redis is reconstructable and never stores unique truth.

Restore sequence: isolate the environment, restore PostgreSQL to a point in time, validate migrations, restore versioned evidence objects, rebuild Redis, replay indexed blocks, compare canonical hashes, then run smoke checks. Migration failures stop promotion and preserve the prior release. Corrupted derived data is deleted and recomputed from raw chain facts.

Run provider-outage, lost-queue, storage-recovery, indexer-replay, and database-restore drills. A failed validation blocks rollout.
