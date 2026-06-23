---
title: Usage
description: Sync a library, find covers, apply them via the media-server API or Kometa export, build custom sets, and use the library filters and sorting.
---

This page walks through the day-to-day workflow once PosterPilot is
[installed](/posterpilot/installation/) and
[configured](/posterpilot/configuration/).

## Sync a library

A sync pulls your movie and show libraries from the active media server into
PosterPilot's local cache and resolves each title to a TMDB id so artwork
providers can be queried.

1. Make sure the active server type's credentials and a TMDB key are configured.
   A sync is blocked (with a clear message about what is missing) if they are not.
2. Optionally narrow which sections are synced with `INCLUDED_SECTIONS` (or the
   equivalent Settings field) — leave it empty to sync all movie and show
   sections.
3. Run the sync. It runs as a background job with live progress.

Each item comes back with its title, year, type, external GUIDs (tmdb/imdb/tvdb
when present), and current poster. An item with no external GUID is still listed
but flagged as unresolvable for provider lookup rather than dropped.

## The library wall

The synced library renders as a poster grid. You can:

- **Search** by title.
- **Filter** by media type (movie / show), missing poster, MediUX availability
  (has candidates), change state (unchanged / still on the default poster),
  minimum rating, and genre.
- **Sort** by title, release year, rating, runtime, or most-recently-changed.
- See a **spotlight banner** — a backdrop for a recently-changed item above the
  wall once at least one cover has been applied.

Each tile surfaces the item's rating and a status badge (e.g. MediUX-available,
changed), with the title and year revealed on hover.

## Find covers

Open an item to see its detail view: a backdrop hero with the item's logo (or its
title when no logo exists), rating, year, runtime (or season/episode counts for
shows), genres, and overview.

- If covers have not been discovered yet, use **Find covers** to run discovery for
  that item.
- Discovery fans out across all enabled providers and stores the union of their
  candidates, each tagged with its provider.
- Candidates are grouped **first by provider, then by set**. Each set shows its
  uploader attribution with the poster and backdrop together. For shows, the view
  also presents season-poster sets and title-card sets.

You can stage a whole set ("use this set"), or take an individual poster from one
set and a background from another — the two slots are independent.

## Apply a cover

Apply a staged selection with the method you choose, selectable per apply action
with a configurable default (`DEFAULT_APPLY_METHOD`, default `both`):

- **Media server (direct).** Uploads the poster (and background) through the
  active media-server provider and locks the field so the server's automatic
  agents do not overwrite it. The change is effectively instant. Recorded as a
  server application with the provider's type.
- **Kometa export.** Writes Kometa/PMM-compatible YAML — `url_poster` (and
  `url_background` when a background is staged), keyed by TMDB id — into the
  configured Kometa assets directory, without contacting the media server. Your
  existing Kometa instance applies the covers on its next run. Re-applying updates
  the entry in place rather than duplicating it.
- **Both.** Performs the direct upload _and_ writes the Kometa YAML, recording each
  outcome independently so a partial failure is visible.

Every apply — success or failure — is recorded with the item, asset URL,
method(s), outcome, and timestamp, so history is queryable and re-application is
detectable.

### How Kometa consumes the export

PosterPilot writes a single metadata file (default `posterpilot.yml`) into
`KOMETA_ASSETS_DIR`, keyed by TMDB id with `url_poster` / `url_background`
entries. Add that file to your Kometa library config (e.g. under
`metadata_path` / `metadata_files`) so Kometa applies the covers on its next run.

## Custom sets

The item detail view has a persistent, sticky **builder** with a poster slot and a
background slot that together form a custom "set":

- Clicking a poster candidate routes it to the poster slot; clicking a background
  candidate routes it to the background slot — automatically, by kind.
- Each slot can also be filled from a **pasted image URL** or an **uploaded image
  file**.
- Applying the builder applies both staged pieces in one action via your chosen
  method.

:::note[Uploads are server-only]
A URL-based custom cover can be applied via both the media server and Kometa. An
**uploaded file** can only be applied via the media server — a binary upload
cannot be expressed as a Kometa YAML URL, so it is omitted from the Kometa export
and the limitation is made visible rather than writing an invalid entry.
:::

## Bulk actions

Select multiple items and run discovery and/or apply across the selection as a
single background job. Bulk apply with automatic selection discovers (if needed),
auto-selects, and applies covers for each selected item, with live progress.

Automatic selection works across all enabled providers' candidates — it picks a
primary poster (and a background where available) using a deterministic provider
preference order, falling back to the next provider when the most-preferred one
has no poster for the item.

## Jobs view

The jobs view lists active and past jobs, with live progress for running jobs
(updating over Server-Sent Events without a manual refresh) and final status for
completed ones.
