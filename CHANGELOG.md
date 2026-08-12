# Changelog

## [0.12.2](https://github.com/diegopeixoto/posterpilot/compare/v0.12.1...v0.12.2) (2026-08-11)

Two fixes for work that quietly did not finish: a review list that could never be emptied, and a sync that gave up on a whole library because of one title.

### Bug Fixes

* **The last title in a review run can finally be completed.** Working a library down with **Apply and next** left every library permanently reporting one outstanding title, because the last item had no next item and therefore no completing button — only a plain **Apply**, which writes the artwork but never records the review. There was no way to finish it, and no setting that would have helped. The last item now offers **Apply and finish**, which applies, records the review, and returns to the list you came from. ([#101](https://github.com/diegopeixoto/posterpilot/pull/101))
* **One unwritable title no longer abandons the rest of the sync.** A failure while writing a single item — a contended write, a dropped connection, a row the database refused — escaped the loop and ended the entire run, discarding every title after it and reporting the whole sync as one failure. Each item is now isolated: the failure is recorded against that title and the sync carries on. On a ten-title library with one bad entry, that is the difference between two titles synced and nine. A long run of consecutive failures still fails the attempt, because that is the database or the media server rather than the titles, and the job's own retry is the right answer. ([#104](https://github.com/diegopeixoto/posterpilot/pull/104))

### Upgrading

* No database migrations, no configuration changes.

### Still open

* [#91](https://github.com/diegopeixoto/posterpilot/issues/91) remains open. A first sync on a large library can still fail to persist anything; the investigation is ongoing and this release does not address it.

### Contributors

* [@lishremix](https://github.com/lishremix) reported [#100](https://github.com/diegopeixoto/posterpilot/issues/100), noticing that a library always kept one actionable title no matter how much work was done, and saying plainly that they had looked for a way to finalize it and found none. There wasn't one — that was the bug.

## [0.12.1](https://github.com/diegopeixoto/posterpilot/compare/v0.12.0...v0.12.1) (2026-08-10)


### Bug Fixes

* log the cause chain on request errors and retry transient open failures ([#98](https://github.com/diegopeixoto/posterpilot/issues/98)) ([dd28466](https://github.com/diegopeixoto/posterpilot/commit/dd284663a379d387772d24600e068e3afe863cfe))


### Under the hood

* write 0.12.0 release notes ([#96](https://github.com/diegopeixoto/posterpilot/issues/96)) ([3d712b4](https://github.com/diegopeixoto/posterpilot/commit/3d712b40f06440d8e292863daf93bbba702f6a16))

## [0.12.0](https://github.com/diegopeixoto/posterpilot/compare/v0.11.0...v0.12.0) (2026-08-10)

Two things that stopped people cold: a first sync that never finished on a large library, and a migration banner that told you to fix something your config never had.

### Features

* **The Kometa migration banner now names what is actually blocking it.** It used to print one generic error suggesting you remove YAML aliases and merge keys — often from a config containing neither — while the real obstacles were computed and then discarded. Every obstacle is now listed against the library it belongs to: a `libraries:` key matching no synced section comes with a suggestion drawn from your actual section titles (`"Documentarios" does not match any synced section. Similar synced sections: Documentários Filmes, Documentarios Seriados.`), and conflicting types, unsupported types, unowned references and unclassifiable entries each say what they are, in all six languages. The same legacy file listed twice under `metadata_files` is now a fix rather than a dead end: repeats that are provably the same file are collapsed to one entry, while two *different* paths are never merged silently — they are proposed for removal, listed exactly as written, behind their own confirmation checkbox. ([#93](https://github.com/diegopeixoto/posterpilot/pull/93))

### Bug Fixes

* **A large library no longer makes the first sync impossible.** On a Plex section big enough that reading it takes ~30 seconds, every read was abandoned at 20 seconds and retried, three attempts stacking into a 125-second failure that could never have succeeded — no attempt was ever allowed to outlive the server's real response. Library reads now get a 120-second budget per attempt on Plex, Jellyfin and Emby, so a section that answers in half a minute succeeds on the first try. ([#92](https://github.com/diegopeixoto/posterpilot/pull/92))
* **A sync can no longer sit in `running` forever.** A task that hung stayed alive: the heartbeat renewed its lease on a timer whether or not the work advanced, so the lease never expired, recovery never fired, and the only cure was restarting the container. Fifteen minutes with no observable progress now fails the attempt through the normal retry path and stops the abandoned task at its next checkpoint. ([#92](https://github.com/diegopeixoto/posterpilot/pull/92))
* **A retried job no longer shows the previous attempt's error.** A job that was re-claimed kept the old failure text in its row, so a healthy retry looked like a wedged worker. The failure now stays on the attempt it belongs to. ([#92](https://github.com/diegopeixoto/posterpilot/pull/92))

### Under the hood

* The README now shows what the app actually does — four screenshots taken from a populated library instead of two, covering the enlarged preview and artwork coverage — and its screenshots are refreshed by the same one command as the documentation images rather than by hand. The 0.11.0 release notes were also written into `CHANGELOG.md`. ([#89](https://github.com/diegopeixoto/posterpilot/pull/89), [#94](https://github.com/diegopeixoto/posterpilot/pull/94))

### Upgrading

* No database migrations and no configuration changes.
* Library reads now wait up to 120 seconds per attempt instead of 20. A genuinely unreachable server therefore takes longer to report failure than it did before — that is the trade for large libraries being able to sync at all. These reads only happen inside background jobs, never while you are waiting on a page.

### Contributors

* [@ThibaultTourailles](https://github.com/ThibaultTourailles) reported [#91](https://github.com/diegopeixoto/posterpilot/issues/91) with the kind of detail that made it fixable rather than guessable: `curl` timings taken independently of the app, the same failure isolated to a single 3,054-item section, and the observation that the 125-second failures landed on the second every time. Both halves of that report — the stacked retries and the job stuck in `running` — are fixed here.

## [0.11.0](https://github.com/diegopeixoto/posterpilot/compare/v0.10.0...v0.11.0) (2026-08-10)

Every feature and fix below started as an issue from one person. This release is the answer to all eight of them.

### Features

* **Kometa files split by media type** — generated metadata is now `posterpilot-movies.yml` and `posterpilot-shows.yml`, each destination resolved from the media server's authoritative kind (TMDB for movies, TVDB for shows, canonical IMDb as fallback), with numeric mappings emitted as YAML integers the way Kometa 2.x expects. A movie and a show sharing a number can no longer collide. A guided migration moves your existing `posterpilot.yml` across: it previews what it found, classifies entries from real evidence rather than guessing, backs up every target plus `config.yml`, activates the configuration last, and can be resumed, cancelled or rolled back at any point — the legacy file is never deleted. ([#73](https://github.com/diegopeixoto/posterpilot/pull/73), [#74](https://github.com/diegopeixoto/posterpilot/pull/74))
* **Preferred artwork language** — pick a TMDB artwork language in Settings → Providers, independent of the interface language, or let it follow the UI. Artwork TMDB marks as textless always stays available, so a preference never empties a pane of perfectly good posters, and a foreign-language poster is used only when nothing preferred exists — labelled when it happens. Each item also has an on-the-fly Preferred/All switch that leaves your global setting alone. Discovery keeps every language regardless, so changing the preference re-filters instantly instead of re-searching. ([#79](https://github.com/diegopeixoto/posterpilot/pull/79))
* **The whole poster inventory, not the first twenty** — TMDB results were capped at 20 per artwork kind, posters and backdrops counted separately, which is where "capped at 40" came from. Ingestion now validates, de-duplicates and keeps far more, and each pane has a **load more** control reporting how many remain. Posters and backdrops load independently, and candidates you have not revealed do not download their images. ([#79](https://github.com/diegopeixoto/posterpilot/pull/79))
* **Enlarge any candidate** — every tile has its own ⤢ control that opens the full-size artwork uncropped, with its provider, dimensions and language, and previous/next through the candidates currently on screen. It never stages anything: opening, browsing and closing leaves your staged artwork exactly as it was. Works with mouse, keyboard and touch, and returns focus to the button you opened it from. ([#81](https://github.com/diegopeixoto/posterpilot/pull/81))
* **Artwork coverage** — the library, review and item views now report what is actually in place, per destination and per artwork slot, and both lists can be filtered by it — including **needs artwork**. Crucially, a Kometa export says exactly that and never claims artwork was applied: writing a YAML entry proves nothing about what your media server is serving. Artwork replaced outside PosterPilot gets its own state instead of looking like it was never applied, and evidence we could not verify is never reported as absence. ([#82](https://github.com/diegopeixoto/posterpilot/pull/82), [#83](https://github.com/diegopeixoto/posterpilot/pull/83))
* **Provider order you control** — the order providers appear in was really the order their searches happened to finish. It is now the order you set in Settings → Providers, by drag handle or move buttons, and it decides which provider is presented first and breaks ties between equal scores — never overriding a better-scoring cover from further down the list. Disabled providers keep their place. ([#80](https://github.com/diegopeixoto/posterpilot/pull/80))

### Bug Fixes

* TV libraries were matched against TMDB as movies on first sync, so shows resolved to whatever film shared their id — and the wrong artwork followed. Automatic matching now resolves only inside the media server's authoritative movie or TV namespace. Existing installs get a banner offering a targeted repair of just the affected titles, rather than requiring a full rescan. ([#69](https://github.com/diegopeixoto/posterpilot/pull/69))
* Manual TMDB search stopped working after editing the year field, because a partially typed year left the form in an unrecoverable state. Year handling is numeric-or-empty now, and search failures are recoverable instead of terminal. ([#69](https://github.com/diegopeixoto/posterpilot/pull/69))
* Downscaled preview images were written into Kometa metadata instead of the full-resolution asset. Grids browse optimized previews, but what gets applied to your server and written to Kometa is now the canonical original, verified byte-for-byte. ([#72](https://github.com/diegopeixoto/posterpilot/pull/72))
* Staged selections could be lost when discovery re-ran underneath them, and an apply could write over artwork it had not actually verified. Selections now survive rediscovery, and a write refuses when the destination could not be read at all. ([#72](https://github.com/diegopeixoto/posterpilot/pull/72), [#85](https://github.com/diegopeixoto/posterpilot/pull/85))
* Images served with a missing or unusual `Content-Type` — common on home servers and S3-compatible storage — were rejected outright. The declared type is still trusted when it is a known image type; anything else is identified from the file's own bytes. ([#85](https://github.com/diegopeixoto/posterpilot/pull/85))

### Under the hood

* A component test layer running in a real browser, alongside the existing unit and end-to-end suites, because focus handling, live regions and pointer capture are exactly what an emulated DOM models least faithfully. It has already caught two focus bugs that unit tests could not see. ([#80](https://github.com/diegopeixoto/posterpilot/pull/80), [#83](https://github.com/diegopeixoto/posterpilot/pull/83))
* Documentation for everything above in all six languages, and every documentation screenshot is now reproducible from one command instead of being captured by hand. ([#84](https://github.com/diegopeixoto/posterpilot/pull/84))
* Kometa metadata with a hand-edited typo in a slot value no longer fails every export and apply for that entry, collection discovery survives a member deleted mid-request, and TMDB ids filed under the other namespace resolve again. ([#86](https://github.com/diegopeixoto/posterpilot/pull/86), [#87](https://github.com/diegopeixoto/posterpilot/pull/87))

### Upgrading

* **Back up your `data/` directory before upgrading.** Four database migrations run on first start. They are additive — nothing is rewritten or deleted — but there is no downgrade path.
* **Kometa users: your metadata moves to two files.** `posterpilot.yml` is replaced by `posterpilot-movies.yml` and `posterpilot-shows.yml`. The migration is guided and reversible, it backs up your existing files and `config.yml` first, and it never deletes the legacy file. Nothing changes until you run it.
* Artwork coverage starts empty and fills in as titles are synced, applied, or opened — the upgrade deliberately does not guess coverage for artwork applied before it existed.
* No configuration is required. The new artwork-language preference defaults to every language, which is exactly how browsing behaved before.

### Contributors

This release exists because of [@lishremix](https://github.com/lishremix), who filed all eight issues it closes — and did both halves of the work that makes an issue useful.

**Found the bugs**, with enough detail to reproduce them:

* TV libraries resolving against TMDB as movies on first sync, which quietly attached the wrong artwork to entire show libraries ([#64](https://github.com/diegopeixoto/posterpilot/issues/64))
* manual TMDB search dying after the year field was edited ([#61](https://github.com/diegopeixoto/posterpilot/issues/61))
* downscaled preview images being written into Kometa metadata instead of the full-size asset ([#63](https://github.com/diegopeixoto/posterpilot/issues/63))

**Asked for the features**, and framed them well enough to shape how they were built:

* a preferred TMDB artwork language, including the "unless there is no poster in my language" exception that became the labelled fallback ([#62](https://github.com/diegopeixoto/posterpilot/issues/62))
* more than the first page of TMDB results — and the observation that the cap hurt *because* language could not be filtered, which is why both shipped together ([#68](https://github.com/diegopeixoto/posterpilot/issues/68))
* splitting Kometa metadata by media type ([#66](https://github.com/diegopeixoto/posterpilot/issues/66))
* a quick way to enlarge a poster before choosing it ([#65](https://github.com/diegopeixoto/posterpilot/issues/65))
* somewhere to see what artwork has actually been set across servers and libraries ([#67](https://github.com/diegopeixoto/posterpilot/issues/67))

## [0.10.0](https://github.com/diegopeixoto/posterpilot/compare/v0.9.0...v0.10.0) (2026-07-26)

This is the first PosterPilot release built with the community — every Jellyfin fix
below started as a contributed PR, and a substantial share of the features were
upstreamed from the [Bubu31/posterpilot](https://github.com/Bubu31/posterpilot) fork.

### Features

* **ThePosterDB, properly** — optional account sign-in (the site serves placeholder images to anonymous visitors; credentials are encrypted at rest and never required), real contributor sets with author attribution, and the group expanded by default on the item page. For collections, PosterPilot now finds ThePosterDB's own collection sets and matches them onto your members as one coordinated design. ([#48](https://github.com/diegopeixoto/posterpilot/pull/48), [#52](https://github.com/diegopeixoto/posterpilot/pull/52), [#53](https://github.com/diegopeixoto/posterpilot/pull/53))
* **Re-search on demand** — a per-provider ⟳ button on every item's provider group, and a whole-collection re-search that reports how many members succeeded. Each provider also keeps a reserved share of the candidate list, so one high-scoring source can't crowd the others out. ([#50](https://github.com/diegopeixoto/posterpilot/pull/50), [#52](https://github.com/diegopeixoto/posterpilot/pull/52))
* **One-click apply** — a single-item plan with nothing skipped applies in the same click. Any plan carrying a skip, and the apply-and-next flow, keep the confirmation dialog; the server-side preview/confirm contract is unchanged. ([#49](https://github.com/diegopeixoto/posterpilot/pull/49), [#51](https://github.com/diegopeixoto/posterpilot/pull/51))
* **French** — the sixth UI language, across the whole app and the documentation site. ([#54](https://github.com/diegopeixoto/posterpilot/pull/54))
* **Credits where due** — the app and docs footers now carry the version, maintainer, and Aquarela links. ([#47](https://github.com/diegopeixoto/posterpilot/pull/47))

### Bug Fixes

* Applying artwork on Jellyfin 10.11.x failed with a generic error: the server dropped the single-item metadata endpoint. Artwork reads now use the list form 10.11 still serves. ([#38](https://github.com/diegopeixoto/posterpilot/pull/38))
* Jellyfin backdrops were appended behind the existing one, so applies "succeeded" while the visible art never changed. Existing backdrops are now cleared first — order-safely, since Jellyfin's tag order does not match its delete index. ([#40](https://github.com/diegopeixoto/posterpilot/pull/40))
* Merged-version movies appeared two or three times, library extras leaked in as movies, and watched state never arrived. The library — and collections, seasons, and episodes — are now read through the same user-scoped view the Jellyfin UI uses, resolved once per snapshot so mixed reads can't corrupt collection membership. ([#41](https://github.com/diegopeixoto/posterpilot/pull/41), [#45](https://github.com/diegopeixoto/posterpilot/pull/45))
* ThePosterDB discovery always returned nothing: the search page contains no poster images. The matching set page is now opened instead, chosen by strict title *and* year so a remake never gets the wrong film's artwork. ([#42](https://github.com/diegopeixoto/posterpilot/pull/42))
* Even then, every ThePosterDB apply was silently dropped: the site's image CDN wasn't on the trusted-host list. ([#48](https://github.com/diegopeixoto/posterpilot/pull/48))
* Concurrent provider discovery could fail with "database is locked". The database now runs in WAL mode and every discovery write goes through a single write queue. ([#50](https://github.com/diegopeixoto/posterpilot/pull/50), [#53](https://github.com/diegopeixoto/posterpilot/pull/53))
* Candidates from a provider you disabled (or whose credential is gone) no longer appear on the item page; re-enabling brings them back without re-searching. ([#50](https://github.com/diegopeixoto/posterpilot/pull/50))
* The documentation site had failed to build since the Astro 7 upgrade; docs deploys work again. ([#47](https://github.com/diegopeixoto/posterpilot/pull/47))
* Reads could briefly fail with a flashing error while a large sync was writing: reads now retry bounded on database contention, complementing the write queue. ([#58](https://github.com/diegopeixoto/posterpilot/pull/58))
* A stored ThePosterDB password could not be removed from the settings page; a clear control now deletes it on save and returns the provider to anonymous mode. ([#59](https://github.com/diegopeixoto/posterpilot/pull/59))

### Under the hood

* Every new feature is documented — ThePosterDB accounts, collection discovery, re-search, and the one-click contract — in all six languages. ([#51](https://github.com/diegopeixoto/posterpilot/pull/51), [#55](https://github.com/diegopeixoto/posterpilot/pull/55))
* Docs toolchain moved to Astro 7. ([#39](https://github.com/diegopeixoto/posterpilot/pull/39), [#43](https://github.com/diegopeixoto/posterpilot/pull/43))

### Upgrading

* No database migration. WAL mode is applied automatically and is reversible; ThePosterDB credentials are optional and everything works anonymously as before.

### Contributors

* [@nasspium](https://github.com/nasspium) — the entire Jellyfin 10.11 compatibility series and the ThePosterDB set-page fix ([#38](https://github.com/diegopeixoto/posterpilot/pull/38), [#40](https://github.com/diegopeixoto/posterpilot/pull/40), [#41](https://github.com/diegopeixoto/posterpilot/pull/41), [#42](https://github.com/diegopeixoto/posterpilot/pull/42)), each verified against a live server.
* [@Bubu31](https://github.com/Bubu31) (with [@LeGrosBubu](https://github.com/LeGrosBubu)) — ThePosterDB accounts, real sets and collection matching, discovery stability, one-click apply, disabled-provider filtering, and the CDN trust fix, upstreamed from their fork with co-authorship ([#48](https://github.com/diegopeixoto/posterpilot/pull/48)–[#53](https://github.com/diegopeixoto/posterpilot/pull/53)). They also independently found and fixed the Jellyfin bugs above.

## [0.9.0](https://github.com/diegopeixoto/posterpilot/compare/v0.8.0...v0.9.0) (2026-07-13)


### Features

* **Multiple media servers** — name, test, and switch between Plex, Jellyfin, and Emby servers without mixing their libraries or credentials. The existing connection is carried over automatically as a protected default server, so nothing changes until you add a second one. ([#35](https://github.com/diegopeixoto/posterpilot/pull/35))
* **Review inbox** — one queue for everything that needs a decision: unresolved titles, ready suggestions, staged artwork, partial failures, and titles changed on the server. Saved views, manual TMDB matching with an audit trail, and apply-and-next to work straight through. ([#35](https://github.com/diegopeixoto/posterpilot/pull/35))
* **Exact previews, verification, and undo** — every artwork write shows the precise plan first (uploads, Kometa exports, skips), executes only what was confirmed, verifies each destination afterwards, and records a revision per slot. Anything applied can be undone from the artwork timeline — a slot, a season, one revision, or the whole item — restoring the byte-exact artwork that was there before. ([#35](https://github.com/diegopeixoto/posterpilot/pull/35))
* **Collections** — coordinate a collection's own artwork with its members', apply the family as one job, and undo the whole group together. ([#35](https://github.com/diegopeixoto/posterpilot/pull/35))
* **Automation that never applies on its own** — run sync and discovery on an interval, at a time of day, or on a media event, and route the results to the review inbox. Automations are review-only by design: they queue decisions, they never write artwork. Inbound webhooks with one-time tokens included. ([#35](https://github.com/diegopeixoto/posterpilot/pull/35))
* **Backups and recovery** — create, verify, and export application backups. A restore runs a full safety preflight (integrity, schema compatibility, disk space, encryption key), keeps a protected pre-restore safety backup, and stages the swap for the next restart with automatic rollback if readiness checks fail. ([#35](https://github.com/diegopeixoto/posterpilot/pull/35))
* **FUN** — filtered random picks, blind reveal, poster match, an ambient full-screen gallery, and a session planner that fits the available time. All read-only: FUN never applies artwork. ([#35](https://github.com/diegopeixoto/posterpilot/pull/35))


### Bug Fixes

* Automations scoped to a library never fired when a sync added new items to more than one library — the event carried ids from every library, and the scoped schedule silently rejected them. ([#35](https://github.com/diegopeixoto/posterpilot/pull/35))
* Changes made after confirming a restore, while the app awaited its restart, were accepted and then discarded by the restore. Writes are now rejected for that window, and every page says why. ([#35](https://github.com/diegopeixoto/posterpilot/pull/35))
* Jellyfin, Emby, and plex.tv requests could hang indefinitely against a stalled server. Every call now has a timeout. ([#35](https://github.com/diegopeixoto/posterpilot/pull/35))
* The review inbox pulled keyboard focus back to the previous card after each action. ([#35](https://github.com/diegopeixoto/posterpilot/pull/35))


### Under the hood

* Durable jobs with lease-based crash recovery — undo runs on the queue too, so a large collection undo reports progress and survives a restart. ([#35](https://github.com/diegopeixoto/posterpilot/pull/35))
* Diagnostics and support bundles with fail-closed secret redaction, an isolated Playwright suite covering setup through authentication, and reproducible documentation screenshots. ([#35](https://github.com/diegopeixoto/posterpilot/pull/35))


### Upgrading

* This release ships a substantial database migration that creates the multi-server, revision, automation, and backup storage, and re-scopes existing media, jobs, and candidates onto the carried-over server. It runs in a single transaction and rolls back cleanly on failure, but back up the `data/` directory before upgrading — there is no downgrade path. ([#35](https://github.com/diegopeixoto/posterpilot/pull/35))

## [0.8.0](https://github.com/diegopeixoto/posterpilot/compare/v0.7.0...v0.8.0) (2026-07-07)


### Features

* **Optional login** — require a username and password to reach PosterPilot, *arr-style: off by default, or on except for local-network addresses. Signed sessions, an `AUTH_MODE` env override that recovers a locked-out instance, and fail-closed handling behind a reverse proxy. Enabling it is non-breaking — existing installs are untouched until you opt in. ([#30](https://github.com/diegopeixoto/posterpilot/pull/30))
* **Faster large libraries** — the library wall now loads a page at a time and fills in as you scroll instead of shipping every title in one payload, and posters are served through a cached, grid-sized thumbnail proxy, so browsing a big library is far snappier. ([#30](https://github.com/diegopeixoto/posterpilot/pull/30))
* **Clearer feedback** — toast notifications for saves and actions, plus skeleton placeholders while the grid loads. ([#30](https://github.com/diegopeixoto/posterpilot/pull/30))
* **Safer by default** — custom-poster uploads are validated by content and size, every response carries baseline security headers, outbound requests honor provider rate limits (`Retry-After`), and authentication events are logged (never the password). ([#30](https://github.com/diegopeixoto/posterpilot/pull/30))


### Under the hood

* Added an ESLint gate, more test coverage (Kometa catalogs), de-duplicated Plex upload code, and began splitting the settings/library pages into components. ([#30](https://github.com/diegopeixoto/posterpilot/pull/30))

## [0.7.0](https://github.com/diegopeixoto/posterpilot/compare/v0.6.0...v0.7.0) (2026-07-02)


### Features

* fun menu with random picker + date-added library sort ([6dc1a83](https://github.com/diegopeixoto/posterpilot/commit/6dc1a83278b610e1284e361c102c0f8be6e4abb7))
* FUN menu with random picker + date-added library sort ([cc96b32](https://github.com/diegopeixoto/posterpilot/commit/cc96b3202a5e4069146f5f7d56e5ee203a39fb5f))


### Bug Fixes

* sort-state drift and shared sort module from self-review ([3f5c86f](https://github.com/diegopeixoto/posterpilot/commit/3f5c86f5e492624f4636381656a4da9e102fd3c8))

## [0.6.0](https://github.com/diegopeixoto/posterpilot/compare/v0.5.0...v0.6.0) (2026-06-28)


### Features

* **Sign in without token hunting** — log in to Jellyfin/Emby with a username and password, or to Plex with a "Login with Plex" button; pasting a token/API key still works as a fallback. ([#23](https://github.com/diegopeixoto/posterpilot/pull/23))
* **Encrypted secrets at rest** — media-server tokens and provider API keys are encrypted (AES-256-GCM) with a key the app generates automatically; existing installs keep working and migrate on the next save. ([#23](https://github.com/diegopeixoto/posterpilot/pull/23))
* **Suggested artwork** — candidates are scored (provider, resolution, aspect) and the best is pre-selected for the show and each season/episode as an overridable suggestion you can turn off. ([#23](https://github.com/diegopeixoto/posterpilot/pull/23))
* **Dry-run preview** — see exactly what a single or bulk apply would upload, export, and skip before committing. ([#23](https://github.com/diegopeixoto/posterpilot/pull/23))
* **Ignore list** — mark items to leave untouched; they're skipped by discovery, apply, and auto-select, and filterable in the library. ([#23](https://github.com/diegopeixoto/posterpilot/pull/23))
* **Faster libraries** — incremental sync skips items unchanged on the server, and bulk apply runs with bounded concurrency. ([#23](https://github.com/diegopeixoto/posterpilot/pull/23))
* **Thumbnail cache** — provider preview images are cached on disk and served through a proxy for snappier browsing. ([#23](https://github.com/diegopeixoto/posterpilot/pull/23))

## [0.5.0](https://github.com/diegopeixoto/posterpilot/compare/v0.4.1...v0.5.0) (2026-06-28)


### Features

* granular season/episode artwork + collapsible artwork sections ([3be1b04](https://github.com/diegopeixoto/posterpilot/commit/3be1b045ea63d6ce29fd2871f14a2f3f87bb5a94))
* granular season/episode artwork + collapsible artwork sections ([193b12d](https://github.com/diegopeixoto/posterpilot/commit/193b12d98cac3d59a789c30f755d650eca413581))


### Bug Fixes

* **poster:** address PR [#20](https://github.com/diegopeixoto/posterpilot/issues/20) review (Copilot + Codex) ([7d2fc74](https://github.com/diegopeixoto/posterpilot/commit/7d2fc74b589679dc711a1b3b0c9179685dd725a2))

## [0.4.1](https://github.com/diegopeixoto/posterpilot/compare/v0.4.0...v0.4.1) (2026-06-27)


### Bug Fixes

* **kometa:** address [#16](https://github.com/diegopeixoto/posterpilot/issues/16) review + archive openspec changes ([f80f6b9](https://github.com/diegopeixoto/posterpilot/commit/f80f6b91ca01007557b7072254663279143b698f))
* **kometa:** address PR [#16](https://github.com/diegopeixoto/posterpilot/issues/16) review ([664e2cb](https://github.com/diegopeixoto/posterpilot/commit/664e2cb699c16cc52970e27bcbaec644ae8ebe83))
* **kometa:** address PR [#18](https://github.com/diegopeixoto/posterpilot/issues/18) review ([7b71198](https://github.com/diegopeixoto/posterpilot/commit/7b7119845d43a07f3ab05e79bb33ef7c20a632af))

## [0.4.0](https://github.com/diegopeixoto/posterpilot/compare/v0.3.2...v0.4.0) (2026-06-26)


### Features

* Kometa manager — manage Kometa's config.yml from a dedicated page ([26782e1](https://github.com/diegopeixoto/posterpilot/commit/26782e12e7c8575fe6ad5880e27ec891912e8c5d))
* **kometa:** co-locate posterpilot.yml with config.yml + config readers/backups ([e458099](https://github.com/diegopeixoto/posterpilot/commit/e4580991ba5555e402178e0a5a5d1d5ad4c2e04b))
* **kometa:** dedicated /kometa manager page with spotlight hero ([69c6ca7](https://github.com/diegopeixoto/posterpilot/commit/69c6ca7f84b6c361a70a37cc1cc12a4dcaa9aab1))
* **kometa:** enrich catalogs from the manual — full sets, descriptions, enums ([1ea724e](https://github.com/diegopeixoto/posterpilot/commit/1ea724ea49a557f1504454cab4bc2455bec0e2d9))
* **kometa:** full orchestration — connectors, overlays, operations, raw, backups ([aeee6c6](https://github.com/diegopeixoto/posterpilot/commit/aeee6c6b77a80d9ccf2b51c8ff5cdeb1fc816264))
* **kometa:** generalize merge engine + connector/overlay/operation catalogs ([a324bcc](https://github.com/diegopeixoto/posterpilot/commit/a324bcc46f1d00f4acfe80d820b15d2bff4a89ae))
* **kometa:** move management off the Settings tab to /kometa; i18n parity ([b76aaf2](https://github.com/diegopeixoto/posterpilot/commit/b76aaf2c064df06d63d407484264100acafe4083))
* manage Kometa config.yml from a new settings tab ([b0db76f](https://github.com/diegopeixoto/posterpilot/commit/b0db76f834a1ff4d27e7b082242fe58f154a0813))

## [0.3.2](https://github.com/diegopeixoto/posterpilot/compare/v0.3.1...v0.3.2) (2026-06-24)


### Bug Fixes

* **unraid:** drop trailing colon from CA category and document store listing ([97d592d](https://github.com/diegopeixoto/posterpilot/commit/97d592dc72fb308f89729c8f3a94646cde09f471))
* **unraid:** fix CA category + document Community Apps store listing ([fc72204](https://github.com/diegopeixoto/posterpilot/commit/fc7220423a94b7cd9e97502190e9f80403e516ec))

## [0.3.1](https://github.com/diegopeixoto/posterpilot/compare/v0.3.0...v0.3.1) (2026-06-24)


### Bug Fixes

* **update:** 1h TTL + stale-while-revalidate for the latest-release check ([e0984f0](https://github.com/diegopeixoto/posterpilot/commit/e0984f022372fd4e0449f94402764c591d8ae271))
* **update:** defer What's New until the check resolves; reword cache note ([3f2665e](https://github.com/diegopeixoto/posterpilot/commit/3f2665e7fa807f665de19d060e42b6fb8ebe29c6))
* **update:** only show What's New once the running version's notes resolve ([2bdd4cb](https://github.com/diegopeixoto/posterpilot/commit/2bdd4cbce8d03f714bcf5779c53efbc687cdf6ef))
* **update:** show running-version notes in What's New, re-check periodically ([2298885](https://github.com/diegopeixoto/posterpilot/commit/2298885b4d2983e75ae964ae4b7714bbc778d601))
* **update:** show running-version notes in What's New, re-check periodically ([c1d820c](https://github.com/diegopeixoto/posterpilot/commit/c1d820cd8c48661f8ded71d864ebc1b6331c67f9))

## [0.3.0](https://github.com/diegopeixoto/posterpilot/compare/v0.2.2...v0.3.0) (2026-06-24)


### ⚠ BREAKING CHANGES

* **i18n:** deployments that set the UI locale via `LANGUAGE` must rename it to `APP_LANGUAGE`. Hosts that had `LANGUAGE` set for unrelated POSIX reasons will now correctly fall through to the saved setting or Accept-Language instead of being locked.

### Features

* **i18n:** show pending state while switching language ([f007fdd](https://github.com/diegopeixoto/posterpilot/commit/f007fdd39cdb2093623819b78f2ed492bbce9f2a))


### Bug Fixes

* **i18n:** rename LANGUAGE env var to APP_LANGUAGE ([f5d5b16](https://github.com/diegopeixoto/posterpilot/commit/f5d5b16b3fad8c69147a4321692826f73801a2c2))
* **settings:** persist numeric fields with type=number inputs ([4937b0d](https://github.com/diegopeixoto/posterpilot/commit/4937b0d16825e724643daa62b8231bdd02e089e8))
* **setup:** require both Plex URL and token before advancing ([5861a6a](https://github.com/diegopeixoto/posterpilot/commit/5861a6afa522648a838ee9fef6a66126ef4ddc7b))
* **ux:** harden destructive actions, validation and a11y across surfaces ([6132e85](https://github.com/diegopeixoto/posterpilot/commit/6132e85a61f7bb836ca67c6ce24dbe0f17f9c2fc))
* **ux:** harden destructive actions, validation, a11y and i18n across surfaces ([b3a6915](https://github.com/diegopeixoto/posterpilot/commit/b3a69150ea9a46eed81fd237e421a9d6d5ea546d))

## [0.2.2](https://github.com/diegopeixoto/posterpilot/compare/v0.2.1...v0.2.2) (2026-06-24)


### Bug Fixes

* **whats-new:** render release notes as markdown ([524c655](https://github.com/diegopeixoto/posterpilot/commit/524c6559eb2c352fcaf19d946b73d1ef91f09082))
* **whats-new:** render release notes as markdown ([bfc421a](https://github.com/diegopeixoto/posterpilot/commit/bfc421a8d10c3ba2135cb65cc7200c3e80664469))

## [0.2.1](https://github.com/diegopeixoto/posterpilot/compare/v0.2.0...v0.2.1) (2026-06-24)


### Bug Fixes

* **a11y:** keep popover focus indicator visible on open ([5415fc5](https://github.com/diegopeixoto/posterpilot/commit/5415fc5ac7e56e7509e3a66494b9edd9d288e971))
* **a11y:** resolve frontend audit findings (WCAG AA, reduced-motion, focus) ([7131258](https://github.com/diegopeixoto/posterpilot/commit/7131258edccb80805a9d688c11ab3c65d15a804c))
* **a11y:** resolve frontend audit findings (WCAG AA, reduced-motion, focus) ([6d4ed94](https://github.com/diegopeixoto/posterpilot/commit/6d4ed94424df3ae2e596d7ec1ac5211a872db623))

## [0.2.0](https://github.com/diegopeixoto/posterpilot/compare/v0.1.0...v0.2.0) (2026-06-23)


### Features

* **branding:** logo'd README hero, favicon, docs logos, Unraid template ([f3add61](https://github.com/diegopeixoto/posterpilot/commit/f3add6113ba8b0ef17546f11279ef5d6f78b7bf4))
* **events:** activity log / events view (*arr-style) ([2be7cfc](https://github.com/diegopeixoto/posterpilot/commit/2be7cfc15b484a7e14783d3b527e8db08ce2f8f3))
* **i18n:** localize UI to en/es/zh/ja/pt-BR with Paraglide + Weblate ([c4ad50e](https://github.com/diegopeixoto/posterpilot/commit/c4ad50ed7625039dc4534c720f0e68a585a94c5a))
* **item:** friendly apply result message ([a4b9976](https://github.com/diegopeixoto/posterpilot/commit/a4b9976b381b30ba78dd92df4eb340e909fa34eb))
* **library:** Notion-style filter & sort (popovers + chips) ([33ddd8e](https://github.com/diegopeixoto/posterpilot/commit/33ddd8ed636ddedb94421cd859fa02567f4efe4a))
* **logging:** rotating file log (LOG_DIR), configurable retention, Clear activity ([4c30947](https://github.com/diegopeixoto/posterpilot/commit/4c30947cc157b83cf45f5c572b21636aff035dda))
* **media-server:** MediaServer abstraction (Plex/Jellyfin/Emby) + Plex login & discovery ([f70fe22](https://github.com/diegopeixoto/posterpilot/commit/f70fe22773f1d69348545cf01a76754d77a80bd2))
* **onboarding,update:** wizard library step + What's New modal ([3bc4df3](https://github.com/diegopeixoto/posterpilot/commit/3bc4df30b730929c01ee77f6670cf1e5ec9611e5))
* **onboarding:** settings tabs, first-install wizard, page titles, UA id ([9c69548](https://github.com/diegopeixoto/posterpilot/commit/9c6954854d7fddfa7ad70914458a3a797e3fb104))
* **oss:** MIT license, community docs, CI, GHCR publishing, release-please, health endpoint ([5d335d9](https://github.com/diegopeixoto/posterpilot/commit/5d335d96d8fbbaa737287956c29125f5191be818))
* **plex,ui:** plain-IP local connections, trademark disclaimer, drop verbose hint ([c875602](https://github.com/diegopeixoto/posterpilot/commit/c8756029db218b09c7f79bbd5681a9101bdaf3e6))
* **providers:** poster-provider abstraction + Fanart.tv, TMDB-artwork, ThePosterDB ([6c6108c](https://github.com/diegopeixoto/posterpilot/commit/6c6108c41f22e4dbf97f71abe4037bf394efb472))
* **ui:** MediUX-style redesign — metadata, artwork sets, custom-set builder ([41ccb36](https://github.com/diegopeixoto/posterpilot/commit/41ccb3623d7df85ec1ba59f43c30f22d7c28f80a))
* **ux:** library polish, update checker, view transitions ([df03665](https://github.com/diegopeixoto/posterpilot/commit/df036659ea7fb33ce07960495ca456cc2a16684d))


### Bug Fixes

* **media-server:** 8s timeout on connection tests so Settings never hangs ([6e226b8](https://github.com/diegopeixoto/posterpilot/commit/6e226b89fb2b71c5ecee4b8e5ccfbf3412543c78))
* **settings:** bound the library fetch to 5s so Settings never hangs ([2506137](https://github.com/diegopeixoto/posterpilot/commit/2506137c385e9b270ba848afcf8ba4eb1b5ca9cd))

## Changelog

All notable changes to PosterPilot are documented in this file.

This file is maintained automatically by
[release-please](https://github.com/googleapis/release-please) from
[Conventional Commits](https://www.conventionalcommits.org/). Do not edit it by
hand — write good commit messages instead.
