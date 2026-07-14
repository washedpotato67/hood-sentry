# Prompt 05 — Portfolio and Stock Tokens

Implement:
- native/ERC-20 balance aggregation;
- transaction and transfer activity;
- FIFO cost-basis lots;
- realized and unrealized P&L;
- confidence and missing-data handling;
- allowance tracking and spender classification;
- portfolio risk aggregation;
- canonical Stock Token seed/config;
- ERC-8056 multiplier reads;
- pending multiplier/effective time;
- `balanceOfUI` support;
- Chainlink price adapter;
- feed decimals, heartbeat, staleness, sequencer uptime, grace period, and oracle-pause checks;
- corporate-action events.

Acceptance:
- all arithmetic uses integer/bigint-safe methods;
- partial history is labelled;
- multiplier is never applied twice;
- stale/paused feed produces unavailable status, not zero;
- official/canonical classification uses contract address, not ticker;
- fixture tests cover dividend/split multiplier change.
