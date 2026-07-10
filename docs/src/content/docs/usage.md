---
title: Usage
description: Run the setup wizard, sync a library, find covers across providers, apply them via the media-server API or Kometa export, build custom sets, filter and sort the library, and read the Activity log.
---

This page walks through the day-to-day workflow once PosterPilot is
[installed](/posterpilot/installation/) and
[configured](/posterpilot/configuration/).

## First-install wizard

On a fresh install a banner points you at the wizard at `/setup`. It walks you
through six steps in order, persisting each as you go:

1. **Language** — pick the UI locale.
2. **Media server** — choose Plex, Jellyfin, or Emby. For Plex you can sign in
   with a PIN (PosterPilot shows a code and an authorization link, then stores the
   acquired token for you) and pick a discovered local/remote connection. Jellyfin
   and Emby take a server URL and let you **sign in with your username and
   password** — PosterPilot exchanges them for an access token, so you never have
   to hunt down an API key (the password is used only for that one request and is
   never stored; pasting a key by hand stays available as a fallback). A **Test**
   button verifies the connection.
3. **TMDB** — paste a TMDB API key (a link to TMDB's API settings is provided).
4. **Providers** — toggle the artwork providers (MediUX, TMDB, Fanart.tv,
   ThePosterDB) and enter a Fanart.tv key if you use it.
5. **Libraries** — once connected, the wizard lists your movie and show libraries;
   tick the ones to sync (all selected by default, which also picks up libraries
   you add later).
6. **First sync** — run the initial sync, then jump to the Dashboard.

The wizard is **skippable** at any point (the _Skip_ link goes straight to the
Dashboard) — everything it covers is also available in **Settings**.

## Sync a library

A sync pulls your movie and show libraries from the active media server into
PosterPilot's local cache and resolves each title to a TMDB id so artwork
providers can be queried.

1. Make sure the active server type's credentials and a TMDB key are configured.
   A sync is blocked (with a clear message about what is missing) if they are not.
2. Optionally narrow which sections are synced from the **Libraries to sync**
   checklist (in the wizard or Settings → Media server) or with `INCLUDED_SECTIONS`
   — leave it empty to sync all movie and show sections, including ones you add
   later.
3. Run the sync from the **Dashboard** (the **Sync** button). It runs as a
   background job with live progress shown right there; the stat cards (items,
   movies, shows, resolved, with MediUX, applied) climb as it runs.

Each item comes back with its title, year, type, external GUIDs (tmdb/imdb/tvdb
when present), and current poster. An item with no external GUID is still listed
but flagged as unresolvable for provider lookup rather than dropped.

Repeat syncs are **incremental** by default: PosterPilot compares each item against
the media server's last-modified timestamp and only re-resolves and re-enriches the
ones that changed since the previous sync, so a routine rescan is much faster than
the first. A **full rescan** that re-processes everything stays available, and you
can turn incremental syncing off entirely (see
[Configuration → Performance and tuning](/posterpilot/configuration/#performance-and-tuning)).

## The library wall

The synced library renders as a poster grid with a Notion-style toolbar. You can:

- **Search** by title.
- **Filter** from the **Filter** popover: media type (movie / show), minimum
  rating, genre, missing poster, MediUX availability (has candidates), change
  state (unchanged / still on the default poster), and ignored state. The Filter
  button shows a badge with the number of active facets.
- **Sort** from the **Sort** popover by title, release year, rating, runtime,
  most-recently-changed, or date added to the media server, with an independent
  ascending/descending toggle. The wall opens with the sort configured in
  **Settings → Kometa & advanced** (default: title); an explicit choice in the
  toolbar always wins.
- Each active filter and the sort show up as **removable chips** below the toolbar
  — click a chip's ✕ to drop just that one, or **Clear all** to reset everything.
- Toggle **auto-apply** (the ⚡ button): on, each change navigates immediately; off,
  changes are staged until you hit **Apply**. The choice is remembered.
- **Ignore** an item you want left untouched — ignored items are skipped by
  discovery, apply, and automatic selection, are visually marked on the wall, and
  can be filtered in or out from the Filter popover. Toggle it off again at any
  time to bring the item back into the workflow.
- See a **spotlight banner** — a backdrop for a recently-changed item above the
  wall once at least one cover has been applied.

Each tile surfaces the item's rating and a status badge (e.g. MediUX-available,
changed), with the title and year revealed on hover.

![PosterPilot library wall with search, filter, sort, status controls, and a grid of movie posters](/posterpilot/screenshots/library.webp)

## Find covers

Open an item to see its detail view: a backdrop hero with the item's logo (or its
title when no logo exists), rating, year, runtime (or season/episode counts for
shows), genres, and overview, plus the top-billed cast.

- If covers have not been discovered yet, use **Find covers** to run discovery for
  that item.
- Discovery fans out across all enabled providers and stores the union of their
  candidates, each tagged with its provider.
- Candidates are grouped **first by provider, then by set**. Each set shows its
  uploader attribution with the poster and backdrop together. For shows, the view
  also presents season-poster sets and title-card sets.
- Provider sections, individual set cards, and (for shows) season groups are
  **collapsible**. On first load the first provider and its first set are expanded
  and everything else is collapsed; your collapsed/expanded choices persist in the
  browser across reloads and as you move between items.
- When **suggested artwork** is enabled, the highest-scored candidate for each slot
  is pre-selected as a clearly marked suggestion you can accept or override.
  Candidates are scored on provider quality, resolution, and aspect-fit; tune the
  weights — or turn the pre-selection off — in Settings (see
  [Configuration → Performance and tuning](/posterpilot/configuration/#performance-and-tuning)).

You can stage a whole set ("use this set"), or take an individual poster from one
set and a background from another — the two slots are independent.

![PosterPilot item detail view with backdrop metadata, cast, discovered artwork count, staged poster and background, and Apply button](/posterpilot/screenshots/item-detail.webp)

## Season and episode artwork

For a show, artwork is staged per slot, so the show cover, each season's poster,
and each episode's title card are independent of one another:

- A set's artwork is organized into a **show group** (poster and background) and
  one **group per season**. Each season group holds that season's poster and its
  episodes' title cards. (A season background slot exists in the model but is not
  shown, because no provider currently sources season backgrounds.)
- Selecting a candidate inside a season or episode slot stages just that slot,
  without touching the show-level or any other slot. Re-selecting the candidate
  already staged in a slot clears it again.
- **Use this set** fills every slot the set covers at once — show, each season,
  and each episode — matched by season and episode number. You can then override
  any single slot and keep the rest of the set staged.

The sticky builder summarizes everything currently staged — the show
poster/background plus counts of staged seasons and episodes — and a single
**Apply** writes all of it in one action (see [Apply a cover](#apply-a-cover)).

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

A single apply writes **every staged slot** — show, seasons, and episodes — with
the chosen method(s). For direct upload, PosterPilot resolves each season and
episode child on the media server by number and uploads to it; a staged slot whose
season or episode has no matching child on the server is skipped and reported
rather than failing the whole apply, and one child's failure never aborts the rest.
The Kometa export nests staged season posters under `seasons:` (keyed by season
number) and staged episode title cards under `episodes:` (keyed by episode number),
alongside the show-level `url_poster` / `url_background`. A season **background** is
applied via the direct method only — it is omitted from the YAML.

Every apply — success or failure — is recorded with the item, asset URL,
method(s), outcome, and timestamp, so history is queryable and re-application is
detectable.

### How Kometa consumes the export

PosterPilot writes a single metadata file (default `posterpilot.yml`) into
`KOMETA_ASSETS_DIR`, keyed by TMDB id with `url_poster` / `url_background`
entries. Add that file to your Kometa library config (e.g. under
`metadata_path` / `metadata_files`) so Kometa applies the covers on its next run.

## Revert

Every applied cover is reversible from the item detail view:

- **Revert to original** reverts the show-level artwork **and every applied season
  and episode** in one action, restoring what the media server had before
  PosterPilot changed it.
- Each season group has its own **Revert season** control that reverts only that
  season's poster/background and its episodes' title cards, leaving the show-level
  and other seasons' artwork in place.

Reverts re-resolve season and episode children by number, the same way apply does.

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

Automatic selection scores every candidate across all enabled providers —
combining provider quality, resolution, and aspect-fit — and picks the
highest-scored poster (and a background where available) for each item, the same
scoring that drives the suggested pre-selection on the item view. Ignored items are
left out of the selection.

Before a bulk apply runs, a **dry-run preview** summarizes exactly what would
happen — the planned uploads, the Kometa exports, and any items or slots that would
be skipped — so you can confirm before anything is written. Bulk apply then
processes items **concurrently** (bounded by the Apply concurrency setting), so
large batches finish faster, with the same live progress and cancellation.

## FUN: random movie/series picker

**FUN** is an opt-in section for library experiments (enable it with the FUN
toggle in **Settings → Kometa & advanced**, or `FUN_ENABLED=true`). Until then it
stays completely hidden — no nav entry, and its page returns 404.

Its first tool answers "what should we watch tonight?": one click draws a random
title from your synced library and presents it image-forward — backdrop, poster,
genres, rating, and overview — with a link to the item and a **re-roll** button
that draws again under the same filters. You can constrain the draw by:

- **Type** — movies, shows, or both.
- **Genre** — one of your library's genres, or all.
- **Year range** — an optional minimum and/or maximum release year.
- **Watched** — skip titles you've already seen. Watched state is captured
  during library sync (Plex play counts; Jellyfin/Emby played flags — a show
  counts as watched only when every episode is played).

:::note
On Jellyfin/Emby the played flag needs a user context, so sign in with
username/password rather than a bare API key — with only an API key everything
syncs as unwatched and the skip-watched filter has nothing to exclude.
:::

## Dashboard and jobs

The **Dashboard** is home base. It shows the library stat cards, the **Sync**
button, and any running jobs with a **live progress bar** (updating over
Server-Sent Events, no refresh needed) that you can **cancel**. The nav badge next
to Dashboard reflects how many jobs are active. Below that, a **Recent jobs** table
lists the latest jobs with their type, processed/total counts, and final status.
There is no separate Jobs page — live progress and recent history both live on the
Dashboard.

![PosterPilot dashboard with library statistics, sync action, and recent background jobs](/posterpilot/screenshots/dashboard.webp)

## Activity log

The granular event log lives under **Settings → Activity**. Every operational event
is recorded there (and mirrored to the container console and a rotating file log).
You can:

- Filter by level — **All / Info / Warn / Error**.
- Page through history with **Load more**.
- **Clear activity** to wipe the in-app table (this does not delete the on-disk log
  file).

The table is capped at `EVENT_RETENTION` rows (default `2000`); older rows are
pruned automatically. See
[Configuration → Logging and activity log](/posterpilot/configuration/#logging-and-activity-log)
for the file log and retention details.
