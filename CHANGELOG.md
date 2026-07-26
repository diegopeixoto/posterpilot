# Changelog

## [0.10.0](https://github.com/diegopeixoto/posterpilot/compare/v0.9.0...v0.10.0) (2026-07-26)


### Features

* credit the maintainer and Aquarela in the app and docs footers ([5cdd391](https://github.com/diegopeixoto/posterpilot/commit/5cdd391f7bd4d482ac2bf47e6cc55ada9103524b))
* discovery stability and per-provider controls ([c12256a](https://github.com/diegopeixoto/posterpilot/commit/c12256a37a7fa89729d126e136127de970e17af0))
* discovery stability and per-provider controls ([4db99f3](https://github.com/diegopeixoto/posterpilot/commit/4db99f3e8c71ed3afeb7e7205038caaea1ab2697))
* **i18n:** add French across the app and docs ([2d2427b](https://github.com/diegopeixoto/posterpilot/commit/2d2427b800d7fbdd2cbc14d181d38fe33d64f866))
* **i18n:** add French across the app and docs ([bad5240](https://github.com/diegopeixoto/posterpilot/commit/bad5240d5d0a5894549c7b192c24a2c9f893f9b5))
* **item:** apply warning-free plans in a single click ([40d8ac2](https://github.com/diegopeixoto/posterpilot/commit/40d8ac23754e13d90685c45edac58c7f344dea20))
* **item:** apply warning-free plans in a single click ([4c21157](https://github.com/diegopeixoto/posterpilot/commit/4c2115769cda274d2604079642600cdf6feeb018))
* **theposterdb:** account sessions, real sets, and collection set matching ([095d0b0](https://github.com/diegopeixoto/posterpilot/commit/095d0b0605c065e06bc78b837d620592d075c699))
* **theposterdb:** account sessions, real sets, and collection set matching ([6ddcbdc](https://github.com/diegopeixoto/posterpilot/commit/6ddcbdc46383da9ad34c1e7e046cf274b784f251))
* update docs and mantainer info ([16db5d1](https://github.com/diegopeixoto/posterpilot/commit/16db5d186cdb2c92b1039a3dceb52818b811524d))


### Bug Fixes

* **apply:** trust ThePosterDB's CDN host for artwork bytes ([1698bb4](https://github.com/diegopeixoto/posterpilot/commit/1698bb4b8586835988f56aaeb2de3227e4d9095f))
* **apply:** trust ThePosterDB's CDN host for artwork bytes ([db2d5d0](https://github.com/diegopeixoto/posterpilot/commit/db2d5d080fe8104fd14adcb0d2dd8661506a0800))
* **db:** retry reads bounded on SQLITE_BUSY ([e0a7169](https://github.com/diegopeixoto/posterpilot/commit/e0a7169ebc7f746a40a45bdf6961563f0016b2e7))
* **db:** retry reads bounded on SQLITE_BUSY ([dd13aff](https://github.com/diegopeixoto/posterpilot/commit/dd13aff61fc656d30c50501153ecf04448c52203)), closes [#56](https://github.com/diegopeixoto/posterpilot/issues/56)
* **discovery:** queue the collection-set candidate injection ([d08d6d5](https://github.com/diegopeixoto/posterpilot/commit/d08d6d539149ad0eb18e8948c7984b596b5722b9))
* **discovery:** queue the collection-set candidate injection ([ef4b604](https://github.com/diegopeixoto/posterpilot/commit/ef4b604d74d92fcddf8c7c41148523a46db9daf8))
* **discovery:** serialize the full discovery lifecycle and staging writes ([cfd23c4](https://github.com/diegopeixoto/posterpilot/commit/cfd23c414b0babdc1516bb74ab0ce2e5d577f4b1))
* **docs:** build without the app's generated tsconfig ([014180d](https://github.com/diegopeixoto/posterpilot/commit/014180d95df319103d19cac824b931a40ec938ce))
* **jellyfin:** keep the backdrop prune best-effort when the count read fails ([55e4807](https://github.com/diegopeixoto/posterpilot/commit/55e480761e188257639b01e1a972ce9afc0461b5))
* **jellyfin:** only scope the library read to an admin, retry lookup on error ([f21d369](https://github.com/diegopeixoto/posterpilot/commit/f21d36995ca74e21bf4effae10e4deabc4e04583))
* **jellyfin:** read current artwork via /Items?ids= for Jellyfin 10.11.x ([a434ad3](https://github.com/diegopeixoto/posterpilot/commit/a434ad3e7714901b428001618f846cd178645836))
* **jellyfin:** read current artwork via /Items?ids= for Jellyfin 10.11.x ([47a61fe](https://github.com/diegopeixoto/posterpilot/commit/47a61fe33c6d606d1f5e5ec150c9d18a19c8f552))
* **jellyfin:** read the library via /Users/{id}/Items so merged versions collapse ([8be4658](https://github.com/diegopeixoto/posterpilot/commit/8be4658e0ac4aeaa3a7c33cff19c9ec71689066b))
* **jellyfin:** read the library via /Users/{id}/Items so merged versions collapse ([3298bb5](https://github.com/diegopeixoto/posterpilot/commit/3298bb5bb44656218db1566f598e16882672c3c7))
* **jellyfin:** replace the backdrop instead of appending on apply ([ad96d4a](https://github.com/diegopeixoto/posterpilot/commit/ad96d4aa254a650c2423c63922192bee37e982f7))
* **jellyfin:** replace the backdrop instead of appending on apply ([7085863](https://github.com/diegopeixoto/posterpilot/commit/70858633ba12db66eb09cf8da9781b417e6cbb27))
* **jellyfin:** resolve one user scope per collection snapshot ([a2249d2](https://github.com/diegopeixoto/posterpilot/commit/a2249d23b04bca55860cec19f863b1d76487f61d))
* **jellyfin:** user-scope collection and season/episode reads ([0b073ac](https://github.com/diegopeixoto/posterpilot/commit/0b073ac75db359f4e70771f2fa5910a4c423b7de))
* **jellyfin:** user-scope collection and season/episode reads ([8343af1](https://github.com/diegopeixoto/posterpilot/commit/8343af1c5e3db0ecd1aa7df3c92a6a204fc4eada))
* **settings:** add a clear control for the ThePosterDB password ([0b61787](https://github.com/diegopeixoto/posterpilot/commit/0b617872277c9a64f971ac344a5927fbc11982cd))
* **settings:** add a clear control for the ThePosterDB password ([cfada2b](https://github.com/diegopeixoto/posterpilot/commit/cfada2bf9bdca8d3b3d3951ff2b69d480ed73fd5)), closes [#57](https://github.com/diegopeixoto/posterpilot/issues/57)
* **theposterdb:** open the matched set page — the search page has no posters ([4e1ad02](https://github.com/diegopeixoto/posterpilot/commit/4e1ad02e629b59faf036985c5a3b8c99cb4bccd9))
* **theposterdb:** open the matched set page — the search page has no posters ([9c485b3](https://github.com/diegopeixoto/posterpilot/commit/9c485b3f049e06c96e1ae249184e32a912bd7fc9))
* **theposterdb:** require the year to match when the wanted year is known ([8e87ea2](https://github.com/diegopeixoto/posterpilot/commit/8e87ea2a6482fe4cfae7818515c68a4660015147))

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
