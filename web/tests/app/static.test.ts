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

  it("declare the private sim service with its binding into web", () => {
    const config = JSON.parse(readFileSync("../vercel.json", "utf8"));
    expect(config.services.sim.root).toBe("sim");
    expect(config.services.sim.entrypoint).toBe("main:app");
    expect(config.services.sim.functions["main.py"].maxDuration).toBe(300);
    expect(config.services.web.bindings).toEqual([
      { type: "service", service: "sim", format: "url", env: "SIM_INTERNAL_URL" },
    ]);
    expect(config.rewrites.some((r: { destination: { service: string } }) => r.destination.service === "sim")).toBe(false);
  });

  it("upload the Python package for the sim build but keep worktrees, tests, docs, and local copies out", () => {
    const ignore = readFileSync("../.vercelignore", "utf8");
    const line = (entry: string) => new RegExp(`^${entry.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}$`, "m");
    for (const entry of ["/.claude", "/docs", "/evals", "/results", "/tests", "/sim/tests", "/sim/.venv", "/sim/epichat", "/sim/templates"]) {
      expect(ignore).toMatch(line(entry));
    }
    for (const entry of ["/epichat", "/templates", "*.py", "*.txt"]) {
      expect(ignore).not.toMatch(line(entry));
    }
  });

  it("ship the brand assets", () => {
    for (const file of ["logo.png", "favicon.ico", "apple-touch-icon.png", "og-image.png"]) {
      expect(existsSync(`public/${file}`)).toBe(true);
    }
  });
});
