import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  reactCompiler: true,
  serverExternalPackages: ['ssh2', 'routeros-api', 'source-map-support', 'better-sqlite3'],
};

export default nextConfig;
