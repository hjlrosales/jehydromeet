/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@jehydro/shared-types'],
  images: { unoptimized: true },
};

if (process.env.NEXT_STANDALONE !== 'false') {
  nextConfig.output = 'standalone';
}

module.exports = nextConfig;
