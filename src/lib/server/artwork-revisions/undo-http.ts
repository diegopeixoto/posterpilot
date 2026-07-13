import type { ActiveItemUndoScope } from './undo-runtime';

type JsonObject = Record<string, unknown>;

const SCOPE_KINDS = new Set(['item', 'revision', 'slot', 'season', 'destination', 'group']);

function object(value: unknown): JsonObject | null {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? (value as JsonObject)
		: null;
}

function nonEmptyString(value: unknown): string | null {
	return typeof value === 'string' && value.length > 0 && value.trim() === value ? value : null;
}

function nullableIndex(value: unknown): number | null | undefined {
	if (value === null || value === undefined) return null;
	return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : undefined;
}

function scopeSource(body: JsonObject): { kind: string; values: JsonObject } | null {
	if (typeof body.scope === 'string') {
		return SCOPE_KINDS.has(body.scope) ? { kind: body.scope, values: body } : null;
	}
	const nested = object(body.scope);
	if (nested) {
		return typeof nested.kind === 'string' && SCOPE_KINDS.has(nested.kind)
			? { kind: nested.kind, values: nested }
			: null;
	}
	if (typeof body.kind === 'string' && SCOPE_KINDS.has(body.kind)) {
		return { kind: body.kind, values: body };
	}
	if (body.revisionId !== undefined || body.revision !== undefined) {
		return { kind: 'revision', values: body };
	}
	if (body.slot !== undefined) return { kind: 'slot', values: body };
	if (body.season !== undefined) return { kind: 'season', values: body };
	if (body.destination !== undefined) return { kind: 'destination', values: body };
	if (
		body.revisionGroupId !== undefined ||
		body.groupId !== undefined ||
		body.group !== undefined
	) {
		return { kind: 'group', values: body };
	}
	return { kind: 'item', values: body };
}

function parseSlot(body: JsonObject, values: JsonObject) {
	const rawSlot = values.slot ?? body.slot;
	const slotObject = object(rawSlot);
	const kind = slotObject?.kind ?? (typeof rawSlot === 'string' ? rawSlot : values.artworkKind);
	if (kind !== 'poster' && kind !== 'background' && kind !== 'title_card') return null;
	const season = nullableIndex(slotObject?.season ?? values.season ?? body.season);
	const episode = nullableIndex(slotObject?.episode ?? values.episode ?? body.episode);
	if (season === undefined || episode === undefined) return null;
	if (kind === 'title_card' ? season === null || episode === null : episode !== null) return null;
	return { kind, season, episode } as const;
}

export function parseActiveItemUndoScope(body: JsonObject): ActiveItemUndoScope | null {
	const source = scopeSource(body);
	if (!source) return null;
	const { kind, values } = source;
	switch (kind) {
		case 'item':
			return { kind: 'item' };
		case 'revision': {
			const revisionId = nonEmptyString(
				values.revisionId ?? values.revision ?? body.revisionId ?? body.revision
			);
			return revisionId ? { kind: 'revision', revisionId } : null;
		}
		case 'slot': {
			const slot = parseSlot(body, values);
			return slot ? { kind: 'slot', slot } : null;
		}
		case 'season': {
			const season = values.season ?? body.season;
			return Number.isSafeInteger(season) && Number(season) >= 0
				? { kind: 'season', season: Number(season) }
				: null;
		}
		case 'destination': {
			const destination = values.destination ?? body.destination;
			return destination === 'server' || destination === 'kometa'
				? { kind: 'destination', destination }
				: null;
		}
		case 'group': {
			const revisionGroupId = nonEmptyString(
				values.revisionGroupId ??
					values.groupId ??
					values.group ??
					body.revisionGroupId ??
					body.groupId ??
					body.group
			);
			return revisionGroupId ? { kind: 'group', revisionGroupId } : null;
		}
		default:
			return null;
	}
}
