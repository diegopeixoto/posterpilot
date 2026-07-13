import { SECRET_PATHS } from './connectors';
import type { ChangeEntry, ConsistencyWarning, KometaSnapshot } from './config';
import type { KometaConfigMode } from '$lib/server/config';
import type { SyncSelectionInput } from './selection';
import { hashCanonicalJson } from '$lib/server/plans/canonical-json';

export const KOMETA_CONFIG_PLAN_KIND = 'kometa_config_mutation';
const KOMETA_CONFIG_PLAN_VERSION = 1 as const;
const MAX_KOMETA_DIFF_ENTRIES = 500;

export type KometaConfigPlanAction = 'structured' | 'raw' | 'restore';

export interface KometaPlanDisplay {
	changes: ChangeEntry[];
	warnings: string[];
	dropped: string[];
	consistency: ConsistencyWarning[];
	willScaffold: boolean;
}

export interface KometaConfigPlanPayload {
	type: typeof KOMETA_CONFIG_PLAN_KIND;
	version: typeof KOMETA_CONFIG_PLAN_VERSION;
	action: KometaConfigPlanAction;
	serverInstanceId: string;
	serverName: string;
	configPath: string;
	mode: KometaConfigMode;
	sourceFingerprint: string;
	proposedFingerprint: string;
	/** Exact bytes authorized by confirmation. Kept only in the server-side plan row. */
	proposedContent: string;
	display: KometaPlanDisplay;
	structured: {
		selection: SyncSelectionInput;
		nextSnapshot: KometaSnapshot;
	} | null;
	restore: {
		backupName: string;
		backupFingerprint: string;
	} | null;
}

export function kometaFileFingerprint(content: string | null): string {
	return hashCanonicalJson({ exists: content !== null, content });
}

export function kometaProposedFingerprint(content: string): string {
	return hashCanonicalJson({ content });
}

function cleanKey(raw: string): string {
	const key = raw.trim();
	if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
		return key.slice(1, -1);
	}
	return key;
}

function safePreviewLine(line: string, stack: { indent: number; key: string }[]): string {
	const inlineSecret = /(?:token|api[_-]?key|apikey|client_secret|secret|password)\s*:/i;
	if (inlineSecret.test(line.replace(/^\s*#.*$/, ''))) {
		return `${line.match(/^\s*/)?.[0] ?? ''}***`;
	}
	const match = /^(\s*)([^#][^:]*):(?:\s*(.*))?$/.exec(line);
	if (!match) return line.slice(0, 240);
	const indent = match[1].replace(/\t/g, '  ').length;
	while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
	const key = cleanKey(match[2]);
	const path = [...stack.map((entry) => entry.key), key].join('.');
	const value = match[3] ?? '';
	const secret =
		SECRET_PATHS.has(path) ||
		/(?:token|api[_-]?key|apikey|client_secret|secret|password)$/i.test(key);
	stack.push({ indent, key });
	if (secret && value.trim() !== '') return `${match[1]}${match[2]}: ***`;
	return line.slice(0, 240);
}

/** Redact secret-looking YAML scalars while preserving line numbers for a raw diff. */
export function safeYamlPreviewLines(content: string): string[] {
	const stack: { indent: number; key: string }[] = [];
	return content.split(/\r?\n/).map((line) => safePreviewLine(line, stack));
}

/**
 * Bounded, line-oriented diff for raw saves and backup restores. The exact content
 * remains fingerprint-bound in the plan; this list is display-only and secret-safe.
 */
export function rawKometaChanges(
	before: string | null,
	after: string
): {
	changes: ChangeEntry[];
	truncated: boolean;
} {
	const oldRawLines = (before ?? '').split(/\r?\n/);
	const newRawLines = after.split(/\r?\n/);
	const oldLines = safeYamlPreviewLines(before ?? '');
	const newLines = safeYamlPreviewLines(after);
	let prefix = 0;
	while (
		prefix < oldRawLines.length &&
		prefix < newRawLines.length &&
		oldRawLines[prefix] === newRawLines[prefix]
	) {
		prefix++;
	}
	let suffix = 0;
	while (
		suffix < oldRawLines.length - prefix &&
		suffix < newRawLines.length - prefix &&
		oldRawLines[oldRawLines.length - 1 - suffix] === newRawLines[newRawLines.length - 1 - suffix]
	) {
		suffix++;
	}

	const oldMiddle = oldLines.slice(prefix, oldLines.length - suffix);
	const newMiddle = newLines.slice(prefix, newLines.length - suffix);
	const changes: ChangeEntry[] = [];
	const count = Math.max(oldMiddle.length, newMiddle.length);
	for (let index = 0; index < count && changes.length < MAX_KOMETA_DIFF_ENTRIES; index++) {
		const beforeLine = oldMiddle[index];
		const afterLine = newMiddle[index];
		if (beforeLine !== undefined && afterLine !== undefined) {
			changes.push({
				op: 'modify',
				path: `line ${prefix + index + 1}`,
				before: beforeLine,
				after: afterLine
			});
		} else if (beforeLine !== undefined) {
			changes.push({
				op: 'remove',
				path: `line ${prefix + index + 1}`,
				before: beforeLine,
				after: null
			});
		} else if (afterLine !== undefined) {
			changes.push({
				op: 'add',
				path: `line ${prefix + index + 1}`,
				before: null,
				after: afterLine
			});
		}
	}
	return { changes, truncated: count > MAX_KOMETA_DIFF_ENTRIES };
}

function validDigest(value: unknown): value is string {
	return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

/** Reject a corrupt or hand-crafted plan before it reaches any filesystem write. */
export function assertKometaConfigPlanPayload(
	payload: KometaConfigPlanPayload
): asserts payload is KometaConfigPlanPayload {
	if (
		!payload ||
		payload.type !== KOMETA_CONFIG_PLAN_KIND ||
		payload.version !== KOMETA_CONFIG_PLAN_VERSION ||
		!['structured', 'raw', 'restore'].includes(payload.action) ||
		!payload.serverInstanceId ||
		!payload.serverName ||
		!payload.configPath ||
		!['merge', 'own'].includes(payload.mode) ||
		!validDigest(payload.sourceFingerprint) ||
		!validDigest(payload.proposedFingerprint) ||
		typeof payload.proposedContent !== 'string' ||
		!payload.display ||
		!Array.isArray(payload.display.changes) ||
		!Array.isArray(payload.display.warnings) ||
		!Array.isArray(payload.display.dropped) ||
		!Array.isArray(payload.display.consistency)
	) {
		throw new TypeError('Invalid Kometa configuration plan');
	}
	if (kometaProposedFingerprint(payload.proposedContent) !== payload.proposedFingerprint) {
		throw new TypeError('Kometa proposed content fingerprint mismatch');
	}
	if (payload.action === 'structured' && !payload.structured) {
		throw new TypeError('Structured Kometa plan is missing its frozen selection');
	}
	if (payload.action !== 'structured' && payload.structured !== null) {
		throw new TypeError('Non-structured Kometa plan carries a selection');
	}
	if (payload.action === 'restore') {
		if (!payload.restore?.backupName || !validDigest(payload.restore.backupFingerprint)) {
			throw new TypeError('Kometa restore plan is missing its backup identity');
		}
	} else if (payload.restore !== null) {
		throw new TypeError('Non-restore Kometa plan carries a backup identity');
	}
}
