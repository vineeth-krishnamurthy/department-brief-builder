import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Make the registry snapshot available to the serverless API route on Vercel.
  outputFileTracingIncludes: { "/api/brief": ["./data/**"] },
};

export default nextConfig;
