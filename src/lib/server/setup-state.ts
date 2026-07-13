import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { settings } from '$lib/server/db/schema';

const SETUP_DISMISSED_KEY = 'setupDismissed';

export async function isSetupDismissed(): Promise<boolean> {
	const [row] = await db
		.select({ value: settings.value })
		.from(settings)
		.where(eq(settings.key, SETUP_DISMISSED_KEY))
		.limit(1);
	return row?.value === 'true';
}

export async function setSetupDismissed(dismissed: boolean): Promise<void> {
	await db
		.insert(settings)
		.values({ key: SETUP_DISMISSED_KEY, value: String(dismissed) })
		.onConflictDoUpdate({ target: settings.key, set: { value: String(dismissed) } });
}
