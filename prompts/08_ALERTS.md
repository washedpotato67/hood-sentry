# Prompt 08 — Alerts and Notifications

Implement the alert engine and delivery adapters.

Rules:
- price;
- volume;
- liquidity;
- liquidity removal;
- whale transfer;
- holder concentration;
- ownership/admin/upgrade;
- mint/burn/pause/blacklist/fee/trading-toggle;
- deployer movement;
- new token/pool;
- Stock Token oracle/multiplier events.

Channels:
- in-app;
- browser push;
- Telegram;
- email;
- webhook.

Controls:
- deduplication;
- cooldown;
- finality preference;
- retries and dead-letter queue;
- signed timestamped webhooks;
- reorg corrections;
- delivery audit.

Acceptance:
- duplicate chain event sends once;
- retry is idempotent;
- webhook signature/replay tests pass;
- reorg correction is tested;
- Telegram linking cannot be hijacked;
- delivery failures are visible to users and operators.
