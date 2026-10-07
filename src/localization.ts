import { ItemStack, RawMessage } from '@minecraft/server';

/** Keep translation tokens in shared inventories so every client uses its own language. */
export function itemName(item: ItemStack): RawMessage {
	if (item.nameTag) {
		const name = Array.from(item.nameTag);
		return { text: name.length > 40 ? name.slice(0, 39).join('') + '…' : item.nameTag };
	}
	return { translate: item.localizationKey };
}

export function shortfallLore(input: ItemStack, missing: number, batch: number): RawMessage[] {
	return [
		{ translate: 'mqdt.hint.missing', with: [String(missing)] },
		{ translate: 'mqdt.hint.item', with: { rawtext: [itemName(input)] } },
		{ translate: 'mqdt.hint.batch', with: [String(batch)] },
	];
}

export const rejectedLore: RawMessage[] = [
	{ translate: 'mqdt.hint.protected' },
	{ translate: 'mqdt.hint.cannot_decraft' },
];

export function matchesHint(item: ItemStack | undefined, amount: number, lore: RawMessage[]): boolean {
	return !!item && !item.nameTag && item.amount === amount
		&& JSON.stringify(item.getRawLore()) === JSON.stringify(lore);
}
