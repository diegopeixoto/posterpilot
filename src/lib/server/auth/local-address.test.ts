import { describe, expect, it } from 'vitest';
import { isLocalAddress, decideLocalBypass } from './local-address';

describe('auth/local-address · isLocalAddress', () => {
	it('accepts loopback', () => {
		expect(isLocalAddress('127.0.0.1')).toBe(true);
		expect(isLocalAddress('127.5.5.5')).toBe(true);
		expect(isLocalAddress('::1')).toBe(true);
	});

	it('accepts RFC1918 ranges', () => {
		expect(isLocalAddress('10.0.0.1')).toBe(true);
		expect(isLocalAddress('192.168.1.50')).toBe(true);
		expect(isLocalAddress('172.16.0.1')).toBe(true);
		expect(isLocalAddress('172.31.255.255')).toBe(true);
	});

	it('rejects the 172.16/12 boundaries', () => {
		expect(isLocalAddress('172.15.0.1')).toBe(false);
		expect(isLocalAddress('172.32.0.1')).toBe(false);
	});

	it('accepts link-local and IPv6 ULA', () => {
		expect(isLocalAddress('169.254.1.1')).toBe(true);
		expect(isLocalAddress('fc00::1')).toBe(true);
		expect(isLocalAddress('fd12:3456::1')).toBe(true);
		expect(isLocalAddress('fe80::1')).toBe(true);
	});

	it('unwraps IPv4-mapped IPv6', () => {
		expect(isLocalAddress('::ffff:192.168.0.1')).toBe(true);
		expect(isLocalAddress('::ffff:8.8.8.8')).toBe(false);
	});

	it('rejects public addresses and garbage (fail-closed)', () => {
		expect(isLocalAddress('8.8.8.8')).toBe(false);
		expect(isLocalAddress('1.2.3.4')).toBe(false);
		expect(isLocalAddress('2001:4860:4860::8888')).toBe(false);
		expect(isLocalAddress('not-an-ip')).toBe(false);
		expect(isLocalAddress('999.999.999.999')).toBe(false);
		expect(isLocalAddress('')).toBe(false);
		expect(isLocalAddress(null)).toBe(false);
		expect(isLocalAddress(undefined)).toBe(false);
	});
});

describe('auth/local-address · decideLocalBypass', () => {
	it('bypasses a direct LAN client', () => {
		expect(
			decideLocalBypass({
				clientAddress: '192.168.1.5',
				addressHeaderConfigured: false,
				hasForwardedHeader: false
			})
		).toBe(true);
	});

	it('fails closed for proxied traffic with no configured trust', () => {
		expect(
			decideLocalBypass({
				clientAddress: '10.0.0.2',
				addressHeaderConfigured: false,
				hasForwardedHeader: true
			})
		).toBe(false);
	});

	it('honors local detection when address header trust is configured', () => {
		expect(
			decideLocalBypass({
				clientAddress: '192.168.1.5',
				addressHeaderConfigured: true,
				hasForwardedHeader: true
			})
		).toBe(true);
		expect(
			decideLocalBypass({
				clientAddress: '8.8.8.8',
				addressHeaderConfigured: true,
				hasForwardedHeader: true
			})
		).toBe(false);
	});
});
