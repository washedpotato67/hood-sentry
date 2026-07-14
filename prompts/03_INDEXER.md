# Prompt 03 — Reorg-Safe Indexer

Implement the live and historical indexer from `docs/ARCHITECTURE.md`.

Features:
- block polling/WebSocket head subscription;
- sequential block ingestion;
- block, transaction, receipt, and log persistence;
- parent-hash validation;
- reorg common-ancestor discovery and rollback/replay;
- checkpoint leases;
- gap scanner;
- ERC-20 Transfer/Approval decoding;
- contract creation detection;
- token metadata jobs;
- known application-contract event decoding;
- supported DEX factory/pool/swap adapters through configured verified addresses;
- raw-event dead-letter handling;
- head lag metrics.

Acceptance:
- restart does not duplicate facts;
- two workers cannot process the same checkpoint concurrently;
- synthetic reorg integration test passes;
- malformed token metadata cannot crash ingestion;
- decoded-data failure preserves raw log;
- indexer catches up after deliberate downtime;
- p95 new-event visibility target is measured.
