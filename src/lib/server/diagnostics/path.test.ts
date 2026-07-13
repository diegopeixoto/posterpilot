import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { probePath } from './path';

const roots: string[] = [];

afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('probePath', () => {
	it('checks a directory and removes its disposable write probe', async () => {
		const root = await mkdtemp(join(tmpdir(), 'posterpilot-diagnostic-'));
		roots.push(root);
		const result = await probePath(root, {
			expectedType: 'directory',
			requireWritable: true,
			probeName: () => '.fixed-probe'
		});
		expect(result).toMatchObject({
			exists: true,
			actualType: 'directory',
			readable: true,
			writable: true,
			probeCleaned: true
		});
		expect(await readdir(root)).toEqual([]);
	});

	it('rejects a configured directory that is actually a file', async () => {
		const root = await mkdtemp(join(tmpdir(), 'posterpilot-diagnostic-'));
		roots.push(root);
		const file = join(root, 'config.yml');
		await writeFile(file, 'x');
		await expect(probePath(file, { expectedType: 'directory' })).rejects.toMatchObject({
			code: 'path_type_mismatch'
		});
	});
});
