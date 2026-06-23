## 1. Schema & config

- [ ] 1.1 Add `provider` column to `poster_candidates` (text, default `'mediux'`) in `db/schema.ts`; generate the migration
- [ ] 1.2 Add per-provider config to `config/index.ts`: enable flags (`providerMediux`, `providerTmdb`, `providerFanart`, `providerThePosterDb`) + `fanartKey`; env vars + persisted settings + precedence
- [ ] 1.3 Add `fanartKey` to `SECRET_KEYS`; expose enable flags + key-set indicator in the settings load/types

## 2. Provider abstraction

- [ ] 2.1 Define the `PosterProvider` interface + `ProviderSet`/candidate types in `posters/providers/types.ts`
- [ ] 2.2 Build the provider registry (`posters/providers/index.ts`) returning available providers given config
- [ ] 2.3 Unit-test registry availability logic (enabled/disabled, keyed-without-key)

## 3. Providers

- [ ] 3.1 MediUX provider: wrap the existing scraper/parser to implement the interface (behaviour-preserving), tag `mediux`
- [ ] 3.2 TMDB-artwork provider: parse posters/backdrops from the TMDB images endpoint into candidate sets (reuse `tmdbAuth` + cache); pure parser unit-tested
- [ ] 3.3 Fanart.tv provider: fetch `/v3/movies/{tmdbId}` and `/v3/tv/{tvdbId}` (skip TV when no tvdbId); map Fanart types → kinds; pure parser unit-tested
- [ ] 3.4 ThePosterDB provider: scrape the listing payload (mirror the MediUX approach); throttle/retry/cache; disabled by default; pure parser unit-tested

## 4. Discovery fan-out

- [ ] 4.1 Rewrite `discoverForItem` to fan out across available providers, each in its own try/catch, merging sets and persisting `provider` per candidate
- [ ] 4.2 Set the "has artwork" flag (current `hasMediux` column, repurposed) true when any provider returns candidates; record per-provider failures
- [ ] 4.3 Update `autoSelectPoster` to pick by the deterministic provider order across candidates

## 5. UI

- [ ] 5.1 Add `groupByProvider` (provider → sets) in `posters/sets.ts`; unit-test it; update `getItemDetail` to return provider groups
- [ ] 5.2 Item page: render a labelled section per provider, sets within; keep the custom-set builder working across providers
- [ ] 5.3 Settings: provider enable toggles + Fanart.tv key field (masked when set)

## 6. Verification

- [ ] 6.1 `bun run check` / `test` / `build` clean
- [ ] 6.2 `openspec validate poster-providers` passes
- [ ] 6.3 Manual pass: enable Fanart.tv + TMDB; discovery merges providers; item page groups by provider; auto-select honours order
