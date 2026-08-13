import { describe, expect, it, vi } from 'vitest';
import { inspectSupportDatabase } from './database';

describe('support database inspection', () => {
	it('collects bounded metadata without returning the database path', async () => {
		const execute = vi.fn(async (sql: string) => {
			if (sql.includes('journal_mode')) return { rows: [{ journal_mode: 'wal' }] };
			if (sql.includes('quick_check')) return { rows: [{ quick_check: 'ok' }] };
			if (sql.includes('wal_checkpoint')) return { rows: [{ busy: 0, log: 2, checkpointed: 2 }] };
			return {
				rows: [{ synchronous: 2, wal_autocheckpoint: 1000, page_size: 4096, page_count: 4 }]
			};
		});
		const result = await inspectSupportDatabase({ execute } as never, null);
		expect(JSON.stringify(result)).not.toContain('/');
		expect(result).toMatchObject({
			pragmas: { journalMode: 'wal' },
			quickCheck: { status: 'completed', rows: [{ quick_check: 'ok' }] },
			passiveCheckpoint: [{ busy: 0 }]
		});
	});

	it('omits the full scan when the database exceeds the page work bound', async () => {
		const execute = vi.fn(async (sql: string) => {
			if (sql.includes('page_count')) return { rows: [{ page_count: 25_001 }] };
			if (sql.includes('wal_checkpoint')) return { rows: [{ busy: 0, log: 0, checkpointed: 0 }] };
			return { rows: [{}] };
		});
		const result = await inspectSupportDatabase({ execute } as never, null);
		expect(result.quickCheck).toEqual({
			status: 'omitted',
			reason: 'database_too_large',
			maxPages: 25_000
		});
		expect(execute.mock.calls.flat().join(' ')).not.toContain('quick_check');
	});
});
