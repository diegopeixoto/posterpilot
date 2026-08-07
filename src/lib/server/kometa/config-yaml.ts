import { isMap, isNode, isScalar, isSeq, parseDocument, type Document, type Node } from 'yaml';

/** Hard ceilings for Kometa config inspection. Overrides may only lower them in tests. */
const KOMETA_CONFIG_YAML_LIMITS = Object.freeze({
	maxBytes: 8 * 1024 * 1024,
	maxNodes: 250_000,
	maxDepth: 32,
	maxScalarBytes: 64 * 1024
});

export type KometaConfigYamlLimitName = keyof typeof KOMETA_CONFIG_YAML_LIMITS;
export type KometaConfigYamlLimitOverrides = Partial<Record<KometaConfigYamlLimitName, number>>;
export type KometaConfigYamlErrorCode =
	| 'config_yaml_invalid'
	| 'config_source_too_large'
	| 'config_node_limit_exceeded'
	| 'config_depth_limit_exceeded'
	| 'config_scalar_limit_exceeded';

export type BoundedKometaConfigDocument =
	| { ok: true; document: Document<Node> }
	| { ok: false; code: KometaConfigYamlErrorCode };

function utf8Bytes(value: string): number {
	return new TextEncoder().encode(value).byteLength;
}

function effectiveLimits(
	overrides: KometaConfigYamlLimitOverrides
): typeof KOMETA_CONFIG_YAML_LIMITS {
	const limits: Record<KometaConfigYamlLimitName, number> = { ...KOMETA_CONFIG_YAML_LIMITS };
	for (const name of Object.keys(KOMETA_CONFIG_YAML_LIMITS) as KometaConfigYamlLimitName[]) {
		const value = overrides[name];
		if (value === undefined) continue;
		if (!Number.isSafeInteger(value) || value < 1 || value > KOMETA_CONFIG_YAML_LIMITS[name]) {
			throw new RangeError(`Invalid lowered Kometa config limit: ${name}`);
		}
		limits[name] = value;
	}
	return limits as typeof KOMETA_CONFIG_YAML_LIMITS;
}

/** Parse config YAML without alias expansion, then bound its complete AST iteratively. */
export function parseBoundedKometaConfig(
	raw: string,
	overrides: KometaConfigYamlLimitOverrides = {}
): BoundedKometaConfigDocument {
	const limits = effectiveLimits(overrides);
	if (utf8Bytes(raw) > limits.maxBytes) return { ok: false, code: 'config_source_too_large' };

	let parsed: ReturnType<typeof parseDocument>;
	try {
		parsed = parseDocument(raw, { uniqueKeys: true });
	} catch {
		return { ok: false, code: 'config_yaml_invalid' };
	}
	if (parsed.errors.length > 0) return { ok: false, code: 'config_yaml_invalid' };
	const document = parsed as unknown as Document<Node>;
	if (!document.contents) return { ok: true, document };

	let nodes = 0;
	const stack: Array<{ node: Node; depth: number }> = [{ node: document.contents, depth: 1 }];
	while (stack.length > 0) {
		const current = stack.pop()!;
		nodes += 1;
		if (nodes > limits.maxNodes) return { ok: false, code: 'config_node_limit_exceeded' };
		if (current.depth > limits.maxDepth) {
			return { ok: false, code: 'config_depth_limit_exceeded' };
		}
		if (isScalar(current.node)) {
			if (utf8Bytes(String(current.node.value ?? '')) > limits.maxScalarBytes) {
				return { ok: false, code: 'config_scalar_limit_exceeded' };
			}
			continue;
		}
		if (isMap(current.node)) {
			for (const pair of current.node.items) {
				if (isNode(pair.key)) stack.push({ node: pair.key, depth: current.depth + 1 });
				if (isNode(pair.value)) stack.push({ node: pair.value, depth: current.depth + 1 });
			}
			continue;
		}
		if (isSeq(current.node)) {
			for (const item of current.node.items) {
				if (isNode(item)) stack.push({ node: item, depth: current.depth + 1 });
			}
		}
	}

	return { ok: true, document };
}
