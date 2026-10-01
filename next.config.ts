import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The home page reads example trips from disk at request time; make sure they ship with it.
  outputFileTracingIncludes: {
    "/": ["./data/examples/**/*.json"],
  },
};

export default nextConfig;
