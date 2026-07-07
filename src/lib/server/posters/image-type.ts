/**
 * Magic-byte image sniffing for upload validation. Pure and `$env`-free.
 *
 * The upload route validates content by signature rather than trusting the
 * client-declared MIME type, so a `.txt` renamed `.jpg` is rejected. Allow-list:
 * JPEG, PNG, WebP.
 */

export type ImageType = 'image/jpeg' | 'image/png' | 'image/webp';

/**
 * Detect the image type from the leading bytes, or `null` if it is not one of the
 * allowed formats. Accepts a `Uint8Array`/`Buffer`/`ArrayBuffer` view of the head
 * of the file.
 */
export function sniffImageType(input: ArrayBuffer | Uint8Array): ImageType | null {
	const b = input instanceof Uint8Array ? input : new Uint8Array(input);
	if (b.length < 12) return null;

	// JPEG: FF D8 FF
	if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';

	// PNG: 89 50 4E 47 0D 0A 1A 0A
	if (
		b[0] === 0x89 &&
		b[1] === 0x50 &&
		b[2] === 0x4e &&
		b[3] === 0x47 &&
		b[4] === 0x0d &&
		b[5] === 0x0a &&
		b[6] === 0x1a &&
		b[7] === 0x0a
	) {
		return 'image/png';
	}

	// WebP: "RIFF" .... "WEBP"
	if (
		b[0] === 0x52 &&
		b[1] === 0x49 &&
		b[2] === 0x46 &&
		b[3] === 0x46 &&
		b[8] === 0x57 &&
		b[9] === 0x45 &&
		b[10] === 0x42 &&
		b[11] === 0x50
	) {
		return 'image/webp';
	}

	return null;
}
