import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	linkSync,
	mkdirSync,
	mkdtempSync,
	renameSync,
	rmSync,
	symlinkSync,
	unlinkSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import {
	findPhysicalPathAliasConflict,
	freezePhysicalPath,
	inspectFrozenPhysicalPath,
	PhysicalPathInspectionError,
	validateFrozenPhysicalPath
} from './physical-path-alias';

let directory: string;

beforeEach(() => {
	directory = mkdtempSync(join(tmpdir(), 'posterpilot-path-alias-'));
});

afterEach(() => {
	rmSync(directory, { recursive: true, force: true });
});

describe('findPhysicalPathAliasConflict', () => {
	it('detects the same textual path before either target exists', () => {
		const target = join(directory, 'posterpilot-movies.yml');

		expect(findPhysicalPathAliasConflict([target, target])).toEqual({
			kind: 'canonical_path',
			firstIndex: 0,
			secondIndex: 1
		});
	});

	it('resolves a symlinked ancestor for a target that does not exist yet', () => {
		const realDirectory = join(directory, 'real');
		const aliasDirectory = join(directory, 'alias');
		mkdirSync(realDirectory);
		symlinkSync(realDirectory, aliasDirectory, 'dir');

		expect(
			findPhysicalPathAliasConflict([
				join(realDirectory, 'future', 'posterpilot-shows.yml'),
				join(aliasDirectory, 'future', 'posterpilot-shows.yml')
			])
		).toEqual({
			kind: 'canonical_path',
			firstIndex: 0,
			secondIndex: 1
		});
	});

	it('detects distinct existing names that are hard links to the same file', () => {
		const first = join(directory, 'first.yml');
		const second = join(directory, 'second.yml');
		writeFileSync(first, 'metadata: {}\n', 'utf8');
		linkSync(first, second);

		expect(findPhysicalPathAliasConflict([first, second])).toEqual({
			kind: 'file_identity',
			firstIndex: 0,
			secondIndex: 1
		});
	});

	it('allows distinct targets beneath the same existing ancestor', () => {
		expect(
			findPhysicalPathAliasConflict([
				join(directory, 'future', 'posterpilot-movies.yml'),
				join(directory, 'future', 'posterpilot-shows.yml')
			])
		).toBeNull();
	});

	it('rejects relative and otherwise invalid inputs', () => {
		const relativePath = relative(process.cwd(), join(directory, 'relative.yml'));
		expect(() => findPhysicalPathAliasConflict([relativePath])).toThrow(
			expect.objectContaining<Partial<PhysicalPathInspectionError>>({
				code: 'invalid_path',
				pathIndex: 0
			})
		);
		expect(() => findPhysicalPathAliasConflict([`${directory}\0invalid.yml`])).toThrow(
			expect.objectContaining<Partial<PhysicalPathInspectionError>>({
				code: 'invalid_path',
				pathIndex: 0
			})
		);
	});

	it('fails closed when an existing symlink cannot be resolved', () => {
		const dangling = join(directory, 'dangling');
		symlinkSync(join(directory, 'missing-directory'), dangling, 'dir');

		expect(() => findPhysicalPathAliasConflict([join(dangling, 'posterpilot-movies.yml')])).toThrow(
			expect.objectContaining<Partial<PhysicalPathInspectionError>>({
				code: 'inspection_failed',
				pathIndex: 0
			})
		);
	});

	it('does not let an early duplicate hide a later inspection failure', () => {
		const target = join(directory, 'same.yml');
		const dangling = join(directory, 'dangling');
		symlinkSync(join(directory, 'missing-directory'), dangling, 'dir');

		expect(() =>
			findPhysicalPathAliasConflict([target, target, join(dangling, 'other.yml')])
		).toThrow(
			expect.objectContaining<Partial<PhysicalPathInspectionError>>({
				code: 'inspection_failed',
				pathIndex: 2
			})
		);
	});
});

describe('frozen physical paths', () => {
	it('serializes a canonical target behind a preview-time symlink', () => {
		const target = join(directory, 'target.yml');
		const alias = join(directory, 'alias.yml');
		writeFileSync(target, 'metadata: {}\n', 'utf8');
		symlinkSync(target, alias);

		const serialized = JSON.stringify(freezePhysicalPath(alias));
		const binding = JSON.parse(serialized) as ReturnType<typeof freezePhysicalPath>;
		expect(binding.canonicalPath).toBe(freezePhysicalPath(target).canonicalPath);
		expect(inspectFrozenPhysicalPath(binding)).toMatchObject({
			canonicalPath: binding.canonicalPath,
			exists: true
		});
	});

	it('validates serialized structure without consulting the filesystem', () => {
		const parent = join(directory, 'managed');
		const moved = join(directory, 'managed-moved');
		mkdirSync(parent);
		const binding = freezePhysicalPath(join(parent, 'future.yml'));
		renameSync(parent, moved);

		expect(validateFrozenPhysicalPath(JSON.parse(JSON.stringify(binding)))).toEqual(binding);
		expect(() => validateFrozenPhysicalPath({ ...binding, unexpected: true })).toThrow(
			expect.objectContaining<Partial<PhysicalPathInspectionError>>({ code: 'invalid_path' })
		);
		expect(() =>
			validateFrozenPhysicalPath({ ...binding, canonicalPath: join(directory, 'outside.yml') })
		).toThrow(expect.objectContaining({ code: 'invalid_path' }));
	});

	it('rejects a final-component symlink introduced after the binding was frozen', () => {
		const target = join(directory, 'target.yml');
		const victim = join(directory, 'victim.yml');
		writeFileSync(target, 'same bytes\n', 'utf8');
		writeFileSync(victim, 'same bytes\n', 'utf8');
		const binding = freezePhysicalPath(target);

		unlinkSync(target);
		symlinkSync(victim, target);
		expect(() => inspectFrozenPhysicalPath(binding)).toThrow(
			expect.objectContaining<Partial<PhysicalPathInspectionError>>({ code: 'path_changed' })
		);
	});

	it('rejects replacement of the frozen directory anchor', () => {
		const parent = join(directory, 'managed');
		const moved = join(directory, 'managed-before-swap');
		const external = join(directory, 'external');
		mkdirSync(parent);
		mkdirSync(external);
		const target = join(parent, 'target.yml');
		writeFileSync(target, 'same bytes\n', 'utf8');
		writeFileSync(join(external, 'target.yml'), 'same bytes\n', 'utf8');
		const binding = freezePhysicalPath(target);

		renameSync(parent, moved);
		symlinkSync(external, parent, 'dir');
		expect(() => inspectFrozenPhysicalPath(binding)).toThrow(PhysicalPathInspectionError);
	});

	it('keeps the binding valid after the target inode is intentionally replaced', () => {
		const target = join(directory, 'target.yml');
		const replacement = join(directory, 'replacement.yml');
		writeFileSync(target, 'before\n', 'utf8');
		const binding = freezePhysicalPath(target);
		const before = inspectFrozenPhysicalPath(binding);

		writeFileSync(replacement, 'after\n', 'utf8');
		renameSync(replacement, target);
		const after = inspectFrozenPhysicalPath(binding);
		expect(after.exists).toBe(true);
		expect(after.identity).not.toBe(before.identity);
	});

	it('allows a distinct missing suffix beneath the frozen directory anchor', () => {
		const target = join(directory, 'future', 'nested', 'target.yml');
		const binding = freezePhysicalPath(target);
		expect(inspectFrozenPhysicalPath(binding)).toEqual({
			canonicalPath: binding.canonicalPath,
			exists: false,
			identity: null
		});
	});
});
