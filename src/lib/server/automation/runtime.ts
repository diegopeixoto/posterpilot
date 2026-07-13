import { db } from '$lib/server/db';
import { createAutomationStore } from './store';

export const automationStore = createAutomationStore(db);
