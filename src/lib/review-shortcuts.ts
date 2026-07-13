export type ReviewShortcut =
	| 'previous'
	| 'next'
	| 'stage_suggestion'
	| 'ignore'
	| 'compare'
	| 'apply_next';

const SHORTCUTS: Record<string, ReviewShortcut> = {
	k: 'previous',
	j: 'next',
	s: 'stage_suggestion',
	i: 'ignore',
	c: 'compare',
	a: 'apply_next'
};

export function isEditableReviewTarget(
	target: { tagName?: string; isContentEditable?: boolean } | null | undefined
): boolean {
	if (!target) return false;
	const tag = target.tagName?.toLowerCase();
	return Boolean(
		target.isContentEditable || tag === 'input' || tag === 'textarea' || tag === 'select'
	);
}

export function reviewShortcutForKey(input: {
	key: string;
	altKey?: boolean;
	ctrlKey?: boolean;
	metaKey?: boolean;
	repeat?: boolean;
}): ReviewShortcut | null {
	if (input.altKey || input.ctrlKey || input.metaKey || input.repeat) return null;
	return SHORTCUTS[input.key.toLocaleLowerCase('en-US')] ?? null;
}

export function reviewShortcutsBlocked(input: {
	busy?: boolean;
	reviewBusy?: boolean;
	finishingAdvance?: boolean;
	confirmationOpen?: boolean;
	undoBusy?: boolean;
	undoOpen?: boolean;
	modalOpen?: boolean;
}): boolean {
	return Object.values(input).some(Boolean);
}
