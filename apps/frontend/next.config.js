/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  transpilePackages: ['@jehydro/shared-types'],
  images: { unoptimized: true },
};

module.exports = nextConfig;
