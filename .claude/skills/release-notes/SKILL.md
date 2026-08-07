---
name: release-notes
description: Use when a release-please PR is open and its changelog needs to be rewritten as human release notes — grouping commit-level entries into user-facing themes, adding Upgrading and Contributors, and writing the result into both CHANGELOG.md and the release PR body before merge. Triggers on "release notes", "write the changelog", "curate the release", "prep the release PR".
---

# Release notes

release-please decides the version, the tag, and the raw ledger. It cannot decide what a
release *means* to someone running PosterPilot. This skill closes that gap: it turns the
generated commit list into the house-style notes, in place, before the release PR merges.

## The two artifacts

Both come from the release PR, so both must be edited **on the release PR**:

| Artifact | Source | Edit by |
|---|---|---|
| `CHANGELOG.md` section | the file on the release branch | commit to the release branch |
| GitHub Release body | the release PR **body** | `gh pr edit --body-file` |

Editing the published release afterwards with `gh release edit` is the fallback, not the
plan. The point is that both nascem certos.

## Timing (read this first)

release-please rebuilds and **force-pushes** the release branch on every push to `main`.
Any curation done before the last feature merge is destroyed silently.

Run this skill only when the release is closed for new work. If a PR lands afterwards,
re-run it — it is cheap and idempotent.

## Step 1 — Establish the range

```bash
gh pr list --state open --json number,title,headRefName \
  --jq '.[] | select(.headRefName | startswith("release-please--"))'
PREV=$(git tag --sort=-v:refname | head -1)          # e.g. v0.10.0
gh release view "$PREV" --json publishedAt -q .publishedAt
```

## Step 2 — Read the PRs, not the commits

The commit subjects are written for the maintainer (`fix: bound TMDB repair refresh and
queries`). The PR bodies are written for a reader. Use the PR bodies.

```bash
git log "$PREV"..origin/main --format='%s' | grep -oE '\(#[0-9]+\)' | tr -d '(#)' | sort -un
gh pr view <n> --json number,title,body,author,labels,url,mergedAt
```

For every PR, also pull the context it points at:

- `Closes #N` / `Fixes #N` → `gh issue view N` — the issue states the **user-visible
  symptom**, which is usually the sentence worth publishing.
- An OpenSpec change name → read `openspec/changes/<name>/` for the why.
- `git diff "$PREV"..origin/main --stat -- <paths>` to gauge whether a PR is a headline or
  a footnote.

## Step 3 — Classify

- **Migration?** `git diff "$PREV"..origin/main --name-only | grep -E 'drizzle/|migrations/'`
  — if non-empty, an **Upgrading** section is mandatory and must say whether there is a
  downgrade path.
- **External contributors?** any PR whose `author.login` is not the maintainer, plus
  `Co-authored-by:` trailers in the range → **Contributors** section, one line each,
  naming what they actually did.
- **Breaking?** `BREAKING CHANGE:` footers, or any config/env key removed or renamed.

## Step 4 — Write

Group by what changed for the user, not by commit or by PR. Twelve commits hardening one
subsystem are **one** bullet. Match [`CHANGELOG.md`'s v0.10.0 entry](../../../CHANGELOG.md)
— it is the reference:

- Lead with the user-visible effect, then the mechanism. *"Jellyfin backdrops were appended
  behind the existing one, so applies 'succeeded' while the visible art never changed.
  Existing backdrops are now cleared first."*
- Every bullet ends with its PR links: `([#48](…/pull/48), [#52](…/pull/52))`.
- Sections, in order, omitting empty ones: `### Features`, `### Bug Fixes`,
  `### Under the hood`, `### Upgrading`, `### Contributors`.
- Internal names (`applyPlan`, `preflight`, table names) only when the reader can act on
  them. "Hardening" and "bounded" mean nothing to someone applying a poster.
- No invented impact. If a fix's user-facing symptom cannot be established from the PR,
  the issue, or the diff, it belongs in **Under the hood** — or it is dropped.

## Step 5 — Apply

Never silently drop an entry release-please generated: every one is either folded into a
bullet or deliberately cut as internal. State the cuts when reporting back.

```bash
git fetch origin
git checkout release-please--branches--main--components--posterpilot
```

Rewrite only the new version's section in `CHANGELOG.md`, keeping release-please's heading
line (`## [0.11.0](…compare/v0.10.0...v0.11.0) (2026-08-07)`) byte-identical — the tag,
compare link, and date are its output, not yours. Then:

```bash
git commit -S -m "docs: write 0.11.0 release notes" CHANGELOG.md && git push
```

For the PR body, keep release-please's sentinels exactly — it parses this text to build the
GitHub Release, and a mangled body breaks the release:

```
:robot: I have created a release *beep* *boop*
---


## [0.11.0](…compare/v0.10.0...v0.11.0) (2026-08-07)

<curated notes — same content as the CHANGELOG section>

---
This PR was generated with [Release Please](https://github.com/googleapis/release-please). See [documentation](https://github.com/googleapis/release-please#release-please).
```

```bash
gh pr edit <n> --body-file <file>
```

## Step 6 — Verify

- `gh pr view <n> --json body -q .body | head -5` — sentinels intact.
- CHANGELOG heading unchanged: `git diff origin/main -- CHANGELOG.md | grep '^[-+]## '` prints
  only the added heading, never a removed one.
- Every PR link resolves and points at this repo.
- After merge: `gh release view v<version>` — body matches. If it does not, that is the one
  legitimate use of `gh release edit`.
