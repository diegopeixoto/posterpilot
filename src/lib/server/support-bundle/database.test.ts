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
			quickCheck: [{ quick_check: 'ok' }],
			passiveCheckpoint: [{ busy: 0 }]
		});
	});
});
