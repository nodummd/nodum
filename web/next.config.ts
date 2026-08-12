import type { NextConfig } from "next";

// Same-origin proxy to the FastAPI backend: the browser only ever talks to
// the Next.js origin, so the httpOnly refresh cookie is first-party and no
// CORS is involved. Docker prod sets API_PROXY_URL=http://api:8000.
const API_PROXY_URL = process.env.API_PROXY_URL ?? "http://localhost:8000";

const nextConfig: NextConfig = {
  // Standalone server bundle for slim Docker images (see docker/Dockerfile)
  output: "standalone",
  // The floating dev indicator overlays the ribbon and intercepts clicks
  // (breaks e2e and manual testing); errors still surface in the console.
  devIndicators: false,
  rewrites() {
    return Promise.resolve([
      { source: "/api/:path*", destination: `${API_PROXY_URL}/api/:path*` },
    ]);
  },
};

export default nextConfig;
