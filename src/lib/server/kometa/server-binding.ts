import { getServerInstance, getServerInstanceConnection } from '$lib/server/server-instances';

export type KometaServerBindingStatus = 'ready' | 'missing' | 'incompatible' | 'unavailable';

export interface KometaServerBinding {
	id: string;
	name: string;
	plexUrl: string;
	plexToken: string;
}

export interface ResolvedKometaServerBinding {
	status: KometaServerBindingStatus;
	binding: KometaServerBinding | null;
}

/**
 * Resolve the one named Plex instance that owns the configured Kometa target.
 * This deliberately has no active-server or legacy-credential fallback: a missing,
 * disabled, disconnected, incomplete, or non-Plex binding fails closed.
 */
export async function resolveKometaServerBinding(
	serverInstanceId: string | null | undefined
): Promise<ResolvedKometaServerBinding> {
	const id = serverInstanceId?.trim();
	if (!id || id !== serverInstanceId) return { status: 'missing', binding: null };

	const summary = await getServerInstance(id).catch(() => null);
	if (!summary) return { status: 'missing', binding: null };
	if (summary.type !== 'plex') return { status: 'incompatible', binding: null };
	if (!summary.enabled || summary.disconnectedAt !== null) {
		return { status: 'unavailable', binding: null };
	}

	const connection = await getServerInstanceConnection(id, { requireEnabled: true }).catch(
		() => null
	);
	if (!connection?.baseUrl || !connection.credential) {
		return { status: 'unavailable', binding: null };
	}

	return {
		status: 'ready',
		binding: {
			id: connection.id,
			name: connection.name,
			plexUrl: connection.baseUrl,
			plexToken: connection.credential
		}
	};
}

export function kometaBindingErrorCode(status: Exclude<KometaServerBindingStatus, 'ready'>) {
	return `kometa_server_binding_${status}` as const;
}
