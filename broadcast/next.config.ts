import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pin the workspace root to this app. Without it Turbopack walks up and
  // trips over an unrelated lockfile in $HOME, guessing the wrong root.
  turbopack: {
    root: import.meta.dirname,
  },
  // the corner writes round/feed/meta JSON into broadcast/data — make sure
  // serverless bundles carry it for the fs reads in lib/data.ts
  outputFileTracingIncludes: {
    "/**": ["./data/**"],
  },
};

export default nextConfig;
