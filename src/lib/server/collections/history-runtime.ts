import { db } from '$lib/server/db';
import { createCollectionHistory } from './history';

export const collectionHistory = createCollectionHistory(db);
