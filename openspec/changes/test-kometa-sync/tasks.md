## 1. Testability seams

- [x] 1.1 Reviewed the kometa module. Finding: the merge/diff/round-trip **core** is already well-covered (`config.test.ts` ~13KB covers `buildPlan`/`applyPlan`/`buildOwnedDoc`; `yaml.test.ts` covers the YAML round-trip; `config-io.test.ts`/`selection.test.ts`/`catalogs.test.ts` exist). The real gap was the **catalog-lookup modules** that feed the sync, which had no tests. `sync.ts` itself is async orchestration over `$env`/db/fs — its pure surface (`kometaOutputDir`) can't be imported without pulling `$env`, so it's exercised via the covered plan builders instead.

## 2. Tests

- [x] 2.1 `connectors.test.ts` — `connectorBySection`, `secretFieldKeys`, `connectorDoc`, unique sections, and a real invariant: every `CONNECTOR_DEPENDENCIES.requiresConnector` resolves to a defined connector (catches a typo that would silently drop a dependency).
- [x] 2.2 `operations.test.ts` — `operationByKey`, `isKnownOperation`, unique keys.
- [x] 2.3 `overlay-defaults.test.ts` — `isKnownOverlay`, `knownOverlays` (order preserved, unknowns dropped), unique names.
- [x] 2.4 `managed-settings.test.ts` — `managedSettingDef`, unique ids.
- [x] 2.5 (Merge/diff/round-trip already asserted in the pre-existing `config.test.ts` / `yaml.test.ts`; confirmed they cover the merge-preserves-unmanaged and removal-diff scenarios.)

## 3. Verification

- [x] 3.1 Gates: 13 new tests pass; full suite green.
