import { describe, expect, it } from 'vitest';
import { sniffImageType } from './image-type';

function bytes(head: number[], len = 16): Uint8Array {
	const b = new Uint8Array(len);
	head.forEach((v, i) => (b[i] = v));
	return b;
}

describe('posters/image-type · sniffImageType', () => {
	it('detects JPEG', () => {
		expect(sniffImageType(bytes([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
	});

	it('detects PNG', () => {
		expect(sniffImageType(bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(
			'image/png'
		);
	});

	it('detects WebP', () => {
		// "RIFF" + 4 size bytes + "WEBP"
		const b = bytes([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);
		expect(sniffImageType(b)).toBe('image/webp');
	});

	it('rejects a text file (spoofed extension)', () => {
		// "hello world!" — not an image
		const b = new TextEncoder().encode('hello world!!!!!');
		expect(sniffImageType(b)).toBeNull();
	});

	it('rejects GIF and other non-allowed formats', () => {
		expect(sniffImageType(bytes([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))).toBeNull();
	});

	it('rejects too-short input', () => {
		expect(sniffImageType(bytes([0xff, 0xd8, 0xff], 4))).toBeNull();
	});

	it('accepts an ArrayBuffer', () => {
		expect(sniffImageType(bytes([0xff, 0xd8, 0xff, 0x00]).buffer as ArrayBuffer)).toBe(
			'image/jpeg'
		);
	});
});
