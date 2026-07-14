import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@hood-sentry/shared'],
  output: 'standalone',
};

export default nextConfig;
