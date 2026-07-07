import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
	listBackups,
	pruneBackups,
	readConfig,
	restoreBackup,
	withConfigLock,
	writeConfigAtomic
} from './config-io';

const DIR = join(tmpdir(), `kometa-io-test-${process.pid}`);
const FILE = join(DIR, 'config.yml');

beforeEach(() => {
	rmSync(DIR, { recursive: true, force: true });
	mkdirSync(DIR, { recursive: true });
});
afterEach(() => rmSync(DIR, { recursive: true, force: true }));

describe('readConfig', () => {
	it('returns null when the file is absent, content when present', () => {
		expect(readConfig(FILE)).toBeNull();
		writeFileSync(FILE, 'plex:\n', 'utf8');
		expect(readConfig(FILE)).toBe('plex:\n');
	});
});

describe('writeConfigAtomic', () => {
	it('writes the file and creates a backup of the prior content', () => {
		writeFileSync(FILE, 'old: 1\n', 'utf8');
		const { backup } = writeConfigAtomic(FILE, 'new: 2\n', '2026-06-26T10-00-00Z');
		expect(readFileSync(FILE, 'utf8')).toBe('new: 2\n');
		expect(backup).not.toBeNull();
		expect(readFileSync(backup as string, 'utf8')).toBe('old: 1\n');
	});

	it('writes with no backup when there was no prior file', () => {
		const { backup } = writeConfigAtomic(FILE, 'a: 1\n', '2026-06-26T10-00-00Z');
		expect(backup).toBeNull();
		expect(readFileSync(FILE, 'utf8')).toBe('a: 1\n');
	});

	it('leaves no stray temp files behind', () => {
		writeFileSync(FILE, 'old\n', 'utf8');
		writeConfigAtomic(FILE, 'newer\n', '2026-06-26T10-00-00Z');
		expect(readdirSync(DIR).some((f) => f.includes('.tmp-'))).toBe(false);
	});
});

describe('pruneBackups', () => {
	it('keeps only the newest N backups', () => {
		for (const s of ['2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01']) {
			writeFileSync(join(DIR, `config.yml.posterpilot-bak-${s}`), s, 'utf8');
		}
		pruneBackups(DIR, 'config.yml', 2);
		const remaining = readdirSync(DIR)
			.filter((f) => f.includes('.posterpilot-bak-'))
			.sort();
		expect(remaining).toEqual([
			'config.yml.posterpilot-bak-2026-03-01',
			'config.yml.posterpilot-bak-2026-04-01'
		]);
	});
});

describe('listBackups / restoreBackup', () => {
	it('lists backups newest-first and restores one (backing up current)', () => {
		writeFileSync(FILE, 'v1\n', 'utf8');
		writeConfigAtomic(FILE, 'v2\n', '2026-01-01T00-00-00Z'); // backup of v1
		writeConfigAtomic(FILE, 'v3\n', '2026-02-01T00-00-00Z'); // backup of v2
		const backups = listBackups(FILE);
		expect(backups.length).toBe(2);
		expect(backups[0].stamp > backups[1].stamp).toBe(true); // newest first

		const v1Backup = backups[1].name; // oldest = the v1 snapshot
		const { backup } = restoreBackup(FILE, v1Backup, '2026-03-01T00-00-00Z');
		expect(readFileSync(FILE, 'utf8')).toBe('v1\n'); // restored
		expect(readFileSync(backup as string, 'utf8')).toBe('v3\n'); // current was backed up first
	});

	it('rejects a backup name that escapes the config dir', () => {
		writeFileSync(FILE, 'x\n', 'utf8');
		expect(() => restoreBackup(FILE, '../../etc/passwd', 's')).toThrow();
		expect(() => restoreBackup(FILE, 'unrelated.bak', 's')).toThrow();
	});
});

describe('withConfigLock', () => {
	it('serializes concurrent operations on the same path', async () => {
		const order: string[] = [];
		const slow = withConfigLock(FILE, async () => {
			await new Promise((r) => setTimeout(r, 20));
			order.push('a');
		});
		const fast = withConfigLock(FILE, async () => {
			order.push('b');
		});
		await Promise.all([slow, fast]);
		expect(order).toEqual(['a', 'b']); // b waited for a despite being faster
	});
});
