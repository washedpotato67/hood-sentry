# UI and UX Specification

## Navigation

- Discover
- Stock Tokens
- Watchlists
- Portfolio
- Alerts
- Projects
- Reports
- Token Access
- API
- Docs

## Routes

- `/`
- `/discover`
- `/stock-tokens`
- `/token/[address]`
- `/wallet/[address]`
- `/portfolio`
- `/watchlists`
- `/alerts`
- `/projects`
- `/projects/[slug]`
- `/reports/[id]`
- `/token-access`
- `/trade`
- `/api`
- `/methodology`
- `/terms`
- `/privacy`
- `/risk-disclosure`
- `/admin/*`

## Home

- Current chain status.
- Search.
- New pools.
- Trending community assets.
- Canonical Stock Tokens.
- Recent high-severity findings.
- Product explanation.
- No fake TVL or fabricated usage metrics.

## Discover

Columns/cards:
- token name and address;
- category;
- age;
- price;
- liquidity;
- volume;
- unique traders;
- holder growth;
- risk grade and completeness;
- verified-profile badge;
- duplicate-symbol warning.

Filters persist in URL.

## Token page

Header:
- token identity;
- copyable address;
- official/canonical status;
- project-claim status;
- explorer link;
- watch and alert actions.

Tabs:
- Overview
- Risk
- Contract
- Holders
- Liquidity
- Activity
- Deployer
- Project
- Trade

Risk presentation:
- score;
- completeness;
- critical/high findings first;
- evidence expandable;
- unknowns;
- methodology version;
- source block and scan time;
- “not an audit” notice.

## Stock Token page

Display:
- raw token units;
- share-equivalent units;
- UI multiplier;
- pending multiplier and effective time;
- feed price;
- underlying-share price when derivable;
- oracle status;
- market-hours/staleness context;
- official address.

Never silently apply the multiplier twice.

## Wallet/portfolio

- address and user labels;
- total estimated value;
- holdings;
- cost basis/P&L with confidence;
- risk exposure;
- approvals;
- activity;
- watched-wallet controls.

Clearly distinguish:
- exact onchain balance;
- estimated fiat value;
- estimated cost basis;
- unavailable data.

## Trading

Review screen must show:
- sell and buy assets;
- exact input;
- expected output;
- minimum received;
- price impact;
- provider and route;
- fee;
- spender;
- approval amount;
- deadline;
- simulation result;
- token risk warnings;
- final confirmation.

## Project profile

Badges are separate:
- Wallet claim verified
- Domain/social verified
- Contract address verified
- Bond active
- External audit linked

Never merge them into one “safe” badge.

## Empty/error/loading states

- Skeletons only when a request is in progress.
- Explicit “data unavailable” with reason.
- Provider degradation banner.
- Indexing lag indicator.
- Transaction states: preparing, awaiting signature, submitted, soft-confirmed, finalized, failed.
- Recovery action for every failure where possible.

## Accessibility

- Keyboard navigation.
- Visible focus.
- Semantic tables.
- ARIA labels for address buttons and charts.
- Contrast.
- Reduced-motion support.
- Charts have textual summaries.
- Mobile-first transaction review.
