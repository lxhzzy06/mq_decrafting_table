// UI expressions use literal copies of these numbers; check-experiment.mjs checks both sides.
export const MARKER_ID = 'mqdt_exp:ui_marker';
export const MARKER_MAX = 32747;
export const LAYOUT_KEY = 1193;
export const MARKER_SLOT = 0;
export const INPUT_SLOT = 1;
export const OUTPUT_SLOT = 2;
export const MARKED_BLOCK = 'mqdt_exp:be_marker_box';

export function isMarker(item) {
	return item?.typeId === MARKER_ID;
}

export function isValidMarker(item) {
	const durability = item?.getComponent('minecraft:durability');
	return isMarker(item) && item.amount === 1 && durability?.maxDurability === MARKER_MAX
		&& durability.damage === MARKER_MAX - LAYOUT_KEY;
}

/** Recover only the reserved cell. Never overwrite a business cell or discard a real item. */
export function ensureMarker(container, createMarker, spill) {
	if (container.size !== 3) throw new Error(`Expected 3 slots, got ${container.size}`);
	const current = container.getItem(MARKER_SLOT);
	if (isValidMarker(current)) return false;
	const marker = createMarker();
	if (current && !isMarker(current)) {
		const empty = [INPUT_SLOT, OUTPUT_SLOT].find(slot => !container.getItem(slot));
		if (empty !== undefined) container.moveItem(MARKER_SLOT, empty, container);
		else {
			// If spawning fails, leave the real item in place and retry next tick.
			spill(current);
			container.setItem(MARKER_SLOT, undefined);
		}
	}
	container.setItem(MARKER_SLOT, marker);
	return true;
}
