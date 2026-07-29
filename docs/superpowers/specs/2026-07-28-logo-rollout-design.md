# Logo rollout — design

**Date:** 2026-07-28
**Status:** implemented, with the identity section since removed

> **Correction (2026-07-28).** The `[00 / identity]` section described below shipped and
> was then removed. Its copy assigned epidemiological meaning to the mark — red nodes as
> infectious, green as recovered, the cluster as a contact network — that was invented
> here, not the designer's intent. The mark is used as chrome only; nothing on the site
> interprets it. The section below is left as a record of what was built and undone.

## Problem

EpiChat has a new logo mark: a rounded speech bubble containing a cluster of connected
nodes in red and green. Until now both surfaces — the GitHub Pages site under `docs/` and
the Streamlit app — used the 🦠 emoji as a stand-in. Neither surface has a favicon, and
shared links have no preview image.

Goal: adopt the mark everywhere the emoji stood in.

## Constraints

- The master artwork is a 2048×2048 raster on an opaque off-white card. There is no
  vector source, so every derivative is raster and must be produced reproducibly.
- The site ships a light/dark toggle (`data-theme` on `<html>`). The bubble outline is
  near-black and disappears on the dark ground, so a dark variant is required.
- The Streamlit app is configured `base = "dark"`, so the app uses dark variants only.
- The full mark is ~120 nodes joined by hairlines. Below roughly 48px it resolves to
  coloured noise, so favicon sizes need a reduced form.
- `docs/` is served by GitHub Pages and must be self-contained; it cannot reference
  `assets/` at the repo root.

## Asset pipeline

`assets/build_logo_assets.py` derives the whole set from `assets/logo-source.png`. It is
checked in so the set can be regenerated if the master is revised.

**Background removal.** The artwork is dark-on-light, so alpha is recovered by
un-compositing against the card colour: with `p = a·F + (1−a)·bg` and the assumption that
the darkest channel of the foreground reaches zero, `a = 1 − min(p/bg)`. A knee at
α=0.08 drops render noise to zero and rescales, which keeps edge antialiasing intact
without leaving a grey wash.

**Dark variant.** Pixels are classified by chroma. Low-chroma pixels are the bubble
stroke and are re-inked toward the site's dark-theme ink in proportion to their original
darkness. Green nodes are lifted toward a mid green so they clear the dark ground. The
vermilion already carries and is left untouched.

**Simplified icon.** A morphological opening on the node mask erases every dot and
hairline thinner than the structuring element, leaving the bubble plus the major nodes.
The bubble outline is dilated so it survives downscaling. Cropped with zero padding,
this stays legible at 16px where the full mark does not.

**Outputs**

| File | Size | Used by |
|---|---|---|
| `assets/epichat-logo{,-dark}.png` | 1024 | app hero, sidebar |
| `assets/epichat-icon{,-dark}.png` | 256 | app page icon, chat avatar |
| `docs/brand/epichat-logo{,-dark}.png` | 1024 | site identity section, hero |
| `docs/brand/epichat-icon{,-dark}.png` | 256 | site nav, footer |
| `docs/brand/favicon.ico` | 16/32/48 | browser tab |
| `docs/brand/apple-touch-icon.png` | 180, opaque | iOS home screen |
| `docs/brand/og-image.png` | 1200×630 | link previews |

## Website

**Chrome.** Favicon, apple-touch-icon, and Open Graph / Twitter card tags in all three
page heads. The nav's `.brand-mark` — currently a 10px accent dot — becomes the
simplified icon at 26px. The footer's "EpiChat" column heading gets the same mark.

**Theme swapping.** Two `<img>` elements per placement with `.theme-light-only` /
`.theme-dark-only`, toggled by the existing `[data-theme="dark"]` attribute. Light is the
default so there is no flash before `site.js` runs.

**~~Hero.~~** *(removed)* The mark at 68px above the kicker row. Taken out along with the
identity section — the nav mark is the site's only logo placement above the fold.

**~~The highlight — `[00 / identity]`.~~** *(removed — see the correction at the top)* A
section between the hero and `[01 / context]` showing the mark large alongside four
interpretive readings of it and a palette strip. The readings ascribed meanings to the
mark that were not the designer's, so the whole section was removed rather than reworded.

**Colour.** The site's burgundy accent is unchanged and the logo's hues are not adopted
into the palette. `--brand-green` / `--brand-red` existed only for the identity section's
markers and were removed with it.

## App

The Streamlit theme is dark, so all four placements use dark variants:

- `st.set_page_config(page_icon=…)` → `assets/epichat-icon-dark.png`
- `st.logo(…)` in the app chrome, linking to the project site
- Sidebar heading — the mark inline beside the "EpiChat" wordmark, replacing 🦠
- Empty-state hero — the mark at 132px above the wordmark
- `st.chat_message(avatar=…)` for all three assistant-message sites

Streamlit accepts a filesystem path for both `page_icon` and `avatar`. Paths resolve
against the app's own directory rather than the process working directory, so a module
level `_ASSETS = Path(__file__).parent / "assets"` is used.

## Out of scope

- Redrawing the mark as vector. Worth doing eventually — it would sharpen the favicon
  and shrink the payload — but it needs the original design file.
- Restyling the site around the logo's green and red.
- Interpreting the mark anywhere in copy. See the correction at the top.

`.streamlit/config.toml`'s `primaryColor` was listed as out of scope in the original
draft and then changed to `#F13A25` on request, so the app's accent now matches the
mark's red.

## Verification

- Regenerate assets from a clean checkout; confirm byte-identical output.
- Load all three pages in a browser at desktop and mobile widths, in both themes;
  confirm the nav and footer marks swap variant with the theme.
- Confirm the favicon renders in the tab strip.
- Launch the app; confirm page icon, sidebar, empty state, and chat avatars.
- Bump the `?v=` on `styles.css` and `site.js` in all three pages whenever either
  changes, or the CDN serves a stale pair.
