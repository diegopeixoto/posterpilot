import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
	chmodSync,
	existsSync,
	linkSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	renameSync,
	rmSync,
	statSync,
	symlinkSync,
	unlinkSync,
	writeFileSync
} from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import {
	createProtectedBackup,
	createProtectedBackupAtBinding,
	canonicalConfigPath,
	clearConfigCommitCancellationAtBinding,
	clearConfigCommitProofAtBinding,
	discardUnpublishedConfigCommitProofAtBinding,
	finalizePublishedConfigCommitProofAtBinding,
	freezeConfigPath,
	inspectConfigCommitProofAtBinding,
	listBackups,
	prepareConfigCommitProofAtBinding,
	pruneBackups,
	protectedBackupName,
	readBackup,
	readBackupAtBinding,
	readConfig,
	readConfigAtBinding,
	recoverConfigCommitProofAtBinding,
	recoverConfigQuarantineAtBinding,
	removeConfigAtomicAtBinding,
	restoreBackup,
	validateConfigPathBinding,
	withConfigLock,
	withConfigLocks,
	writeConfigAtomic,
	writeConfigAtomicAtBinding
} from './config-io';
import { PhysicalPathInspectionError } from './physical-path-alias';

const DIR = join(tmpdir(), `kometa-io-test-${process.pid}`);
const FILE = join(DIR, 'config.yml');
const CAS_QUARANTINE = join(DIR, '.config.yml.posterpilot-cas-quarantine');

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
		writeFileSync(FILE, 'old: 1\n', { encoding: 'utf8', mode: 0o644 });
		const { backup } = writeConfigAtomic(FILE, 'new: 2\n', '2026-06-26T10-00-00Z');
		expect(readFileSync(FILE, 'utf8')).toBe('new: 2\n');
		expect(backup).not.toBeNull();
		expect(readFileSync(backup as string, 'utf8')).toBe('old: 1\n');
		expect(statSync(FILE).mode & 0o777).toBe(0o600);
		expect(statSync(backup as string).mode & 0o777).toBe(0o600);
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

	it('cleans a prepared temp file when a later replacement step fails', () => {
		mkdirSync(FILE);
		expect(() => writeConfigAtomic(FILE, 'new\n', '2026-06-26T10-00-00Z')).toThrow();
		expect(readdirSync(DIR).some((entry) => entry.includes('.tmp-'))).toBe(false);
	});
});

