---
title: Safety, verification, and undo
description: Understand PosterPilot's exact preview contract, immutable artwork revisions, verification, partial failures, and safe undo boundaries.
---

PosterPilot treats every artwork or configuration write as a reviewable operation.
Suggestions, FUN results, collection families, schedules, and discovery jobs never
write artwork by themselves.

## The write contract

For direct media-server artwork, Kometa metadata, custom uploads, collection
operations, and Kometa `config.yml` changes, the safe path is:

1. **Stage** the artwork or configuration input.
2. **Preview** the exact targets, destinations, slots, writes, and skips.
3. **Confirm** the server-issued plan. The plan is short-lived, single-use, and
   bound to the previewed content and source fingerprints.
4. **Execute** only the frozen operations. Execution does not rediscover or
   silently replace a candidate.
5. **Verify** each destination after writing.
6. **Record** a destination- and slot-specific revision, including failures.

If the selection, target artwork, collection membership, Kometa file, destination,
or another bound input changes after preview, confirmation is rejected. Request a
fresh preview; do not retry an old confirmation token.

![PosterPilot item detail with the apply confirmation showing the exact frozen plan: two uploads, no Kometa exports, nothing skipped](/posterpilot/screenshots/apply-exact-plan.webp)

## What is captured

Before a planned mutation, PosterPilot records the prior state for the affected
slot. Where the media-server provider can read the image bytes, it stores a local,
content-addressed snapshot under the application data directory. Kometa revisions
retain the previous managed YAML value, including the fact that it was absent.

The timeline is append-only. Applying again or undoing does not erase the original
attempt. An uploaded file is represented by a safe content identity; credentials
and secret-bearing URLs are not exposed in browser history.

:::caution
A slot whose original image could not be read is recorded as unavailable. PosterPilot
does not claim that such a slot can be restored exactly. Review the undo preview
before confirming it.
:::

## Verification states

- **Exact** — the destination can be compared with the intended content or exact
  managed YAML value.
- **Best effort** — the provider exposes a stable changed image identity, but not
  byte-for-byte evidence.
- **Failed or unavailable** — the write failed, the destination differs, or the
  provider could not supply enough evidence. This is never shown as verified
  success.

Server and Kometa outcomes remain independent. A “Both” operation can therefore be
partially successful, and season or episode failures do not hide successful sibling
slots.

## Partial failures and retries

Open the job details to see succeeded, failed, skipped, and interrupted counts plus
the affected destination and slot. **Retry failed** creates linked work for eligible
failed units only; successful mutations are not repeated. Validation and missing-
configuration failures may require correcting Settings and generating a new preview
instead of retrying.

“Apply and next” advances only when every selected target completed and passed
verification. Otherwise it stays on the item with the recorded detail.

## Undo from the artwork timeline

On item detail, use the artwork timeline to preview undo for an available revision,
a season, or the full item. The preview lists restorable operations and unavailable
or already-restored slots. Confirmation restores the prior snapshot/value, verifies
the result where supported, and appends a new undo revision.

Confirmation hands the frozen plan to the durable job queue, so a large undo — a
whole collection, say — reports progress and resumes after a restart instead of
dying with the request that started it.

Undo is scoped: restoring one season does not change the show poster or another
season; restoring Kometa-managed metadata does not rewrite unrelated YAML. Mixed
results remain visible and independently retryable.

![PosterPilot artwork history timeline showing a verified applied revision with one entry per destination and slot, each with its own undo action](/posterpilot/screenshots/item-artwork-history.webp)

## Kometa configuration safety

Structured sync, raw YAML save, and backup restore each have their own preview and
confirmation. Diffs shown in the browser redact managed secrets. A confirmed write
uses an atomic backup-and-replace path; stale, expired, changed, or reused plans write
nothing. See the [Kometa manager](../kometa-config-sync/) for the file layout and
plain-text secret warning.

## Safe operating habits

- Keep `/data` persistent and include `.app-key` in backups when `APP_SECRET` is
  unset.
- Inspect skips before confirmation; a skip is not a verified success.
- Use Diagnostics before repeated retries when a server, provider, or path is
  unhealthy.
- Create an application backup before upgrades, server purges, or restore work.
- Keep automatic discovery review-first. No built-in schedule auto-applies artwork.

Continue with the [day-to-day workflow](../usage/) or the
[automation and recovery guide](../automation-recovery/).
