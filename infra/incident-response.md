# Incident response controls

Severity: SEV-0 active loss or critical compromise, SEV-1 exploitable write path or corrupted safety output, SEV-2 partial outage or delayed data, SEV-3 minor defect.

Server-controlled kill switches: mainnet writes, trading, token gating, launchpad integration, gas sponsorship, AI, webhooks, project claims, reports, and read-only mode. Every change requires an authenticated operator, reason, audit event, and configuration version. High-impact changes require step-up authentication and dual approval where configured.

Preserve raw evidence and read-only intelligence. Rotate secrets, notify affected users, preserve logs, and complete a postmortem. Runbooks cover malicious launches, admin or creator compromise, frontend or DNS compromise, RPC corruption, database breach, API-key or session-secret leaks, indexer corruption, false risk reports, notification spam, token impersonation, launchpad exploits, supply changes, and migration failures.
