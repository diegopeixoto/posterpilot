# Changelog

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
