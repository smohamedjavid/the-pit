import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // the corner writes round/feed/meta JSON into broadcast/data — make sure
  // serverless bundles carry it for the fs reads in lib/data.ts
  outputFileTracingIncludes: {
    "/**": ["./data/**"],
  },
};

export default nextConfig;
