import { access, lstat, open, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DiagnosticCheckError, type DiagnosticPathChecks } from './types';

export interface PathProbeOptions {
	expectedType: 'file' | 'directory';
	requireReadable?: boolean;
	requireWritable?: boolean;
	probeName?: () => string;
}

/** Validate a configured path and use a disposable, owner-only writability probe. */
export async function probePath(
	path: string,
	options: PathProbeOptions
): Promise<DiagnosticPathChecks> {
	const checks: DiagnosticPathChecks = {
		path,
		exists: false,
		expectedType: options.expectedType,
		actualType: 'missing',
		readable: false,
		writable: false,
		probeCleaned: true
	};
	let stat: Awaited<ReturnType<typeof lstat>>;
	try {
		stat = await lstat(path);
	} catch {
		throw new DiagnosticCheckError('path_missing', 'The configured path does not exist.', false, {
			pathChecks: checks
		});
	}

	const actualType = stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : 'other';
	checks.exists = true;
	checks.actualType = actualType;
	if (actualType !== options.expectedType) {
		throw new DiagnosticCheckError(
			'path_type_mismatch',
			'The configured path has the wrong type.',
			false,
			{ pathChecks: checks }
		);
	}

	const readable = await access(path, constants.R_OK).then(
		() => true,
		() => false
	);
	checks.readable = readable;
	if ((options.requireReadable ?? true) && !readable) {
		throw new DiagnosticCheckError(
			'path_unreadable',
			'The configured path is not readable.',
			false,
			{
				pathChecks: checks
			}
		);
	}

	const writable = await access(path, constants.W_OK).then(
		() => true,
		() => false
	);
	checks.writable = writable;
	if (options.requireWritable && !writable) {
		throw new DiagnosticCheckError(
			'path_unwritable',
			'The configured path is not writable.',
			false,
			{
				pathChecks: checks
			}
		);
	}

	let probeCleaned = true;
	if (options.requireWritable) {
		const parent = options.expectedType === 'directory' ? path : dirname(path);
		const probePath = join(
			parent,
			options.probeName?.() ?? `.posterpilot-diagnostic-${randomUUID()}`
		);
		let handle: Awaited<ReturnType<typeof open>> | null = null;
		try {
			handle = await open(probePath, 'wx', 0o600);
		} catch {
			throw new DiagnosticCheckError(
				'path_unwritable',
				'The configured path is not writable.',
				false,
				{ pathChecks: checks }
			);
		} finally {
			await handle?.close().catch(() => {});
			if (handle) {
				probeCleaned = await unlink(probePath).then(
					() => true,
					() => false
				);
			}
		}
		if (!probeCleaned) {
			checks.probeCleaned = false;
			throw new DiagnosticCheckError(
				'path_unwritable',
				'The disposable path probe could not be removed.',
				false,
				{ pathChecks: checks }
			);
		}
	}

	checks.probeCleaned = probeCleaned;
	return checks;
}
