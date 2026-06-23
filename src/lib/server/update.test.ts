import { describe, expect, it } from 'vitest';
import { isNewerVersion } from './semver';

describe('isNewerVersion', () => {
	it('detects a newer version', () => {
		expect(isNewerVersion('0.2.0', '0.0.1')).toBe(true);
		expect(isNewerVersion('1.0.0', '0.9.9')).toBe(true);
		expect(isNewerVersion('0.0.2', '0.0.1')).toBe(true);
	});

	it('returns false for equal or older versions', () => {
		expect(isNewerVersion('0.0.1', '0.0.1')).toBe(false);
		expect(isNewerVersion('0.0.1', '0.2.0')).toBe(false);
		expect(isNewerVersion('1.2.3', '1.2.3')).toBe(false);
	});

	it('ignores a leading v and uneven segment counts', () => {
		expect(isNewerVersion('v1.2', '1.1.9')).toBe(true);
		expect(isNewerVersion('v1.0.0', 'v1')).toBe(false);
		expect(isNewerVersion('1.0.1', 'v1')).toBe(true);
	});
});
