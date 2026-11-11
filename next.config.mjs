/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['@electric-sql/pglite', 'pg', '@paypal/agent-toolkit'],
};

export default nextConfig;
