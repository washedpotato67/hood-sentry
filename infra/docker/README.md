# Docker Configuration

This directory contains Docker-related configurations for Hood Sentry.

## Files

- `Dockerfile.api` - Fastify API service
- `Dockerfile.indexer` - Blockchain indexer service
- `Dockerfile.worker` - Background worker service
- `Dockerfile.telegram-bot` - Telegram bot service
- `Dockerfile.admin` - Admin service

## Local Development

Use `docker-compose.yml` in the root directory for local development.

## Production

Production deployments use managed services (Railway, Vercel) rather than custom Docker images.
