// Shared nav + footer + tweaks wiring. Pure-vanilla to keep things snappy.
(function () {
  const NAV_LINKS = [
    { href: "index.html", label: "OVERVIEW" },
    { href: "about.html", label: "ABOUT" },
    { href: "docs.html", label: "DOCS" },
  ];

  const CURRENT = (document.body.dataset.page || "index") + ".html";

  function mountNav() {
    const host = document.querySelector("[data-mount='nav']");
    if (!host) return;
    host.innerHTML = `
      <nav class="nav">
        <div class="nav-inner">
          <a href="index.html" class="brand">
            <span class="brand-mark"></span>
            <span>EpiChat</span>
            <span class="brand-meta">v0.1 · prototype</span>
          </a>
          <div class="nav-links">
            ${NAV_LINKS.map(l => `
              <a href="${l.href}" class="${l.href === CURRENT ? "active" : ""}">${l.label}</a>
            `).join("")}
          </div>
          <a href="#demo" class="nav-cta">Launch demo ↗</a>
        </div>
      </nav>
    `;
  }

  function mountFooter() {
    const host = document.querySelector("[data-mount='footer']");
    if (!host) return;
    host.innerHTML = `
      <footer class="site">
        <div class="wrap">
          <div class="cols">
            <div>
              <h4>EpiChat</h4>
              <p style="font-family: var(--serif); color: var(--ink-2); font-size: 0.95rem; line-height: 1.5; max-width: 36ch;">
                A conversational AI agent for epidemiological simulation. Natural language in. Validated simulation out.
              </p>
              <pre class="ascii" style="margin-top: 1rem;">
    S ──▶ E ──▶ I ──▶ R
         ↑              │
         └──── waning ──┘</pre>
            </div>
            <div>
              <h4>Project</h4>
              <ul>
                <li><a href="index.html">Overview</a></li>
                <li><a href="about.html">About</a></li>
                <li><a href="docs.html">Docs</a></li>
                <li><a href="docs.html#roadmap">Roadmap</a></li>
              </ul>
            </div>
            <div>
              <h4>Code</h4>
              <ul>
                <li><a href="https://github.com/YWAN446/epichat" target="_blank" rel="noopener">GitHub ↗</a></li>
                <li><a href="https://starsim.org" target="_blank" rel="noopener">Starsim ↗</a></li>
                <li><a href="#demo">Live demo</a></li>
              </ul>
            </div>
            <div>
              <h4>Contact</h4>
              <ul>
                <li><a href="mailto:yuke.wang@emory.edu">yuke.wang@emory.edu</a></li>
                <li style="color: var(--ink-3);">Rollins · Emory</li>
                <li style="color: var(--ink-3);">CIDMATH</li>
              </ul>
            </div>
          </div>
          <div class="bottom">
            <span>© 2026 · CIDMATH · Disruptive Discovery Seed Program FY27</span>
            <span>build ${new Date().toISOString().slice(0,10)} · status: prototype</span>
          </div>
        </div>
      </footer>
    `;
  }

  // --------- Tweaks ---------
  const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
    "accent": "burgundy",
    "density": "comfortable",
    "theme": "light"
  }/*EDITMODE-END*/;

  const ACCENTS = {
    burgundy: { h: 25, label: "Burgundy" },
    navy:     { h: 250, label: "Navy" },
    forest:   { h: 155, label: "Forest" },
    oxblood:  { h: 10, label: "Oxblood" },
    ink:      { h: 280, label: "Ink" }
  };

  const state = Object.assign({}, TWEAK_DEFAULTS);

  function apply() {
    document.documentElement.style.setProperty("--accent-h", ACCENTS[state.accent]?.h ?? 25);
    document.documentElement.style.setProperty("--density", state.density === "compact" ? 0.72 : state.density === "airy" ? 1.25 : 1);
    document.documentElement.dataset.theme = state.theme;
  }

  function mountTweaks() {
    // Register listener FIRST
    const panel = document.createElement("div");
    panel.className = "tweaks";
    panel.innerHTML = `
      <h3>Tweaks</h3>
      <div class="group">
        <label>Accent</label>
        <div class="swatches" data-group="accent">
          ${Object.entries(ACCENTS).map(([k, v]) => `
            <button class="sw ${state.accent === k ? "on" : ""}" data-val="${k}"
              style="background: oklch(0.42 0.12 ${v.h});" title="${v.label}"></button>
          `).join("")}
        </div>
      </div>
      <div class="group">
        <label>Theme</label>
        <div class="opts" data-group="theme">
          ${["light","dark"].map(t => `
            <button class="opt ${state.theme === t ? "on" : ""}" data-val="${t}">${t}</button>
          `).join("")}
        </div>
      </div>
      <div class="group">
        <label>Density</label>
        <div class="opts" data-group="density">
          ${["compact","comfortable","airy"].map(d => `
            <button class="opt ${state.density === d ? "on" : ""}" data-val="${d}">${d}</button>
          `).join("")}
        </div>
      </div>
    `;
    document.body.appendChild(panel);

    panel.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-val]");
      if (!btn) return;
      const group = btn.parentElement.dataset.group;
      const val = btn.dataset.val;
      state[group] = val;
      panel.querySelectorAll(`[data-group="${group}"] button`).forEach(b => b.classList.remove("on"));
      btn.classList.add("on");
      apply();
      window.parent.postMessage({ type: "__edit_mode_set_keys", edits: { [group]: val } }, "*");
    });

    window.addEventListener("message", (e) => {
      const d = e.data || {};
      if (d.type === "__activate_edit_mode") panel.classList.add("on");
      if (d.type === "__deactivate_edit_mode") panel.classList.remove("on");
    });

    window.parent.postMessage({ type: "__edit_mode_available" }, "*");
  }

  document.addEventListener("DOMContentLoaded", () => {
    mountNav();
    mountFooter();
    apply();
    mountTweaks();
  });
})();
