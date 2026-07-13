import { isMap, parseDocument, type Document } from 'yaml';
import type { ApplySlot } from '$lib/server/plans/apply-plan';
import { hashCanonicalJson } from '$lib/server/plans/canonical-json';

export interface KometaSlotSnapshotValue {
	state: 'present' | 'absent';
	url: string | null;
}

function slotTail(slot: ApplySlot): (string | number)[] {
	if (slot.season === null) {
		return [slot.kind === 'background' ? 'url_background' : 'url_poster'];
	}
	if (slot.kind === 'title_card' && slot.episode !== null) {
		return ['seasons', slot.season, 'episodes', slot.episode, 'url_poster'];
	}
	return ['seasons', slot.season, slot.kind === 'background' ? 'url_background' : 'url_poster'];
}

function kometaSlotPath(tmdbId: string, slot: ApplySlot): (string | number)[] {
	return ['metadata', tmdbId, ...slotTail(slot)];
}

function parsed(raw: string): Document {
	const document = parseDocument(raw);
	if (document.errors.length) throw document.errors[0];
	return document;
}

function resolvedSlotPath(document: Document, tmdbId: string, slot: ApplySlot) {
	const metadata = document.getIn(['metadata'], true);
	if (isMap(metadata)) {
		const pair = metadata.items.find((entry) => {
			const key = entry.key as unknown as { value?: unknown } | string | number | null;
			const value = key && typeof key === 'object' && 'value' in key ? key.value : key;
			return String(value) === tmdbId;
		});
		if (pair) {
			const key = pair.key as unknown as { value?: unknown } | string | number;
			const value = typeof key === 'object' && 'value' in key ? key.value : key;
			return ['metadata', value as string | number, ...slotTail(slot)];
		}
	}
	return kometaSlotPath(tmdbId, slot);
}

/** Read one exact PosterPilot-managed scalar or its absence. */
export function readKometaSlot(
	raw: string,
	tmdbId: string,
	slot: ApplySlot
): KometaSlotSnapshotValue {
	const document = parsed(raw);
	const value = document.getIn(resolvedSlotPath(document, tmdbId, slot));
	return typeof value === 'string' && value.length > 0
		? { state: 'present', url: value }
		: { state: 'absent', url: null };
}

export function kometaSlotFingerprint(value: KometaSlotSnapshotValue): string {
	return hashCanonicalJson(value);
}

function mapEmpty(document: Document, path: (string | number)[]): boolean {
	const node = document.getIn(path, true);
	return isMap(node) && node.items.length === 0;
}

/** Restore only one managed scalar while retaining unrelated entries and comments. */
export function restoreKometaSlot(
	raw: string,
	tmdbId: string,
	slot: ApplySlot,
	snapshot: KometaSlotSnapshotValue
): string {
	const document = parsed(raw);
	const path = resolvedSlotPath(document, tmdbId, slot);
	if (snapshot.state === 'present' && snapshot.url) {
		document.setIn(path, snapshot.url);
	} else {
		document.deleteIn(path);
		// Remove only empty containers created/left by this exact managed slot.
		for (let length = path.length - 1; length >= 2; length--) {
			const parent = path.slice(0, length);
			if (mapEmpty(document, parent)) document.deleteIn(parent);
			else break;
		}
	}
	return document.toString();
}

export function verifyKometaSlot(
	raw: string,
	tmdbId: string,
	slot: ApplySlot,
	expected: KometaSlotSnapshotValue
): boolean {
	return (
		kometaSlotFingerprint(readKometaSlot(raw, tmdbId, slot)) === kometaSlotFingerprint(expected)
	);
}
