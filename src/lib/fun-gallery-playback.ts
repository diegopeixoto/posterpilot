export function galleryAutoAdvanceAllowed(input: {
	active: boolean;
	paused: boolean;
	reducedMotion: boolean;
	reducedMotionPlaybackEnabled: boolean;
	slideCount: number;
}): boolean {
	return (
		input.active &&
		!input.paused &&
		(!input.reducedMotion || input.reducedMotionPlaybackEnabled) &&
		input.slideCount >= 2
	);
}
