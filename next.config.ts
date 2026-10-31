import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native SQLite driver must stay on the Node side, never bundled.
  serverExternalPackages: ["better-sqlite3"],
  // Keep `next dev` from writing an AGENTS.md into the repo.
  agentRules: false,
};

export default nextConfig;
