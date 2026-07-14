# Runbooks

This directory contains operational runbooks for Hood Sentry.

## Available Runbooks

- `incident-response.md` - Incident response procedures
- `deployment.md` - Deployment procedures
- `rollback.md` - Rollback procedures
- `database-backup.md` - Database backup and restore
- `provider-failover.md` - RPC provider failover
- `feature-flags.md` - Feature flag management

## Severity Levels

- **SEV-0**: Active loss or key compromise
- **SEV-1**: Exploitable write path or corrupted risk output
- **SEV-2**: Partial outage, delayed indexing, alert failure
- **SEV-3**: Minor UI or noncritical defect

## Contact

Incidents are reported through PagerDuty and Slack.
