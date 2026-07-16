import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@hood-sentry/shared'],
  output: 'standalone',
  async rewrites() {
    return [
      {
        source: '/api/sentry/:path*',
        destination: `${process.env.SENTRY_API_INTERNAL_URL ?? 'http://localhost:4000'}/:path*`,
      },
    ];
  },
};

export default nextConfig;
