import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Shared conversations: never indexed, never cached, so revoking a link is immediate.
  async headers() {
    return [
      {
        source: "/s/:path*",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "Cache-Control", value: "no-store" },
        ],
      },
    ];
  },
  outputFileTracingIncludes: {
    // Every route that reads the consent text (lib/consent.ts) must ship the file.
    "/": ["./content/**/*.md"],
    "/chat": ["./content/**/*.md"],
    "/consent": ["./content/**/*.md"],
    "/admin": ["./content/**/*.md"],
    "/api/consent": ["./content/**/*.md"],
    "/api/event": ["./content/**/*.md"],
    "/chat/[id]": ["./content/**/*.md"],
    "/api/chat": ["./content/**/*.md"],
    "/api/feedback": ["./content/**/*.md"],
    "/api/conversations/[id]": ["./content/**/*.md"],
    "/api/runs/[id]": ["./content/**/*.md"],
    "/api/diseases/[key]/references": ["./content/**/*.md"],
    "/api/reports/[id]": ["./content/**/*.md"],
    "/api/shares": ["./content/**/*.md"],
    "/profile": ["./content/**/*.md"],
    "/api/profile": ["./content/**/*.md"],
    "/api/profile/setup": ["./content/**/*.md"],
    "/api/memories": ["./content/**/*.md"],
    "/api/memories/[id]": ["./content/**/*.md"],
  },
};

export default nextConfig;
