/** Pure version comparison — kept free of $env/HTTP imports so it unit-tests cleanly. */

/** True when dotted version `a` is strictly newer than `b` (leading `v` ignored). */
export function isNewerVersion(a: string, b: string): boolean {
	const parse = (s: string) =>
		s
			.trim()
			.replace(/^v/i, '')
			.split('.')
			.map((n) => Number.parseInt(n, 10) || 0);
	const pa = parse(a);
	const pb = parse(b);
	for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
		const x = pa[i] ?? 0;
		const y = pb[i] ?? 0;
		if (x !== y) return x > y;
	}
	return false;
}
