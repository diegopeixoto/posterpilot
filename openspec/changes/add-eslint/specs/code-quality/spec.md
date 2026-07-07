## ADDED Requirements

### Requirement: Static analysis gate

The project SHALL run ESLint static analysis (TypeScript + Svelte, including accessibility rules) as
part of the quality gates and in CI, so correctness and code-smell issues that formatting and type
checks miss are caught before merge. The lint gate SHALL pass (no errors) on the main branch.

#### Scenario: CI runs ESLint

- **WHEN** CI runs on a pull request
- **THEN** an ESLint step runs and fails the build on lint errors

#### Scenario: Lint script available

- **WHEN** a contributor runs the project's lint command locally
- **THEN** ESLint runs over the source (excluding generated output) and reports any violations
