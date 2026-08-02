import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@hood-sentry/shared'],
  output: 'standalone',
  async redirects() {
    return [
      {
        // The product IS the board: the site root lands straight on discovery.
        source: '/',
        destination: '/discover',
        permanent: true,
      },
    ];
  },
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
