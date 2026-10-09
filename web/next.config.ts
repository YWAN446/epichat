import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
  },
};

export default nextConfig;
