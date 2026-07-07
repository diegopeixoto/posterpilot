# Changelog

## [0.9.0](https://github.com/diegopeixoto/posterpilot/compare/v0.8.0...v0.9.0) (2026-07-07)


### ⚠ BREAKING CHANGES

* **i18n:** deployments that set the UI locale via `LANGUAGE` must rename it to `APP_LANGUAGE`. Hosts that had `LANGUAGE` set for unrelated POSIX reasons will now correctly fall through to the saved setting or Accept-Language instead of being locked.

### Features

* add toast notifications and skeleton loaders ([8a6a089](https://github.com/diegopeixoto/posterpilot/commit/8a6a08937a9c5ee0b829f2bfce66495f6180c625))
* **branding:** logo'd README hero, favicon, docs logos, Unraid template ([f3add61](https://github.com/diegopeixoto/posterpilot/commit/f3add6113ba8b0ef17546f11279ef5d6f78b7bf4))
* **events:** activity log / events view (*arr-style) ([2be7cfc](https://github.com/diegopeixoto/posterpilot/commit/2be7cfc15b484a7e14783d3b527e8db08ce2f8f3))
* fun menu with random picker + date-added library sort ([6dc1a83](https://github.com/diegopeixoto/posterpilot/commit/6dc1a83278b610e1284e361c102c0f8be6e4abb7))
* FUN menu with random picker + date-added library sort ([cc96b32](https://github.com/diegopeixoto/posterpilot/commit/cc96b3202a5e4069146f5f7d56e5ee203a39fb5f))
* granular season/episode artwork + collapsible artwork sections ([3be1b04](https://github.com/diegopeixoto/posterpilot/commit/3be1b045ea63d6ce29fd2871f14a2f3f87bb5a94))
* granular season/episode artwork + collapsible artwork sections ([193b12d](https://github.com/diegopeixoto/posterpilot/commit/193b12d98cac3d59a789c30f755d650eca413581))
* **i18n:** localize UI to en/es/zh/ja/pt-BR with Paraglide + Weblate ([c4ad50e](https://github.com/diegopeixoto/posterpilot/commit/c4ad50ed7625039dc4534c720f0e68a585a94c5a))
* **i18n:** show pending state while switching language ([f007fdd](https://github.com/diegopeixoto/posterpilot/commit/f007fdd39cdb2093623819b78f2ed492bbce9f2a))
* **item:** friendly apply result message ([a4b9976](https://github.com/diegopeixoto/posterpilot/commit/a4b9976b381b30ba78dd92df4eb340e909fa34eb))
* Kometa manager — manage Kometa's config.yml from a dedicated page ([26782e1](https://github.com/diegopeixoto/posterpilot/commit/26782e12e7c8575fe6ad5880e27ec891912e8c5d))
* **kometa:** co-locate posterpilot.yml with config.yml + config readers/backups ([e458099](https://github.com/diegopeixoto/posterpilot/commit/e4580991ba5555e402178e0a5a5d1d5ad4c2e04b))
* **kometa:** dedicated /kometa manager page with spotlight hero ([69c6ca7](https://github.com/diegopeixoto/posterpilot/commit/69c6ca7f84b6c361a70a37cc1cc12a4dcaa9aab1))
* **kometa:** enrich catalogs from the manual — full sets, descriptions, enums ([1ea724e](https://github.com/diegopeixoto/posterpilot/commit/1ea724ea49a557f1504454cab4bc2455bec0e2d9))
* **kometa:** full orchestration — connectors, overlays, operations, raw, backups ([aeee6c6](https://github.com/diegopeixoto/posterpilot/commit/aeee6c6b77a80d9ccf2b51c8ff5cdeb1fc816264))
* **kometa:** generalize merge engine + connector/overlay/operation catalogs ([a324bcc](https://github.com/diegopeixoto/posterpilot/commit/a324bcc46f1d00f4acfe80d820b15d2bff4a89ae))
* **kometa:** move management off the Settings tab to /kometa; i18n parity ([b76aaf2](https://github.com/diegopeixoto/posterpilot/commit/b76aaf2c064df06d63d407484264100acafe4083))
* **library:** harden bulk apply and fix selection/feedback gaps ([d9412a5](https://github.com/diegopeixoto/posterpilot/commit/d9412a52929aad28c019f26552cca1919ec0d948))
* **library:** Notion-style filter & sort (popovers + chips) ([33ddd8e](https://github.com/diegopeixoto/posterpilot/commit/33ddd8ed636ddedb94421cd859fa02567f4efe4a))
* **logging:** rotating file log (LOG_DIR), configurable retention, Clear activity ([4c30947](https://github.com/diegopeixoto/posterpilot/commit/4c30947cc157b83cf45f5c572b21636aff035dda))
* manage Kometa config.yml from a new settings tab ([b0db76f](https://github.com/diegopeixoto/posterpilot/commit/b0db76f834a1ff4d27e7b082242fe58f154a0813))
* media-server login, encrypted secrets, and scored artwork suggestions ([71a6430](https://github.com/diegopeixoto/posterpilot/commit/71a64301771e627f44f9c4a04951c1571f0d0480))
* media-server login, encrypted secrets, and scored artwork suggestions ([1184420](https://github.com/diegopeixoto/posterpilot/commit/1184420a91185eacd82aab5491ecb994227aa1e0))
* **media-server:** MediaServer abstraction (Plex/Jellyfin/Emby) + Plex login & discovery ([f70fe22](https://github.com/diegopeixoto/posterpilot/commit/f70fe22773f1d69348545cf01a76754d77a80bd2))
* **onboarding,update:** wizard library step + What's New modal ([3bc4df3](https://github.com/diegopeixoto/posterpilot/commit/3bc4df30b730929c01ee77f6670cf1e5ec9611e5))
* **onboarding:** settings tabs, first-install wizard, page titles, UA id ([9c69548](https://github.com/diegopeixoto/posterpilot/commit/9c6954854d7fddfa7ad70914458a3a797e3fb104))
* optional arr-style authentication with security hardening ([bfa12c6](https://github.com/diegopeixoto/posterpilot/commit/bfa12c6b6ad8a2897258fec0457e18d668785162))
* optional auth + hardening and the full plan follow-up set (one version) ([d3eaf13](https://github.com/diegopeixoto/posterpilot/commit/d3eaf13c7f80fe05290808ac6b1f1ed9ff6f2a37))
* **oss:** MIT license, community docs, CI, GHCR publishing, release-please, health endpoint ([5d335d9](https://github.com/diegopeixoto/posterpilot/commit/5d335d96d8fbbaa737287956c29125f5191be818))
* paginate library grid + cached poster-thumbnail proxy ([df87c72](https://github.com/diegopeixoto/posterpilot/commit/df87c72eacae7bc29606be6db67ea7cbf736ef74))
* paginate the library query (WIP — first page + total) ([85eca12](https://github.com/diegopeixoto/posterpilot/commit/85eca12e1a44cdaec5c23fbc488392ed2c5bff5f))
* **plex,ui:** plain-IP local connections, trademark disclaimer, drop verbose hint ([c875602](https://github.com/diegopeixoto/posterpilot/commit/c8756029db218b09c7f79bbd5681a9101bdaf3e6))
* **providers:** poster-provider abstraction + Fanart.tv, TMDB-artwork, ThePosterDB ([6c6108c](https://github.com/diegopeixoto/posterpilot/commit/6c6108c41f22e4dbf97f71abe4037bf394efb472))
* **ui:** MediUX-style redesign — metadata, artwork sets, custom-set builder ([41ccb36](https://github.com/diegopeixoto/posterpilot/commit/41ccb3623d7df85ec1ba59f43c30f22d7c28f80a))
* **ux:** library polish, update checker, view transitions ([df03665](https://github.com/diegopeixoto/posterpilot/commit/df036659ea7fb33ce07960495ca456cc2a16684d))


### Bug Fixes

* **a11y:** keep popover focus indicator visible on open ([5415fc5](https://github.com/diegopeixoto/posterpilot/commit/5415fc5ac7e56e7509e3a66494b9edd9d288e971))
* **a11y:** resolve frontend audit findings (WCAG AA, reduced-motion, focus) ([7131258](https://github.com/diegopeixoto/posterpilot/commit/7131258edccb80805a9d688c11ab3c65d15a804c))
* **a11y:** resolve frontend audit findings (WCAG AA, reduced-motion, focus) ([6d4ed94](https://github.com/diegopeixoto/posterpilot/commit/6d4ed94424df3ae2e596d7ec1ac5211a872db623))
* address PR review findings (encryption key persistence, sync watermark, SSRF) ([e0e6422](https://github.com/diegopeixoto/posterpilot/commit/e0e6422330a727c982319e4b46aeb7fbec7ef2c0))
* address second review pass (clock-skew sync, persistent thumb cache, validation) ([0d5adb4](https://github.com/diegopeixoto/posterpilot/commit/0d5adb4f813b7f6d1eacd1e0838291711a85ee9f))
* address third review pass (strict dryRun, guarded suggestion persist, 401 login) ([2cb443d](https://github.com/diegopeixoto/posterpilot/commit/2cb443dbd46c1917856d44bd047a3806de116723))
* **i18n:** rename LANGUAGE env var to APP_LANGUAGE ([f5d5b16](https://github.com/diegopeixoto/posterpilot/commit/f5d5b16b3fad8c69147a4321692826f73801a2c2))
* **kometa:** address [#16](https://github.com/diegopeixoto/posterpilot/issues/16) review + archive openspec changes ([f80f6b9](https://github.com/diegopeixoto/posterpilot/commit/f80f6b91ca01007557b7072254663279143b698f))
* **kometa:** address PR [#16](https://github.com/diegopeixoto/posterpilot/issues/16) review ([664e2cb](https://github.com/diegopeixoto/posterpilot/commit/664e2cb699c16cc52970e27bcbaec644ae8ebe83))
* **kometa:** address PR [#18](https://github.com/diegopeixoto/posterpilot/issues/18) review ([7b71198](https://github.com/diegopeixoto/posterpilot/commit/7b7119845d43a07f3ab05e79bb33ef7c20a632af))
* **media-server:** 8s timeout on connection tests so Settings never hangs ([6e226b8](https://github.com/diegopeixoto/posterpilot/commit/6e226b89fb2b71c5ecee4b8e5ccfbf3412543c78))
* **poster:** address PR [#20](https://github.com/diegopeixoto/posterpilot/issues/20) review (Copilot + Codex) ([7d2fc74](https://github.com/diegopeixoto/posterpilot/commit/7d2fc74b589679dc711a1b3b0c9179685dd725a2))
* **settings:** bound the library fetch to 5s so Settings never hangs ([2506137](https://github.com/diegopeixoto/posterpilot/commit/2506137c385e9b270ba848afcf8ba4eb1b5ca9cd))
* **settings:** persist numeric fields with type=number inputs ([4937b0d](https://github.com/diegopeixoto/posterpilot/commit/4937b0d16825e724643daa62b8231bdd02e089e8))
* **setup:** require both Plex URL and token before advancing ([5861a6a](https://github.com/diegopeixoto/posterpilot/commit/5861a6afa522648a838ee9fef6a66126ef4ddc7b))
* sort-state drift and shared sort module from self-review ([3f5c86f](https://github.com/diegopeixoto/posterpilot/commit/3f5c86f5e492624f4636381656a4da9e102fd3c8))
* **unraid:** drop trailing colon from CA category and document store listing ([97d592d](https://github.com/diegopeixoto/posterpilot/commit/97d592dc72fb308f89729c8f3a94646cde09f471))
* **unraid:** fix CA category + document Community Apps store listing ([fc72204](https://github.com/diegopeixoto/posterpilot/commit/fc7220423a94b7cd9e97502190e9f80403e516ec))
* **update:** 1h TTL + stale-while-revalidate for the latest-release check ([e0984f0](https://github.com/diegopeixoto/posterpilot/commit/e0984f022372fd4e0449f94402764c591d8ae271))
* **update:** defer What's New until the check resolves; reword cache note ([3f2665e](https://github.com/diegopeixoto/posterpilot/commit/3f2665e7fa807f665de19d060e42b6fb8ebe29c6))
* **update:** only show What's New once the running version's notes resolve ([2bdd4cb](https://github.com/diegopeixoto/posterpilot/commit/2bdd4cbce8d03f714bcf5779c53efbc687cdf6ef))
* **update:** show running-version notes in What's New, re-check periodically ([2298885](https://github.com/diegopeixoto/posterpilot/commit/2298885b4d2983e75ae964ae4b7714bbc778d601))
* **update:** show running-version notes in What's New, re-check periodically ([c1d820c](https://github.com/diegopeixoto/posterpilot/commit/c1d820cd8c48661f8ded71d864ebc1b6331c67f9))
* **ux:** harden destructive actions, validation and a11y across surfaces ([6132e85](https://github.com/diegopeixoto/posterpilot/commit/6132e85a61f7bb836ca67c6ce24dbe0f17f9c2fc))
* **ux:** harden destructive actions, validation, a11y and i18n across surfaces ([b3a6915](https://github.com/diegopeixoto/posterpilot/commit/b3a69150ea9a46eed81fd237e421a9d6d5ea546d))
* **whats-new:** render release notes as markdown ([524c655](https://github.com/diegopeixoto/posterpilot/commit/524c6559eb2c352fcaf19d946b73d1ef91f09082))
* **whats-new:** render release notes as markdown ([bfc421a](https://github.com/diegopeixoto/posterpilot/commit/bfc421a8d10c3ba2135cb65cc7200c3e80664469))

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
