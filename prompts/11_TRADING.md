# Prompt 11 — Trading Integration

Implement non-custodial quote and swap adapters.

Do not assume protocol addresses. Add a verified protocol registry containing address, source, verification date, chain ID, and bytecode hash.

Support:
- quote retrieval;
- route normalization;
- allowance/permit requirements;
- exact-in initially and exact-out where provider supports it;
- slippage and deadline;
- transaction simulation;
- decoded intent;
- approval revocation;
- transaction state tracking;
- token risk warnings;
- provider failure and quote expiry.

For canonical Stock Tokens, use the supported RFQ/venue path rather than assuming an AMM pool exists.

Acceptance:
- wrong chain and stale quote are rejected;
- target/spender/selector are allowlisted;
- output minimum and deadline are enforced;
- unlimited approval is not default;
- small testnet and mainnet smoke transactions are documented;
- no user key reaches the server.
