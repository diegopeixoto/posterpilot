import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ locale: 'en' }));

vi.mock('$lib/paraglide/messages', () => ({
	m: new Proxy(
		{},
		{
			get: (_target, key) => () => `${h.locale}:${String(key)}`
		}
	)
}));

import { jobStatusLabel, jobTypeLabel } from './job-labels';

describe('localized durable job codes', () => {
	beforeEach(() => {
		h.locale = 'en';
	});

	it('renders the same persisted status and type in the current locale', () => {
		expect(jobStatusLabel('completed')).toBe('en:jobs_status_completed');
		expect(jobTypeLabel('apply')).toBe('en:jobs_type_apply');

		h.locale = 'pt-BR';
		expect(jobStatusLabel('completed')).toBe('pt-BR:jobs_status_completed');
		expect(jobTypeLabel('apply')).toBe('pt-BR:jobs_type_apply');
	});

	it('uses localized unknown labels without exposing future machine codes', () => {
		expect(jobStatusLabel('future_status')).toBe('en:jobs_status_unknown');
		expect(jobTypeLabel('future_job')).toBe('en:jobs_type_unknown');
	});
});
