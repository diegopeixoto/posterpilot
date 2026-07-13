/**
 * Compatibility alias for clients that still use the former `/revert` path.
 * It intentionally keeps the exact two-phase POST-preview / PUT-confirm contract
 * and never calls the legacy unlock/delete-history implementation.
 */
export { POST, PUT } from '../undo/+server';
