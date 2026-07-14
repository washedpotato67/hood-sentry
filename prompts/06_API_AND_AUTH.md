# Prompt 06 — API and Authentication

Implement `docs/API_SPEC.md`.

Add:
- Zod schemas and generated OpenAPI;
- cursor pagination;
- request IDs;
- SIWE nonce and verification;
- secure sessions;
- CSRF protection;
- per-route rate limits;
- API-key hashing, scopes, quotas, rotation, and revocation;
- object-level authorization;
- idempotency keys;
- admin RBAC and audit logs;
- safe error envelope;
- cache policy.

Acceptance:
- SIWE replay, wrong domain, wrong chain, expired message, and reused nonce tests pass;
- unauthenticated/private route tests pass;
- API never exposes secrets or internal errors;
- OpenAPI is generated in CI;
- rate limits and API-key scope enforcement are tested.
