# Product

## Register

product

## Users

Self-hosters / homelabbers running a **single media server** (Plex, Jellyfin, or Emby)
who want to curate poster and backdrop artwork for their library. They're technically
comfortable — \*arr-app, Kometa, Docker/Unraid people — but they come to PosterPilot for
the **visual** job: browse artwork and apply it fast, not wrestle config. Typical context
is a desktop browser on the LAN, often evaluating many titles in a row. The emotional goal
is **confidence** that the right artwork landed, plus the small pleasure of watching their
library look great.

## Product Purpose

PosterPilot browses one media server, resolves titles to TMDB, finds covers across
providers (MediUX, Fanart.tv, TMDB, ThePosterDB), and applies them directly to the server
and/or exports Kometa YAML — all from a single Docker container. Success is a curated,
great-looking library applied in minutes, with the tool staying out of the way: less config
wrestling, more artwork landing where it should.

## Brand Personality

**Sleek & cinematic.** Three words: **cinematic, confident, quiet.** The UI is the gallery
frame, not the art — it recedes so posters and backdrops are the hero. Voice is direct and
unfussy, like a good CLI tool that grew a face; never salesy, never cute.

## Anti-references

Explicitly **NOT**:

- **A flashy gamer/RGB UI** — no neon gradients, glow, or aggressive motion.
- **Toy-like / overly playful** — no cartoon rounding, bright primaries, emoji-as-UI.
- **A corporate SaaS dashboard** — no generic Material/Bootstrap admin blandness, stock
  charts, or enterprise chrome.

## Design Principles

1. **Artwork is the hero; chrome recedes.** Every layout choice gives posters/backdrops
   more room and the UI less. If a control competes with the image, the control loses.
2. **One accent, used sparingly.** Violet marks the primary action / active state only.
   Color anywhere else must mean something — never decorate with it.
3. **Cinematic, not flashy.** Get depth from near-black surfaces and restraint, not glow,
   RGB, or bounce. Calm confidence over spectacle.
4. **Dense where it's work, spacious where it's browsing.** Library and detail views are
   image-forward and breathable; settings and activity stay legible and information-honest
   without collapsing into an \*arr config wall.
5. **AA + reduced-motion are constraints, not afterthoughts.** Contrast and motion-safety
   are part of "done," and no signal depends on color alone.

## Accessibility & Inclusion

- Target **WCAG AA** — keep AA contrast for text and controls on the dark base; watch
  low-contrast `neutral-500/600` on near-black.
- **Honor `prefers-reduced-motion`** — the View Transitions wired through SvelteKit's
  `onNavigate`, and any other animation, must degrade to instant or a plain cross-fade.
- **Don't ride meaning on color alone** — pair the semantic badge colors with an icon or
  label so color-blind users get the same signal.
