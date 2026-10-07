import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("page styles", () => {
  const css = readFileSync("app/globals.css", "utf8");

  it("do not switch colors in dark mode or set page colors outside Tailwind's layers", () => {
    expect(css).not.toMatch(/prefers-color-scheme/);
    expect(css).not.toMatch(/^body\s*\{/m);
  });

  it("define EpiChat's palette and fonts, not CampusOtter's", () => {
    expect(css).toContain("--color-accent:");
    expect(css).toContain("--font-newsreader");
    expect(css).not.toContain("--color-river");
  });
});

describe("Vercel project files", () => {
  it("define the web service at web/ with a daily health cron", () => {
    const config = JSON.parse(readFileSync("../vercel.json", "utf8"));
    expect(config.services.web.root).toBe("web");
    expect(config.rewrites).toEqual([{ source: "/(.*)", destination: { service: "web" } }]);
    expect(config.crons).toEqual([{ path: "/api/health", schedule: "0 9 * * *" }]);
  });

  it("keep the Python package and the worktrees out of the upload", () => {
    const ignore = readFileSync("../.vercelignore", "utf8");
    for (const entry of ["/.claude", "/epichat", "/templates", "/docs", "/evals", "/results"]) {
      expect(ignore).toMatch(new RegExp(`^${entry.replace("/", "\\/")}$`, "m"));
    }
  });

  it("ship the brand assets", () => {
    for (const file of ["logo.png", "favicon.ico", "apple-touch-icon.png", "og-image.png"]) {
      expect(existsSync(`public/${file}`)).toBe(true);
    }
  });
});