describe('preview-bound migration I/O', () => {
	it('refuses to read or write through a final symlink introduced after preview', () => {
		const victim = join(DIR, 'external-victim.yml');
		const original = 'same: bytes\n';
		writeFileSync(FILE, original, 'utf8');
		writeFileSync(victim, original, 'utf8');
		const binding = freezeConfigPath(FILE);

		unlinkSync(FILE);
		symlinkSync(victim, FILE);
		expect(() => readConfigAtBinding(binding)).toThrow(
			expect.objectContaining<Partial<PhysicalPathInspectionError>>({ code: 'path_changed' })
		);
		expect(() =>
			createProtectedBackupAtBinding(binding, 'migration-source-swap', {
				expectedContent: original
			})
		).toThrow(PhysicalPathInspectionError);
		expect(() => writeConfigAtomicAtBinding(binding, 'changed: true\n', 'migration')).toThrow(
			PhysicalPathInspectionError
		);
		expect(readFileSync(victim, 'utf8')).toBe(original);
	});

	it('writes the frozen canonical name when the original alias is redirected', () => {
		const managed = join(DIR, 'managed.yml');
		const configuredAlias = join(DIR, 'configured.yml');
		const victim = join(DIR, 'external-victim.yml');
		writeFileSync(managed, 'before: true\n', 'utf8');
		writeFileSync(victim, 'victim: true\n', 'utf8');
		symlinkSync(managed, configuredAlias);
		const binding = freezeConfigPath(configuredAlias);

		unlinkSync(configuredAlias);
		symlinkSync(victim, configuredAlias);
		writeConfigAtomicAtBinding(binding, 'after: true\n', 'migration');

		expect(readFileSync(managed, 'utf8')).toBe('after: true\n');
		expect(readFileSync(victim, 'utf8')).toBe('victim: true\n');
	});

	it('atomically replaces a hardlink name without modifying its other link', () => {
		const victim = join(DIR, 'external-victim.yml');
		writeFileSync(FILE, 'before: true\n', 'utf8');
		writeFileSync(victim, 'before: true\n', 'utf8');
		const binding = freezeConfigPath(FILE);

		unlinkSync(FILE);
		linkSync(victim, FILE);
		writeConfigAtomicAtBinding(binding, 'after: true\n', 'migration');

		expect(readFileSync(FILE, 'utf8')).toBe('after: true\n');
		expect(readFileSync(victim, 'utf8')).toBe('before: true\n');
	});

	it('rejects a source changed before the writer performs its first bound read', () => {
		const original = 'before: true\n';
		const external = 'external: concurrent-edit\n';
		writeFileSync(FILE, original, 'utf8');
		const binding = freezeConfigPath(FILE);

		// Models the gap after the executor's source check but before the bound
		// writer starts. The writer must validate the exact predecessor itself.
		writeFileSync(FILE, external, 'utf8');
		expect(() =>
			writeConfigAtomicAtBinding(binding, 'after: true\n', 'migration', {
				expectedSource: original
			})
		).toThrow(PhysicalPathInspectionError);

		expect(readFileSync(FILE, 'utf8')).toBe(external);
		expect(existsSync(CAS_QUARANTINE)).toBe(false);
		expect(readdirSync(DIR).some((entry) => entry.includes('.posterpilot-bak-'))).toBe(false);
	});

	it('does not treat externally written intended bytes as an idempotent source match', () => {
		const original = 'before: true\n';
		const intended = 'after: true\n';
		writeFileSync(FILE, original, 'utf8');
		const binding = freezeConfigPath(FILE);
		writeFileSync(FILE, intended, 'utf8');

		expect(() =>
			writeConfigAtomicAtBinding(binding, intended, 'migration', {
				expectedSource: original
			})
		).toThrow(PhysicalPathInspectionError);
		expect(readFileSync(FILE, 'utf8')).toBe(intended);
	});

	it('keeps a token proof as the prepared inode and clears it after commit', () => {
		const source = 'before: proof\n';
		const proposed = 'after: proof\n';
		const token = 'checkpoint-proof-123';
		const proof = join(DIR, `.config.yml.posterpilot-commit-proof-${token}`);
		writeFileSync(FILE, source, 'utf8');
		const binding = freezeConfigPath(FILE);

		writeConfigAtomicAtBinding(binding, proposed, 'migration', {
			expectedSource: source,
			proofToken: token
		});

		expect(statSync(FILE).ino).toBe(statSync(proof).ino);
		expect(statSync(FILE).nlink).toBe(2);
		expect(readdirSync(DIR).some((name) => name.includes('.tmp-'))).toBe(false);
		clearConfigCommitProofAtBinding(binding, token, proposed);
		expect(existsSync(proof)).toBe(false);
		expect(statSync(FILE).nlink).toBe(1);
	});

	it('consumes a proof that was durably prepared before its checkpoint', () => {
		const source = 'before: precreated-proof\n';
		const proposed = 'after: precreated-proof\n';
		const token = 'checkpoint-precreated-proof';
		const proof = join(DIR, `.config.yml.posterpilot-commit-proof-${token}`);
		writeFileSync(FILE, source, 'utf8');
		const binding = freezeConfigPath(FILE);

		prepareConfigCommitProofAtBinding(binding, token, proposed);
		const proofInode = statSync(proof).ino;
		writeConfigAtomicAtBinding(binding, proposed, 'migration', {
			expectedSource: source,
			proofToken: token,
			preparedProof: true
		});

		expect(readFileSync(FILE, 'utf8')).toBe(proposed);
		expect(statSync(FILE).ino).toBe(proofInode);
		expect(statSync(FILE).ino).toBe(statSync(proof).ino);
	});

	it('performs a full inode CAS for a precreated no-op proof', () => {
		const content = 'same: precreated-proof\n';
		const token = 'checkpoint-precreated-noop';
		const proof = join(DIR, `.config.yml.posterpilot-commit-proof-${token}`);
		writeFileSync(FILE, content, 'utf8');
		const sourceInode = statSync(FILE).ino;
		const binding = freezeConfigPath(FILE);

		prepareConfigCommitProofAtBinding(binding, token, content);
		const proofInode = statSync(proof).ino;
		expect(proofInode).not.toBe(sourceInode);
		writeConfigAtomicAtBinding(binding, content, 'migration', {
			expectedSource: content,
			proofToken: token,
			preparedProof: true
		});

		expect(statSync(FILE).ino).toBe(proofInode);
		expect(statSync(FILE).ino).toBe(statSync(proof).ino);
		expect(recoverConfigCommitProofAtBinding(binding, token, content, content)).toBe('published');
	});

	it('never recreates a cancelled precreated proof', () => {
		const source = 'before: cancelled-proof\n';
		const proposed = 'after: cancelled-proof\n';
		const token = 'checkpoint-cancelled-proof';
		const proof = join(DIR, `.config.yml.posterpilot-commit-proof-${token}`);
		writeFileSync(FILE, source, 'utf8');
		const binding = freezeConfigPath(FILE);
		prepareConfigCommitProofAtBinding(binding, token, proposed);
		unlinkSync(proof);

		expect(() =>
			writeConfigAtomicAtBinding(binding, proposed, 'migration', {
				expectedSource: source,
				proofToken: token,
				preparedProof: true
			})
		).toThrow(PhysicalPathInspectionError);
		expect(readFileSync(FILE, 'utf8')).toBe(source);
		expect(existsSync(proof)).toBe(false);
	});

	it('rejects simultaneous proof and cancellation artifacts without publishing', () => {
		const source = 'before: conflicting-proof\n';
		const proposed = 'after: conflicting-proof\n';
		const token = 'checkpoint-conflicting-proof';
		const proof = join(DIR, `.config.yml.posterpilot-commit-proof-${token}`);
		const cancellation = join(DIR, `.config.yml.posterpilot-commit-proof-cancel-${token}`);
		writeFileSync(FILE, source, 'utf8');
		const binding = freezeConfigPath(FILE);
		prepareConfigCommitProofAtBinding(binding, token, proposed);
		linkSync(proof, cancellation);

		expect(inspectConfigCommitProofAtBinding(binding, token, source, proposed)).toBe('ambiguous');
		expect(recoverConfigCommitProofAtBinding(binding, token, source, proposed)).toBe('ambiguous');
		expect(() =>
			writeConfigAtomicAtBinding(binding, proposed, 'migration', {
				expectedSource: source,
				proofToken: token,
				preparedProof: true
			})
		).toThrow(PhysicalPathInspectionError);
		expect(readFileSync(FILE, 'utf8')).toBe(source);
		expect(existsSync(CAS_QUARANTINE)).toBe(false);
	});

	it('restores the source when cancellation lands after prepared-proof validation', () => {
		const source = 'before: cancel-race\n';
		const proposed = 'after: cancel-race\n';
		const token = 'checkpoint-cancel-race';
		const proof = join(DIR, `.config.yml.posterpilot-commit-proof-${token}`);
		writeFileSync(FILE, source, 'utf8');
		const binding = freezeConfigPath(FILE);
		prepareConfigCommitProofAtBinding(binding, token, proposed);

		expect(() =>
			writeConfigAtomicAtBinding(binding, proposed, 'migration', {
				expectedSource: source,
				proofToken: token,
				preparedProof: true,
				testHooks: { afterProofCreated: () => unlinkSync(proof) }
			})
		).toThrow(PhysicalPathInspectionError);
		expect(readFileSync(FILE, 'utf8')).toBe(source);
		expect(existsSync(CAS_QUARANTINE)).toBe(false);
		expect(existsSync(proof)).toBe(false);
	});

	it('cleanup-only proof finalization never republishes after an external replacement', () => {
		const source = 'before: cleanup-only\n';
		const proposed = 'after: cleanup-only\n';
		const token = 'checkpoint-cleanup-only';
		const proof = join(DIR, `.config.yml.posterpilot-commit-proof-${token}`);
		writeFileSync(FILE, source, 'utf8');
		const binding = freezeConfigPath(FILE);
		writeConfigAtomicAtBinding(binding, proposed, 'migration', {
			expectedSource: source,
			proofToken: token
		});
		unlinkSync(FILE);
		writeFileSync(FILE, source, 'utf8');

		expect(finalizePublishedConfigCommitProofAtBinding(binding, token, source, proposed)).toBe(
			'ambiguous'
		);
		expect(readFileSync(FILE, 'utf8')).toBe(source);
		expect(readFileSync(proof, 'utf8')).toBe(proposed);
	});

	it('creates an exact inode proof for an idempotent file write that still commits DB state', () => {
		const content = 'same: authorized\n';
		const token = 'checkpoint-noop-proof';
		const proof = join(DIR, `.config.yml.posterpilot-commit-proof-${token}`);
		writeFileSync(FILE, content, 'utf8');
		const binding = freezeConfigPath(FILE);

		expect(
			writeConfigAtomicAtBinding(binding, content, 'migration', {
				expectedSource: content,
				proofToken: token
			})
		).toEqual({ backup: null });
		expect(statSync(FILE).ino).toBe(statSync(proof).ino);
		expect(recoverConfigCommitProofAtBinding(binding, token, content, content)).toBe('published');
		clearConfigCommitProofAtBinding(binding, token, content);
		expect(existsSync(proof)).toBe(false);
	});

	it('classifies proofless external drift as superseding an unpublished checkpoint', () => {
		const source = 'before: checkpoint\n';
		const proposed = 'after: checkpoint\n';
		const token = 'checkpoint-superseded';
		writeFileSync(FILE, source, 'utf8');
		const binding = freezeConfigPath(FILE);
		writeFileSync(FILE, 'external: winner\n', 'utf8');

		expect(recoverConfigCommitProofAtBinding(binding, token, source, proposed)).toBe('superseded');
		expect(readFileSync(FILE, 'utf8')).toBe('external: winner\n');
	});

	it('completes a proven publication after a crash between proof and target', () => {
		const source = 'before: proof-gap\n';
		const proposed = 'after: proof-gap\n';
		const token = 'checkpoint-proof-gap';
		const proof = join(DIR, `.config.yml.posterpilot-commit-proof-${token}`);
		writeFileSync(FILE, source, 'utf8');
		const binding = freezeConfigPath(FILE);

		expect(() =>
			writeConfigAtomicAtBinding(binding, proposed, 'migration', {
				expectedSource: source,
				proofToken: token,
				testHooks: {
					afterProofCreated: () => {
						throw new Error('crash after proof');
					}
				}
			})
		).toThrow('crash after proof');
		expect(readFileSync(FILE, 'utf8')).toBe(source);
		expect(existsSync(proof)).toBe(true);
		expect(readdirSync(DIR).some((name) => name.includes('.tmp-'))).toBe(false);

		expect(recoverConfigCommitProofAtBinding(binding, token, source, proposed)).toBe('published');
		expect(readFileSync(FILE, 'utf8')).toBe(proposed);
		expect(statSync(FILE).ino).toBe(statSync(proof).ino);
	});

	it('inspects a prepared proof without publishing it and can discard the attempt', () => {
		const source = 'before: prepared\n';
		const proposed = 'after: prepared\n';
		const token = 'checkpoint-prepared-inspection';
		const proof = join(DIR, `.config.yml.posterpilot-commit-proof-${token}`);
		const cancellation = join(DIR, `.config.yml.posterpilot-commit-proof-cancel-${token}`);
		writeFileSync(FILE, source, 'utf8');
		const binding = freezeConfigPath(FILE);

		expect(() =>
			writeConfigAtomicAtBinding(binding, proposed, 'migration', {
				expectedSource: source,
				proofToken: token,
				testHooks: {
					afterProofCreated: () => {
						throw new Error('stop');
					}
				}
			})
		).toThrow('stop');
		expect(inspectConfigCommitProofAtBinding(binding, token, source, proposed)).toBe('prepared');
		expect(readFileSync(FILE, 'utf8')).toBe(source);
		expect(existsSync(proof)).toBe(true);

		expect(discardUnpublishedConfigCommitProofAtBinding(binding, token, source, proposed)).toBe(
			'discarded'
		);
		expect(readFileSync(FILE, 'utf8')).toBe(source);
		expect(existsSync(proof)).toBe(false);
		expect(existsSync(cancellation)).toBe(true);
		expect(inspectConfigCommitProofAtBinding(binding, token, source, proposed)).toBe('cancelled');
		clearConfigCommitCancellationAtBinding(binding, token, proposed);
		expect(existsSync(cancellation)).toBe(false);
	});

	it('restores the exact detached predecessor while discarding a stale prepared proof', () => {
		const source = 'before: detached\n';
		const proposed = 'after: detached\n';
		const token = 'checkpoint-detached-discard';
		const proof = join(DIR, `.config.yml.posterpilot-commit-proof-${token}`);
		const cancellation = join(DIR, `.config.yml.posterpilot-commit-proof-cancel-${token}`);
		writeFileSync(FILE, source, 'utf8');
		const binding = freezeConfigPath(FILE);
		writeFileSync(proof, proposed, { encoding: 'utf8', mode: 0o600 });
		renameSync(FILE, CAS_QUARANTINE);

		expect(inspectConfigCommitProofAtBinding(binding, token, source, proposed)).toBe('prepared');
		expect(discardUnpublishedConfigCommitProofAtBinding(binding, token, source, proposed)).toBe(
			'discarded'
		);
		expect(readFileSync(FILE, 'utf8')).toBe(source);
		expect(existsSync(proof)).toBe(false);
		expect(existsSync(CAS_QUARANTINE)).toBe(false);
		expect(existsSync(cancellation)).toBe(true);
		clearConfigCommitCancellationAtBinding(binding, token, proposed);
	});

	it('retries discard from its durable cancellation marker after source restore crashes', () => {
		const source = 'before: restored-crash\n';
		const proposed = 'after: restored-crash\n';
		const token = 'checkpoint-restored-crash';
		const proof = join(DIR, `.config.yml.posterpilot-commit-proof-${token}`);
		const cancellation = join(DIR, `.config.yml.posterpilot-commit-proof-cancel-${token}`);
		writeFileSync(FILE, source, 'utf8');
		const binding = freezeConfigPath(FILE);
		writeFileSync(proof, proposed, { encoding: 'utf8', mode: 0o600 });
		renameSync(FILE, CAS_QUARANTINE);

		expect(() =>
			discardUnpublishedConfigCommitProofAtBinding(binding, token, source, proposed, {
				afterSourceRestored: () => {
					throw new Error('crash after source restore');
				}
			})
		).toThrow('crash after source restore');
		expect(statSync(FILE).ino).toBe(statSync(CAS_QUARANTINE).ino);
		expect(existsSync(proof)).toBe(false);
		expect(existsSync(cancellation)).toBe(true);
		expect(inspectConfigCommitProofAtBinding(binding, token, source, proposed)).toBe('cancelled');
		expect(discardUnpublishedConfigCommitProofAtBinding(binding, token, source, proposed)).toBe(
			'discarded'
		);
		expect(readFileSync(FILE, 'utf8')).toBe(source);
		expect(existsSync(CAS_QUARANTINE)).toBe(false);
		expect(existsSync(proof)).toBe(false);
		expect(existsSync(cancellation)).toBe(true);
		clearConfigCommitCancellationAtBinding(binding, token, proposed);
	});

	it('preserves proof when the old writer publishes immediately before cancellation', () => {
		const source = 'before: cancellation-race\n';
		const proposed = 'after: cancellation-race\n';
		const token = 'checkpoint-cancellation-race';
		const proof = join(DIR, `.config.yml.posterpilot-commit-proof-${token}`);
		writeFileSync(FILE, source, 'utf8');
		const binding = freezeConfigPath(FILE);
		prepareConfigCommitProofAtBinding(binding, token, proposed);

		expect(
			discardUnpublishedConfigCommitProofAtBinding(binding, token, source, proposed, {
				beforeProofCancellation: () => {
					renameSync(FILE, CAS_QUARANTINE);
					linkSync(proof, FILE);
				}
			})
		).toBe('published');
		expect(statSync(FILE).ino).toBe(statSync(proof).ino);
		expect(finalizePublishedConfigCommitProofAtBinding(binding, token, source, proposed)).toBe(
			'published'
		);
		expect(existsSync(CAS_QUARANTINE)).toBe(false);
	});

	it('resumes an unpublished cancellation after its marker fsync', () => {
		const source = 'before: cancellation-marker\n';
		const proposed = 'after: cancellation-marker\n';
		const token = 'checkpoint-cancellation-marker';
		const proof = join(DIR, `.config.yml.posterpilot-commit-proof-${token}`);
		const cancellation = join(DIR, `.config.yml.posterpilot-commit-proof-cancel-${token}`);
		writeFileSync(FILE, source, 'utf8');
		const binding = freezeConfigPath(FILE);
		prepareConfigCommitProofAtBinding(binding, token, proposed);

		expect(() =>
			discardUnpublishedConfigCommitProofAtBinding(binding, token, source, proposed, {
				afterProofCancelled: () => {
					throw new Error('crash after cancellation fsync');
				}
			})
		).toThrow('crash after cancellation fsync');
		expect(existsSync(proof)).toBe(false);
		expect(existsSync(cancellation)).toBe(true);
		expect(readFileSync(FILE, 'utf8')).toBe(source);
		expect(inspectConfigCommitProofAtBinding(binding, token, source, proposed)).toBe('cancelled');
		expect(discardUnpublishedConfigCommitProofAtBinding(binding, token, source, proposed)).toBe(
			'discarded'
		);
		clearConfigCommitCancellationAtBinding(binding, token, proposed);
	});

	it('recovers publication evidence after crashing just after proof cancellation', () => {
		const source = 'before: cancellation-crash\n';
		const proposed = 'after: cancellation-crash\n';
		const token = 'checkpoint-cancellation-crash';
		const proof = join(DIR, `.config.yml.posterpilot-commit-proof-${token}`);
		const cancellation = join(DIR, `.config.yml.posterpilot-commit-proof-cancel-${token}`);
		writeFileSync(FILE, source, 'utf8');
		const binding = freezeConfigPath(FILE);
		prepareConfigCommitProofAtBinding(binding, token, proposed);

		expect(() =>
			discardUnpublishedConfigCommitProofAtBinding(binding, token, source, proposed, {
				beforeProofCancellation: () => {
					renameSync(FILE, CAS_QUARANTINE);
					linkSync(proof, FILE);
				},
				afterProofCancelled: () => {
					throw new Error('crash after proof cancellation');
				}
			})
		).toThrow('crash after proof cancellation');
		expect(existsSync(proof)).toBe(false);
		expect(existsSync(cancellation)).toBe(true);
		expect(statSync(FILE).ino).toBe(statSync(cancellation).ino);
		expect(inspectConfigCommitProofAtBinding(binding, token, source, proposed)).toBe('cancelled');

		expect(discardUnpublishedConfigCommitProofAtBinding(binding, token, source, proposed)).toBe(
			'published'
		);
		expect(statSync(FILE).ino).toBe(statSync(proof).ino);
		expect(existsSync(cancellation)).toBe(false);
	});

	it('continues a bound write from durable duplicate predecessor links', () => {
		const source = 'before: duplicate-links\n';
		const proposed = 'after: duplicate-links\n';
		writeFileSync(FILE, source, 'utf8');
		const binding = freezeConfigPath(FILE);
		linkSync(FILE, CAS_QUARANTINE);

		expect(
			writeConfigAtomicAtBinding(binding, proposed, 'migration', { expectedSource: source })
		).toEqual({ backup: expect.any(String) });
		expect(readFileSync(FILE, 'utf8')).toBe(proposed);
		expect(existsSync(CAS_QUARANTINE)).toBe(false);
	});

	it.each([true, false])(
		'recovers duplicate predecessor links before proof publication (proof exists: %s)',
		(proofExists) => {
			const source = 'before: duplicate-recovery\n';
			const proposed = 'after: duplicate-recovery\n';
			const token = `checkpoint-duplicate-recovery-${proofExists ? 'proof' : 'no-proof'}`;
			const proof = join(DIR, `.config.yml.posterpilot-commit-proof-${token}`);
			writeFileSync(FILE, source, 'utf8');
			const binding = freezeConfigPath(FILE);
			linkSync(FILE, CAS_QUARANTINE);
			if (proofExists) writeFileSync(proof, proposed, { encoding: 'utf8', mode: 0o600 });

			expect(recoverConfigCommitProofAtBinding(binding, token, source, proposed)).toBe(
				proofExists ? 'published' : 'not_published'
			);
			expect(readFileSync(FILE, 'utf8')).toBe(proofExists ? proposed : source);
			expect(existsSync(CAS_QUARANTINE)).toBe(false);
		}
	);

	it('does not accept external identical bytes on a different inode as publication proof', () => {
		const source = 'before: proof-race\n';
		const proposed = 'after: proof-race\n';
		const token = 'checkpoint-proof-race';
		const proof = join(DIR, `.config.yml.posterpilot-commit-proof-${token}`);
		writeFileSync(FILE, source, 'utf8');
		const binding = freezeConfigPath(FILE);
		expect(() =>
			writeConfigAtomicAtBinding(binding, proposed, 'migration', {
				expectedSource: source,
				proofToken: token,
				testHooks: {
					afterProofCreated: () => {
						throw new Error('stop');
					}
				}
			})
		).toThrow('stop');
		unlinkSync(FILE);
		writeFileSync(FILE, proposed, 'utf8');

		expect(statSync(FILE).ino).not.toBe(statSync(proof).ino);
		expect(recoverConfigCommitProofAtBinding(binding, token, source, proposed)).toBe('ambiguous');
		expect(readFileSync(FILE, 'utf8')).toBe(proposed);
	});

	it('finalizes a published target left beside its exact source quarantine', () => {
		const original = 'before: crash\n';
		const intended = 'after: published\n';
		writeFileSync(FILE, original, 'utf8');
		const binding = freezeConfigPath(FILE);

		// Exact durable state left by termination after publish and before the
		// writer removes its detached predecessor.
		renameSync(FILE, CAS_QUARANTINE);
		writeFileSync(FILE, intended, 'utf8');

		const result = writeConfigAtomicAtBinding(binding, intended, 'migration', {
			expectedSource: original
		});

		expect(result.backup).toBeNull();
		expect(readFileSync(FILE, 'utf8')).toBe(intended);
		expect(existsSync(CAS_QUARANTINE)).toBe(false);
	});

	it('preserves quarantine when identical target bytes do not share the prepared proof inode', () => {
		const source = 'before: proof-quarantine-race\n';
		const proposed = 'after: proof-quarantine-race\n';
		const token = 'checkpoint-proof-quarantine-race';
		const proof = join(DIR, `.config.yml.posterpilot-commit-proof-${token}`);
		writeFileSync(FILE, source, 'utf8');
		const binding = freezeConfigPath(FILE);
		prepareConfigCommitProofAtBinding(binding, token, proposed);
		renameSync(FILE, CAS_QUARANTINE);
		writeFileSync(FILE, proposed, 'utf8');

		expect(statSync(FILE).ino).not.toBe(statSync(proof).ino);
		expect(() =>
			writeConfigAtomicAtBinding(binding, proposed, 'migration', {
				expectedSource: source,
				proofToken: token,
				preparedProof: true
			})
		).toThrow(PhysicalPathInspectionError);
		expect(readFileSync(FILE, 'utf8')).toBe(proposed);
		expect(readFileSync(CAS_QUARANTINE, 'utf8')).toBe(source);
		expect(inspectConfigCommitProofAtBinding(binding, token, source, proposed)).toBe('ambiguous');
	});

	it('preserves both files when a stale quarantine target is not the intended publication', () => {
		const original = 'before: crash\n';
		const external = 'external: concurrent-edit\n';
		writeFileSync(FILE, original, 'utf8');
		const binding = freezeConfigPath(FILE);
		renameSync(FILE, CAS_QUARANTINE);
		writeFileSync(FILE, external, 'utf8');

		expect(() =>
			writeConfigAtomicAtBinding(binding, 'after: intended\n', 'migration', {
				expectedSource: original
			})
		).toThrow(PhysicalPathInspectionError);

		expect(readFileSync(FILE, 'utf8')).toBe(external);
		expect(readFileSync(CAS_QUARANTINE, 'utf8')).toBe(original);
	});

	it('preserves both files when the quarantined predecessor bytes changed', () => {
		const original = 'before: crash\n';
		const intended = 'after: published\n';
		const tampered = 'external: quarantine-edit\n';
		writeFileSync(FILE, original, 'utf8');
		const binding = freezeConfigPath(FILE);
		renameSync(FILE, CAS_QUARANTINE);
		writeFileSync(FILE, intended, 'utf8');
		writeFileSync(CAS_QUARANTINE, tampered, 'utf8');

		expect(() =>
			writeConfigAtomicAtBinding(binding, intended, 'migration', {
				expectedSource: original
			})
		).toThrow(PhysicalPathInspectionError);

		expect(readFileSync(FILE, 'utf8')).toBe(intended);
		expect(readFileSync(CAS_QUARANTINE, 'utf8')).toBe(tampered);
	});

	it('never overwrites a target that appears at the final publish boundary', () => {
		const original = 'before: true\n';
		const external = 'external: concurrent-edit\n';
		writeFileSync(FILE, original, 'utf8');
		const binding = freezeConfigPath(FILE);

		expect(() =>
			writeConfigAtomicAtBinding(binding, 'after: true\n', 'migration', {
				testHooks: {
					beforePublish: () => writeFileSync(FILE, external, 'utf8')
				}
			})
		).toThrow(PhysicalPathInspectionError);

		expect(readFileSync(FILE, 'utf8')).toBe(external);
		expect(readFileSync(CAS_QUARANTINE, 'utf8')).toBe(original);
		expect(readFileSync(join(DIR, 'config.yml.posterpilot-bak-migration'), 'utf8')).toBe(original);
	});

	it('restores exact bytes after a caught failure between detach and publication', () => {
		const original = 'before: true\n';
		writeFileSync(FILE, original, 'utf8');
		const binding = freezeConfigPath(FILE);

		expect(() =>
			writeConfigAtomicAtBinding(binding, 'after: true\n', 'migration', {
				testHooks: {
					afterTargetDetached: () => {
						throw new Error('injected detach failure');
					}
				}
			})
		).toThrow('injected detach failure');

		expect(readFileSync(FILE, 'utf8')).toBe(original);
		expect(existsSync(CAS_QUARANTINE)).toBe(false);
		expect(readFileSync(join(DIR, 'config.yml.posterpilot-bak-migration'), 'utf8')).toBe(original);
	});

	it('recovers a discoverable quarantine left while the target is absent', () => {
		const original = 'before: crash\n';
		writeFileSync(FILE, original, 'utf8');
		const binding = freezeConfigPath(FILE);
		renameSync(FILE, CAS_QUARANTINE);

		writeConfigAtomicAtBinding(binding, 'after: recovery\n', 'migration');

		expect(readFileSync(FILE, 'utf8')).toBe('after: recovery\n');
		expect(existsSync(CAS_QUARANTINE)).toBe(false);
		expect(readFileSync(join(DIR, 'config.yml.posterpilot-bak-migration'), 'utf8')).toBe(original);
	});

	it('repairs a crash after target detach without publishing new content', () => {
		const original = 'before: detached\n';
		writeFileSync(FILE, original, 'utf8');
		const binding = freezeConfigPath(FILE);
		renameSync(FILE, CAS_QUARANTINE);

		expect(recoverConfigQuarantineAtBinding(binding)).toBe('source_restored');
		expect(readFileSync(FILE, 'utf8')).toBe(original);
		expect(existsSync(CAS_QUARANTINE)).toBe(false);
	});

	it('preserves the predecessor after a crash following publication', () => {
		const original = 'before: published\n';
		const intended = 'after: published\n';
		writeFileSync(FILE, original, 'utf8');
		const binding = freezeConfigPath(FILE);
		renameSync(FILE, CAS_QUARANTINE);
		writeFileSync(FILE, intended, 'utf8');

		expect(recoverConfigQuarantineAtBinding(binding)).toBe('predecessor_preserved');
		expect(readFileSync(FILE, 'utf8')).toBe(intended);
		expect(existsSync(CAS_QUARANTINE)).toBe(false);
		const recoveryBackup = readdirSync(DIR).find((entry) =>
			entry.startsWith('config.yml.posterpilot-bak-cas-recovery-')
		);
		expect(recoveryBackup).toBeTruthy();
		expect(readFileSync(join(DIR, recoveryBackup!), 'utf8')).toBe(original);
	});

	it('preserves both the predecessor and an external winner during quarantine recovery', () => {
		const original = 'before: external-race\n';
		const external = 'external: winner\n';
		writeFileSync(FILE, original, 'utf8');
		const binding = freezeConfigPath(FILE);
		renameSync(FILE, CAS_QUARANTINE);
		writeFileSync(FILE, external, 'utf8');

		expect(recoverConfigQuarantineAtBinding(binding)).toBe('predecessor_preserved');
		expect(readFileSync(FILE, 'utf8')).toBe(external);
		expect(existsSync(CAS_QUARANTINE)).toBe(false);
		const recoveryBackup = readdirSync(DIR).find((entry) =>
			entry.startsWith('config.yml.posterpilot-bak-cas-recovery-')
		);
		expect(recoveryBackup).toBeTruthy();
		expect(readFileSync(join(DIR, recoveryBackup!), 'utf8')).toBe(original);
	});

	it('finishes an authorized removal left in quarantine without restoring it', () => {
		const proposed = 'created: by-migration\n';
		writeFileSync(FILE, proposed, 'utf8');
		const binding = freezeConfigPath(FILE);
		renameSync(FILE, CAS_QUARANTINE);

		removeConfigAtomicAtBinding(binding, proposed);

		expect(existsSync(FILE)).toBe(false);
		expect(existsSync(CAS_QUARANTINE)).toBe(false);
	});

	it('does not unlink a replacement quarantine during removal recovery', () => {
		const proposed = 'created: by-migration\n';
		const replacement = 'external: quarantine\n';
		writeFileSync(CAS_QUARANTINE, proposed, 'utf8');
		const binding = freezeConfigPath(FILE);

		expect(() =>
			removeConfigAtomicAtBinding(binding, proposed, {
				testHooks: {
					beforeFinalRevalidation: () => {
						unlinkSync(CAS_QUARANTINE);
						writeFileSync(CAS_QUARANTINE, replacement, 'utf8');
					}
				}
			})
		).toThrow(PhysicalPathInspectionError);
		expect(readFileSync(CAS_QUARANTINE, 'utf8')).toBe(replacement);
	});

	it('preserves the newly returned backup when recovery backups fill retention', () => {
		const source = 'before: newest-backup\n';
		writeFileSync(FILE, source, 'utf8');
		for (let index = 0; index < 5; index++) {
			writeFileSync(
				join(DIR, `config.yml.posterpilot-bak-cas-recovery-${String(index).padStart(2, '0')}`),
				`recovery: ${index}\n`,
				'utf8'
			);
		}
		const binding = freezeConfigPath(FILE);

		const result = writeConfigAtomicAtBinding(binding, 'after: newest-backup\n', '2026-newest', {
			expectedSource: source
		});

		expect(result.backup).not.toBeNull();
		expect(existsSync(result.backup!)).toBe(true);
		expect(readdirSync(DIR).filter((name) => name.includes('.posterpilot-bak-'))).toHaveLength(5);
	});

	it('fails closed when the frozen directory ancestor is redirected', () => {
		const managedDirectory = join(DIR, 'managed');
		const movedDirectory = join(DIR, 'managed-before-swap');
		const externalDirectory = join(DIR, 'external');
		mkdirSync(managedDirectory);
		mkdirSync(externalDirectory);
		const managedFile = join(managedDirectory, 'config.yml');
		const victim = join(externalDirectory, 'config.yml');
		writeFileSync(managedFile, 'same: bytes\n', 'utf8');
		writeFileSync(victim, 'same: bytes\n', 'utf8');
		const binding = freezeConfigPath(managedFile);

		renameSync(managedDirectory, movedDirectory);
		symlinkSync(externalDirectory, managedDirectory, 'dir');
		expect(() => writeConfigAtomicAtBinding(binding, 'changed: true\n', 'migration')).toThrow(
			PhysicalPathInspectionError
		);
		expect(readFileSync(victim, 'utf8')).toBe('same: bytes\n');
		expect(readFileSync(join(movedDirectory, 'config.yml'), 'utf8')).toBe('same: bytes\n');
	});

	it('detects an ancestor swap while the parent-directory lease is held', () => {
		const managedDirectory = join(DIR, 'managed-race');
		const movedDirectory = join(DIR, 'managed-race-before-swap');
		const externalDirectory = join(DIR, 'external-race');
		mkdirSync(managedDirectory);
		mkdirSync(externalDirectory);
		const managedFile = join(managedDirectory, 'config.yml');
		const victim = join(externalDirectory, 'config.yml');
		writeFileSync(managedFile, 'managed: bytes\n', 'utf8');
		writeFileSync(victim, 'victim: bytes\n', 'utf8');
		const binding = freezeConfigPath(managedFile);

		expect(() =>
			writeConfigAtomicAtBinding(binding, 'changed: true\n', 'migration', {
				testHooks: {
					beforeFinalRevalidation: () => {
						renameSync(managedDirectory, movedDirectory);
						symlinkSync(externalDirectory, managedDirectory, 'dir');
					}
				}
			})
		).toThrow(PhysicalPathInspectionError);

		expect(readFileSync(victim, 'utf8')).toBe('victim: bytes\n');
		expect(readFileSync(join(movedDirectory, 'config.yml'), 'utf8')).toBe('managed: bytes\n');
	});

	it('creates a missing directory suffix without changing the frozen anchor', () => {
		const nested = join(DIR, 'future', 'nested', 'config.yml');
		const binding = freezeConfigPath(nested);
		expect(validateConfigPathBinding(JSON.parse(JSON.stringify(binding)))).toEqual(binding);
		writeConfigAtomicAtBinding(binding, 'created: true\n', 'migration');
		expect(readConfigAtBinding(binding)).toBe('created: true\n');
	});

	it('keeps only the five newest rotating backups under the bound parent lease', () => {
		let current = 'version: 0\n';
		writeFileSync(FILE, current, 'utf8');
		const binding = freezeConfigPath(FILE);

		for (let version = 1; version <= 7; version++) {
			const next = `version: ${version}\n`;
			writeConfigAtomicAtBinding(binding, next, `write-0${version}`, {
				expectedSource: current
			});
			current = next;
		}

		const backups = readdirSync(DIR)
			.filter((entry) => entry.startsWith('config.yml.posterpilot-bak-'))
			.sort();
		expect(backups).toEqual([
			'config.yml.posterpilot-bak-write-03',
			'config.yml.posterpilot-bak-write-04',
			'config.yml.posterpilot-bak-write-05',
			'config.yml.posterpilot-bak-write-06',
			'config.yml.posterpilot-bak-write-07'
		]);
		expect(backups.map((name) => readFileSync(join(DIR, name), 'utf8'))).toEqual([
			'version: 2\n',
			'version: 3\n',
			'version: 4\n',
			'version: 5\n',
			'version: 6\n'
		]);
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

describe('protected migration backups', () => {
	it('creates one deterministic mode-0600 backup and reuses it idempotently', () => {
		const original = 'plex:\n  token: secret\n';
		writeFileSync(FILE, original, 'utf8');
		const first = createProtectedBackup(FILE, 'migration-123', {
			expectedContent: original
		});

		expect(first.name).toBe(protectedBackupName(FILE, 'migration-123'));
		expect(first.created).toBe(true);
		expect(statSync(first.path).mode & 0o777).toBe(0o600);
		expect(readBackup(FILE, first.name, { expectedChecksum: first.checksum })).toBe(original);

		// The protected source remains the preview-bound original even after config
		// advances to the migrated content.
		writeFileSync(FILE, 'libraries: {}\n', 'utf8');
		const repeated = createProtectedBackup(FILE, 'migration-123', {
			expectedContent: original
		});
		expect(repeated).toMatchObject({
			name: first.name,
			checksum: first.checksum,
			created: false
		});
		expect(readFileSync(first.path, 'utf8')).toBe(original);
	});

	it('never follows a protected-backup symlink with matching victim bytes', () => {
		const original = 'plex:\n  token: secret\n';
		const victim = join(DIR, 'backup-victim.yml');
		writeFileSync(FILE, original, 'utf8');
		writeFileSync(victim, original, 'utf8');
		const binding = freezeConfigPath(FILE);
		const backup = createProtectedBackupAtBinding(binding, 'migration-bound', {
			expectedContent: original
		});

		unlinkSync(backup.path);
		symlinkSync(victim, backup.path);
		expect(() =>
			readBackupAtBinding(binding, backup.name, { expectedChecksum: backup.checksum })
		).toThrow(PhysicalPathInspectionError);
		expect(() =>
			createProtectedBackupAtBinding(binding, 'migration-bound', { expectedContent: original })
		).toThrow(PhysicalPathInspectionError);
		expect(readFileSync(victim, 'utf8')).toBe(original);
	});

	it('never chmods a protected-backup hardlink to an external inode', () => {
		const original = 'plex:\n  token: secret\n';
		const victim = join(DIR, 'backup-hardlink-victim.yml');
		writeFileSync(FILE, original, 'utf8');
		writeFileSync(victim, original, 'utf8');
		chmodSync(victim, 0o644);
		const binding = freezeConfigPath(FILE);
		const backup = createProtectedBackupAtBinding(binding, 'migration-hardlink', {
			expectedContent: original
		});

		unlinkSync(backup.path);
		linkSync(victim, backup.path);
		expect(() =>
			createProtectedBackupAtBinding(binding, 'migration-hardlink', {
				expectedContent: original
			})
		).toThrow(PhysicalPathInspectionError);

		expect(readFileSync(victim, 'utf8')).toBe(original);
		expect(statSync(victim).mode & 0o777).toBe(0o644);
	});

	it('detects protected-backup tampering instead of overwriting it', () => {
		const original = 'settings:\n  cache: true\n';
		writeFileSync(FILE, original, 'utf8');
		const backup = createProtectedBackup(FILE, 'migration-tamper', {
			expectedContent: original
		});
		writeFileSync(backup.path, 'tampered\n', 'utf8');

		expect(() =>
			createProtectedBackup(FILE, 'migration-tamper', { expectedContent: original })
		).toThrow('content mismatch');
		expect(() => readBackup(FILE, backup.name, { expectedChecksum: backup.checksum })).toThrow(
			'checksum mismatch'
		);
		expect(readFileSync(backup.path, 'utf8')).toBe('tampered\n');
	});

	it('lists protected backups and never removes them with rotating-backup pruning', () => {
		writeFileSync(FILE, 'original\n', 'utf8');
		const protectedBackup = createProtectedBackup(FILE, 'migration-keep', {
			expectedContent: 'original\n'
		});
		for (const stamp of ['2026-01-01', '2026-02-01']) {
			writeFileSync(join(DIR, `config.yml.posterpilot-bak-${stamp}`), stamp, 'utf8');
		}

		pruneBackups(DIR, 'config.yml', 0);
		expect(existsSync(protectedBackup.path)).toBe(true);
		expect(listBackups(FILE)).toContainEqual({
			name: protectedBackup.name,
			stamp: 'migration-keep',
			protected: true,
			migrationId: 'migration-keep'
		});
		expect(readdirSync(DIR).filter((entry) => entry.includes('.posterpilot-bak-'))).toEqual([]);
	});

	it('rejects migration ids that are not filename-safe', () => {
		writeFileSync(FILE, 'original\n', 'utf8');
		expect(() => createProtectedBackup(FILE, '../escape')).toThrow('Invalid Kometa migration id');
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

	it('serializes relative and absolute aliases of the same path', async () => {
		const alias = relative(process.cwd(), FILE);
		const order: string[] = [];
		let entered!: () => void;
		const started = new Promise<void>((resolve) => (entered = resolve));
		let release!: () => void;
		const paused = new Promise<void>((resolve) => (release = resolve));
		const first = withConfigLock(alias, async () => {
			order.push('first:start');
			entered();
			await paused;
			order.push('first:end');
		});
		await started;
		const second = withConfigLock(FILE, async () => {
			order.push('second');
		});
		await Promise.resolve();
		expect(order).toEqual(['first:start']);
		release();
		await Promise.all([first, second]);
		expect(order).toEqual(['first:start', 'first:end', 'second']);
	});

	it('canonicalizes paths through a symlinked parent directory', () => {
		const real = join(DIR, 'real');
		const alias = join(DIR, 'alias');
		mkdirSync(real);
		symlinkSync(real, alias, 'dir');
		expect(canonicalConfigPath(join(alias, 'future.yml'))).toBe(
			canonicalConfigPath(join(real, 'future.yml'))
		);
	});

	it('re-enters an already-held path without self-deadlocking', async () => {
		const other = join(DIR, 'posterpilot-movies.yml');
		const order: string[] = [];
		await withConfigLocks([FILE, other], async () => {
			order.push('outer');
			await withConfigLock(FILE, async () => {
				order.push('inner');
			});
		});
		expect(order).toEqual(['outer', 'inner']);
	});

	it('keeps compatible nested acquisition when paths follow canonical order', async () => {
		const other = join(DIR, 'posterpilot-shows.yml');
		const order: string[] = [];
		await withConfigLock(FILE, async () => {
			order.push('config');
			await withConfigLock(other, async () => {
				order.push('show');
			});
		});
		expect(order).toEqual(['config', 'show']);
	});

	it('rejects reverse nested acquisition instead of risking a lock-order deadlock', async () => {
		const other = join(DIR, 'posterpilot-shows.yml');
		await expect(
			withConfigLock(other, () => withConfigLock(FILE, async () => undefined))
		).rejects.toThrow('canonical path order');
	});
});

describe('withConfigLocks', () => {
	it('deduplicates and reserves opposing concurrent path sets without deadlock', async () => {
		const other = join(DIR, 'posterpilot-movies.yml');
		const alias = relative(process.cwd(), FILE);
		const order: string[] = [];
		let entered!: () => void;
		const started = new Promise<void>((resolve) => (entered = resolve));
		let release!: () => void;
		const paused = new Promise<void>((resolve) => (release = resolve));

		const first = withConfigLocks([other, FILE, alias], async () => {
			order.push('first:start');
			entered();
			await paused;
			order.push('first:end');
		});
		await started;
		const second = withConfigLocks([FILE, other], async () => {
			order.push('second');
		});
		await Promise.resolve();
		expect(order).toEqual(['first:start']);

		release();
		await Promise.all([first, second]);
		expect(order).toEqual(['first:start', 'first:end', 'second']);
	});
});
