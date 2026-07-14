# API Specification

Base path: `/v1`  
Use JSON except exports. Generate OpenAPI from Zod schemas.

## Public endpoints

### Discovery

- `GET /tokens`
- `GET /tokens/trending`
- `GET /tokens/new`
- `GET /pools/new`
- `GET /search?q=`
- `GET /stock-tokens`

Filters:
- chain
- time window
- liquidity minimum
- volume minimum
- risk grade
- verified status
- token category
- pagination cursor

### Token

- `GET /tokens/:address`
- `GET /tokens/:tokenAddress/price?chainId=&quoteAssetAddress=`
- `GET /tokens/:tokenAddress/price/history?chainId=&quoteAssetAddress=&from=&to=`
- `GET /tokens/:tokenAddress/candles?chainId=&quoteAssetAddress=&window=&limit=`
- `GET /tokens/:tokenAddress/metrics?chainId=&quoteAssetAddress=&window=`
- `GET /tokens/:address/holders`
- `GET /tokens/:address/transfers`
- `GET /tokens/:address/pools`
- `GET /tokens/:address/risk`
- `GET /tokens/:address/contract`
- `GET /tokens/:address/deployer`
- `GET /tokens/:address/related`

Price responses include an exact raw integer and decimal scale, source, source contract, source
block, source time, observation time, stale state, confidence basis points, warnings, and
methodology version. Unavailable prices return `priceRaw: null` and `status: "unavailable"`.

### Wallet

- `GET /wallets/:address/portfolio`
- `GET /wallets/:address/activity`
- `GET /wallets/:address/pnl`
- `GET /wallets/:address/allowances`
- `GET /wallets/:address/risk`
- `GET /wallets/:address/labels`

Public wallet responses must be rate-limited and must not imply identity.

### Projects

- `GET /projects`
- `GET /projects/:slug`
- `GET /projects/:slug/history`
- `GET /projects/:slug/reports`

### External protocols

- `GET /protocols?chainId=`
- `GET /launchpads?chainId=`
- `GET /protocols/verification?chainId=`
- `GET /pools/by-token/:tokenAddress?chainId=`
- `GET /pools/:poolAddress/swaps?chainId=`
- `GET /pools/:poolAddress/liquidity?chainId=`
- `GET /launchpads/tokens/:tokenAddress/state?chainId=`
- `GET /launchpads/tokens/:tokenAddress/graduation?chainId=`
- `GET /launchpads/tokens/:tokenAddress/migration?chainId=`

These routes expose active and disabled states. They exclude internal registry notes and provider
credentials. Raw integer values use decimal strings in JSON.

## Authenticated endpoints

### Auth

- `POST /auth/siwe/nonce`
- `POST /auth/siwe/verify`
- `POST /auth/logout`
- `GET /auth/session`

### Watchlists and alerts

- CRUD `/watchlists`
- CRUD `/alerts`
- `POST /alerts/:id/test`
- `GET /alert-events`
- `POST /notification-channels/telegram/link`
- `POST /notification-channels/email/verify`
- CRUD `/webhooks`

### Project claiming

- `POST /projects/claim-intent`
- `POST /projects/claim`
- `PATCH /projects/:id`
- `POST /projects/:id/contracts`
- `POST /projects/:id/bond-intent`

### Reports

- `POST /reports`
- `POST /reports/:id/evidence`
- `POST /reports/:id/bond-intent`
- `POST /reports/:id/appeal`

### Staking

- `GET /staking/status`
- `POST /staking/stake-intent`
- `POST /staking/unstake-request-intent`
- `POST /staking/withdraw-intent`

Intent endpoints return:
- chain ID;
- target address;
- ABI function;
- decoded arguments;
- calldata;
- value;
- deadline;
- simulation result;
- warnings;
- intent ID and expiration.

The server never signs for the user.

### Trading

- `POST /quotes`
- `POST /trades/prepare`
- `POST /approvals/prepare`
- `POST /approvals/revoke-prepare`

Quotes expire quickly and include provider, route, fee, price impact, minimum received, allowance requirement, and risk warnings. Re-simulate immediately before submission.

## API customer endpoints

API-key scopes:
- `tokens:read`
- `risk:read`
- `wallets:read`
- `alerts:write`
- `webhooks:write`
- `projects:write`

Use:
- per-key quotas;
- per-IP abuse limits;
- signed webhooks;
- replay-resistant timestamps;
- idempotency keys for writes.

## Error contract

```json
{
  "error": {
    "code": "TOKEN_NOT_FOUND",
    "message": "No token was found at this address on Robinhood Chain.",
    "requestId": "req_...",
    "details": {}
  }
}
```

Never leak stack traces, SQL, provider keys, internal hostnames, or raw upstream responses.

## Caching

- Public metadata: `s-maxage` with stale-while-revalidate.
- Risk report: cache by scan version and source block.
- Wallet/private routes: no shared caches.
- Quotes and intents: no cache; short explicit expiry.
