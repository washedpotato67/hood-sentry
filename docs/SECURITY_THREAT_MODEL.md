# Security and Threat Model

## Protected assets

- User funds and approvals.
- Project and reporter bonds.
- Treasury and liquidity inventory.
- Admin authority.
- User sessions and notification channels.
- API keys.
- Indexed chain integrity.
- Risk-report integrity.
- Private provider credentials.
- Brand and verified-project identity.

## Main adversaries

- Malicious token deployer.
- Phishing project impersonator.
- User attempting report spam or bond manipulation.
- External attacker targeting API, database, CI, cloud account, or admin session.
- Compromised dependency.
- RPC/provider returning stale or inconsistent data.
- Insider or compromised admin key.
- Bot abusing gas sponsorship or alerts.
- Webhook receiver replay attacker.

## Web and API controls

- SIWE nonce is random, hashed at rest, short-lived, and single-use.
- Domain, URI, chain ID, time, and signature validation.
- HTTP-only, secure, same-site cookies.
- CSRF protection on cookie-authenticated writes.
- Strict CSP, HSTS, frame denial, MIME sniff prevention.
- Escaped user content and sanitized markdown.
- Zod input validation.
- Parameterized SQL through the ORM.
- Rate limits by route, account, IP, and API key.
- Brute-force and enumeration controls.
- Object-level authorization checks.
- Admin passkeys/MFA, short sessions, and reauthentication.
- Immutable admin audit logs.
- Signed uploads and MIME/size validation.
- Secrets held in platform secret stores.
- Separate production and preview credentials.

## Transaction controls

- Validate connected chain before every action.
- Use checksummed target addresses.
- Prepare typed intent on the server and independently decode on the client.
- Simulate immediately before submission.
- Show target, function, arguments, token amount, spender, value, deadline, slippage, and warnings.
- Avoid unlimited approvals by default.
- Provide approval revocation.
- Use Permit2 only after verifying deployment and integration.
- Never request a seed phrase or private key.
- No server-side user signing.

## Smart-contract controls

- OpenZeppelin primitives.
- Checks-effects-interactions.
- Reentrancy guard where token transfers occur.
- SafeERC20.
- Role separation.
- Timelocked sensitive actions.
- Emergency pause with an exit path.
- No arbitrary delegatecall.
- No arbitrary treasury destination.
- No tx.origin authentication.
- Explicit EIP-712 domain, nonce, expiry, and action binding.
- Reject fee-on-transfer tokens in vaults unless explicitly supported.
- Account for malicious token callbacks.
- Require expected token contract for each vault.

## Chain and indexer controls

- Verify chain ID and genesis/network identity.
- Block parent-hash continuity.
- Reorg rollback.
- Idempotency keys.
- Raw immutable facts.
- Independent provider health comparison.
- Backfill gap scanner.
- Provider response size/time limits.
- ABI decoding failures do not halt raw ingestion.
- A malformed token contract cannot crash the worker.
- Quarantine unusually expensive analysis.

## Oracle controls

For oracle-backed prices:
- validate answer > 0;
- read feed decimals;
- staleness against official heartbeat;
- check L2 sequencer uptime and grace period;
- check token oracle-pause flag;
- stop price-dependent actions when any check fails.

## Alert and webhook controls

- Deduplicate by rule/event/finality.
- Sign webhooks with timestamped HMAC.
- Reject replay outside tolerance.
- Retry with exponential backoff and dead-letter queue.
- Never include secrets or unnecessary personal data.
- Allow endpoint rotation and revocation.
- Correct alerts affected by a reorg.

## CI/CD controls

- Protected main branch.
- Required reviews for contracts and infrastructure.
- Pinned GitHub Actions.
- Dependency lockfile.
- CodeQL and secret scanning.
- npm/pnpm audit with reviewed exceptions.
- SBOM generation.
- Container image scanning.
- Reproducible contract build.
- Separate deploy approval for mainnet.
- Deployment provenance and manifest.

## Incident response

Severity:
- SEV-0: active loss or key compromise.
- SEV-1: exploitable write path or corrupted risk output.
- SEV-2: partial outage, delayed indexing, alert failure.
- SEV-3: minor UI or noncritical defect.

Runbooks:
- pause write contracts;
- disable transactional feature flags;
- revoke gas sponsorship;
- rotate provider/API keys;
- invalidate sessions;
- fail over RPC;
- restore database;
- replay indexer;
- notify users;
- preserve evidence;
- publish postmortem.

## Legal and product-safety controls

- Terms, privacy policy, risk disclosure, cookie notice where applicable.
- Not-financial-advice notice.
- No claim that a risk scan is an audit.
- Do not collect unnecessary identity information.
- Mechanism for project/report appeal and correction.
- Public methodology and conflict-of-interest disclosure.
- Sponsored placement never changes risk score.
