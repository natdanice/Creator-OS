import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native SQLite driver must stay on the Node side, never bundled.
  serverExternalPackages: ["better-sqlite3"],
  // Keep `next dev` from writing an AGENTS.md into the repo.
  agentRules: false,
  // The dev-only badge would sit on the phone tab bar.
  devIndicators: { position: "top-right" },
};

export default nextConfig;
