import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone server bundle for slim Docker images (see docker/Dockerfile)
  output: "standalone",
};

export default nextConfig;
