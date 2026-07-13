import { decryptSecret, encryptSecret, isEncrypted } from '$lib/server/secrets/crypto';
import { getEncryptionKey } from '$lib/server/secrets/key';

/**
 * Encode a canonical operation-plan payload for persistence. Plans can contain
 * provider URLs, webhook values, or other confirmation-only details, so their
 * JSON must receive the same at-rest protection as stored settings.
 */
export function encodeOperationPlanPayload(
	canonicalPayload: string,
	key: Buffer = getEncryptionKey()
): string {
	return encryptSecret(canonicalPayload, key);
}

/**
 * Decode a persisted operation-plan payload. Plaintext is accepted only for
 * legacy rows created before encrypted plan storage was introduced.
 */
export function decodeOperationPlanPayload(storedPayload: string, key?: Buffer): string {
	if (!isEncrypted(storedPayload)) return storedPayload;
	return decryptSecret(storedPayload, key ?? getEncryptionKey());
}
