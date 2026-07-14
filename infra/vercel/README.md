# Vercel Configuration

This directory contains Vercel deployment configurations for the Next.js web application.

## Configuration

- `vercel.json` - Vercel project configuration
- Environment variables managed through Vercel dashboard

## Deployment

- Preview deployments on pull requests
- Production deployment on merge to main branch

## Environment Variables

All `NEXT_PUBLIC_*` variables are build-time only. Server secrets are never exposed to the client.
