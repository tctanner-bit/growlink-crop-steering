/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@gl-steering/core'],
  serverExternalPackages: ['pg'],
  reactStrictMode: true,
};
export default nextConfig;
