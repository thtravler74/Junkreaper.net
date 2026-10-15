import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // This app lives in a subdirectory of a repo with its own lockfile; pin the root.
  outputFileTracingRoot: __dirname,
  turbopack: { root: __dirname },
  async headers() {
    return [
      {
        // The loader script is fetched cross-origin from haulers' sites.
        source: "/widget.js",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Cache-Control", value: "public, max-age=300, stale-while-revalidate=86400" },
        ],
      },
      {
        // Everything except the embed route refuses to be framed. The embed route's
        // frame-ancestors policy is set per tenant in src/proxy.ts.
        source: "/((?!embed/).*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
