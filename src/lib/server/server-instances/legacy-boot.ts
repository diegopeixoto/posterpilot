import { materializeLegacyServerInstance } from './index';
import {
	LegacyServerMutationControlError,
	withLegacyServerMutationControl,
	type LegacyServerMutationControlErrorCode
} from './legacy-mutation';

export type LegacyServerBootMaterialization =
	| {
			status: 'materialized';
			server: Awaited<ReturnType<typeof materializeLegacyServerInstance>>;
	  }
	| { status: 'deferred'; reason: LegacyServerMutationControlErrorCode };

/**
 * Boot must remain available so an operator can finish recovery. A known pending
 * checkpoint or migration therefore defers the legacy row write instead of
 * changing its credentials or aborting startup.
 */
export async function materializeLegacyServerInstanceAtBoot(): Promise<LegacyServerBootMaterialization> {
	try {
		const server = await withLegacyServerMutationControl(({ controlLease }) =>
			materializeLegacyServerInstance(controlLease)
		);
		return { status: 'materialized', server };
	} catch (error) {
		if (error instanceof LegacyServerMutationControlError) {
			return { status: 'deferred', reason: error.code };
		}
		throw error;
	}
}
