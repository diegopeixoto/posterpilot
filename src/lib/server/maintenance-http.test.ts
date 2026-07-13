import { describe, expect, it } from 'vitest';
import { maintenanceBlocksRequest } from './maintenance-http';

describe('maintenanceBlocksRequest', () => {
	it('blocks API mutations', () => {
		expect(maintenanceBlocksRequest('/api/servers', 'POST')).toBe(true);
		expect(maintenanceBlocksRequest('/api/settings', 'PUT')).toBe(true);
		expect(maintenanceBlocksRequest('/api/backups/b1', 'DELETE')).toBe(true);
		expect(maintenanceBlocksRequest('/api/review/items/1', 'PATCH')).toBe(true);
	});

	it('allows API reads', () => {
		expect(maintenanceBlocksRequest('/api/backups', 'GET')).toBe(false);
		expect(maintenanceBlocksRequest('/api/health', 'HEAD')).toBe(false);
		expect(maintenanceBlocksRequest('/api/servers', 'OPTIONS')).toBe(false);
	});

	it('treats method case-insensitively', () => {
		expect(maintenanceBlocksRequest('/api/servers', 'post')).toBe(true);
		expect(maintenanceBlocksRequest('/api/servers', 'get')).toBe(false);
	});

	it('exempts logout so a stuck session can still end', () => {
		expect(maintenanceBlocksRequest('/api/auth/logout', 'POST')).toBe(false);
	});

	it('ignores non-API paths (pages render read-only)', () => {
		expect(maintenanceBlocksRequest('/settings', 'POST')).toBe(false);
		expect(maintenanceBlocksRequest('/login', 'POST')).toBe(false);
	});
});
