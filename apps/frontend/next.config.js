/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@jehydro/shared-types'],
  images: { unoptimized: true },
};

module.exports = nextConfig;
