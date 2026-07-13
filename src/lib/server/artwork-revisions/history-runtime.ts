import { db } from '$lib/server/db';
import {
	createArtworkRevisionHistoryRepository,
	type ArtworkRevisionHistoryQuery
} from './history';

const repository = createArtworkRevisionHistoryRepository(db);

export function listActiveItemArtworkRevisionHistory(input: {
	serverInstanceId: string;
	mediaItemId: number;
	query: ArtworkRevisionHistoryQuery;
}) {
	return repository.listItemHistory(input);
}
