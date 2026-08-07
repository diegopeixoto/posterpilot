import { db } from '$lib/server/db';
import { createTmdbRepairRepository } from './repair-store';

export type { TmdbIdentityGuard, TmdbRepairJobState, TmdbRepairState } from './repair-store';

const repairRepository = createTmdbRepairRepository(db);

export const listPendingTmdbRepairItemIds = repairRepository.listPendingItemIds;
export const countPendingTmdbRepairs = repairRepository.countPending;
export const getTmdbRepairState = repairRepository.getState;
export const writeTmdbMetadataIfCurrent = repairRepository.writeMetadataIfCurrent;
export const markTmdbSyncedIfCurrent = repairRepository.markSyncedIfCurrent;
export const clearTmdbSyncWatermarkIfCurrent = repairRepository.clearSyncWatermarkIfCurrent;
