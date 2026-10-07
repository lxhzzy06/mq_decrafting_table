import { Container, ItemStack } from '@minecraft/server';

// Separate from the experiment (32747) and bedrock-core (32749).
export const UI_MARKER_ID = 'mqdt:ui_marker';
export const UI_MARKER_MAX = 32743;
export const UI_LAYOUT_KEY = 1193;
export const TABLE_TYPE = 'mq_decrafting_table:table';
export const MARKER_SLOT = 0;
export const INPUT_SLOT = 1;
export const OUTPUT_SLOT = 2;

export function isUiMarker(item: ItemStack | undefined) {
	return item?.typeId === UI_MARKER_ID;
}

export function ensureUiMarker(container: Container, spill: (item: ItemStack) => void) {
	if (container.size !== 3) throw new Error(`分解台库存应有 3 格，实际 ${container.size}`);
	const current = container.getItem(MARKER_SLOT);
	const durability = current?.getComponent('minecraft:durability');
	if (isUiMarker(current) && current?.amount === 1 && durability?.maxDurability === UI_MARKER_MAX
		&& durability.damage === UI_MARKER_MAX - UI_LAYOUT_KEY) return;
	const marker = new ItemStack(UI_MARKER_ID, 1);
	const markerDurability = marker.getComponent('minecraft:durability');
	if (!markerDurability || markerDurability.maxDurability !== UI_MARKER_MAX) throw new Error('UI 标记定义不匹配');
	markerDurability.damage = UI_MARKER_MAX - UI_LAYOUT_KEY;
	if (current && !isUiMarker(current)) {
		const empty = [INPUT_SLOT, OUTPUT_SLOT].find(slot => !container.getItem(slot));
		if (empty !== undefined) container.moveItem(MARKER_SLOT, empty, container);
		else {
			spill(current);
			container.setItem(MARKER_SLOT, undefined);
		}
	}
	container.setItem(MARKER_SLOT, marker);
}
