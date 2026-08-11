---
name: release-notes
description: Use when a release-please PR is open and its generated changelog needs to become human release notes — grouping commit-level entries into user-facing themes, adding Upgrading and Contributors, writing them into the release PR body before merge and into CHANGELOG.md after the tag. Also carries the rule that the release branch must never be committed to, and the recovery steps when a tag is missed. Triggers on "release notes", "write the changelog", "curate the release", "prep the release PR".
---

# Release notes

release-please decides the version, the tag, and the raw ledger. It cannot decide what a
release *means* to someone running PosterPilot. This skill closes that gap: it turns the
generated commit list into the house-style notes, in place, before the release PR merges.

## Never push a commit to the release branch

**Do not commit to `release-please--branches--main--…`, for any reason, including fixing
`CHANGELOG.md`.** This was learned the expensive way on v0.8.0: on merge, release-please
bumps `.release-please-manifest.json` to the new version but emits
`release_created: false`, so **no tag and no GitHub Release are cut** — and the `publish`
job in `release-please.yml`, gated on that output, **never builds the Docker image**. The
label stays `autorelease: pending`. Re-running release-please does not fix it, because the
manifest already reads as done. Recovery is manual (see the bottom of this file).

The release PR **body** is safe to edit — it is metadata, not a commit, and it is what
release-please turns into the GitHub Release.

## The two artifacts, and when each is written

| Artifact | Written | How |
|---|---|---|
| GitHub Release body | **before** merging the release PR | `gh pr edit <n> --body-file` — release-please builds the release from this body |
| `CHANGELOG.md` section | **after** the tag exists | a normal follow-up PR against `main` |

That ordering is what makes the published release correct at birth instead of patched with
`gh release edit` afterwards — while keeping the release branch untouched.

## Timing

release-please rebuilds and **force-pushes** the release branch on every push to `main`,
overwriting the PR body along with it. Curate only when the release is closed for new work,
and re-run if a PR lands late — it is cheap and idempotent.

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

## Step 5a — Write the release PR body (before merge)

Never silently drop an entry release-please generated: every one is either folded into a
bullet or deliberately cut as internal. State the cuts when reporting back.

**Never write a closing keyword next to an issue reference, even negated.** The release PR
body is a PR body: on merge, GitHub closes every issue matching `close[sd]?`, `fix(e[sd])?`,
or `resolve[sd]?` followed by a reference. It does not parse negation, so
`This does not fix #91` **closed #91** on v0.12.1 — a live user bug, silently, in the same
second the release merged. To say an issue is still open, put the reference first and use no
keyword at all: `#91 remains open.` Naming issues that a release does *not* fix is worth
doing; it just cannot be phrased with those verbs.

Keep release-please's sentinels exactly — it parses this text to build the GitHub Release,
and a mangled body breaks the release. Keep its heading line byte-identical too; the tag,
compare link, and date are its output, not yours:

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
gh pr view <n> --json body -q .body | head -5   # sentinels intact
```

Then hand the PR to the maintainer to merge. Do not merge it, and do not push to it.

## Step 5b — Backfill CHANGELOG.md (after the tag)

Once the tag exists, open a normal PR against `main` replacing that version's generated
section with the same curated notes, keeping the heading line byte-identical:

```bash
git checkout -b docs/changelog-<version> origin/main
# rewrite only the new section
git diff -- CHANGELOG.md | grep '^[-+]## '   # must show no removed heading
git commit -S -m "docs: write <version> release notes" CHANGELOG.md
```

## Step 6 — Verify the release actually happened

The failure mode this guards against is silent. Immediately after the release PR merges:

```bash
gh release view v<version> --json tagName,publishedAt   # the tag exists
gh pr view <n> --json labels -q '.labels[].name'        # autorelease: tagged, not pending
gh run list --workflow=release-please.yml --limit 1     # publish job ran
```

Also check every PR link in the body resolves to this repo.

If the tag was **not** cut (label stuck on `autorelease: pending`, manifest already bumped —
re-running release-please will not fix it):

```bash
gh release create v<version> --target <main-merge-sha> --notes-file <file> --latest
gh pr edit <n> --add-label "autorelease: tagged" --remove-label "autorelease: pending"
gh workflow run docker-publish.yml --ref main -f version=<version> -f ref=v<version>
```

`docker-publish.yml` carries a `workflow_dispatch` trigger for exactly this, so the
multi-arch image and its `X.Y.Z` / `X.Y` / `X` / `latest` tags can be published without
touching CI.
