import { world, system, ItemStack, Player } from '@minecraft/server';
import { MARKER_ID, MARKER_MAX, LAYOUT_KEY, MARKED_BLOCK, OUTPUT_SLOT,
	isMarker, ensureMarker } from './marker.js';

function makeMarker() {
	const item = new ItemStack(MARKER_ID, 1);
	const durability = item.getComponent('minecraft:durability');
	if (!durability || durability.maxDurability !== MARKER_MAX) throw new Error('标记物耐久组件不匹配');
	durability.damage = MARKER_MAX - LAYOUT_KEY;
	return item;
}

function maintainMarker(block) {
	if (block.typeId !== MARKED_BLOCK) return;
	try {
		const container = block.getComponent('minecraft:inventory')?.container;
		if (!container) return;
		if (ensureMarker(container, makeMarker, item => block.dimension.spawnItem(item, {
			x: block.x + 0.5, y: block.y + 1, z: block.z + 0.5,
		}))) console.warn(`[MQDT MARKER] ${block.x},${block.y},${block.z} repaired; layout=${LAYOUT_KEY}`);
	} catch (error) {
		console.warn(`[MQDT MARKER] ${error}`);
	}
}

// Container locks do not prevent taking a marker. Reclaim by our exact item ID instead.
function cleanPlayer(player) {
	const container = player.getComponent('minecraft:inventory')?.container;
	if (container) for (let slot = 0; slot < container.size; slot++) {
		if (isMarker(container.getItem(slot))) container.setItem(slot, undefined);
	}
	const cursor = player.getComponent('minecraft:cursor_inventory');
	if (cursor && isMarker(cursor.item)) cursor.clear();
}

function cleanDroppedMarker(entity) {
	if (entity.isValid && entity.typeId === 'minecraft:item'
		&& isMarker(entity.getComponent('minecraft:item')?.itemStack)) entity.remove();
}

/**
 * block_entity 实验
 *
 * 分两个方块:
 *   mqdt_exp:box     —— 只有 minecraft:tick, 验证 onTick 机制
 *   mqdt_exp:be_box  —— 加 minecraft:block_entity, 验证方块自带库存 (可能解析失败)
 *
 * 验证点:
 *   1. onTick 是否真实触发, event.block 可用
 *   2. block.getComponent('minecraft:inventory') 能否拿到 container
 *   3. container.size 是否等于 slot_count
 */

const tickSeen = new Map(); // typeId -> 次数

system.beforeEvents.startup.subscribe(({ blockComponentRegistry }) => {
	blockComponentRegistry.registerCustomComponent('mqdt_exp:marker', {
		onPlace: ({ block }) => maintainMarker(block),
		onPlayerInteract: ({ block, player }) => {
			cleanPlayer(player);
			maintainMarker(block);
		},
		onTick: ({ block }) => maintainMarker(block),
	});
	blockComponentRegistry.registerCustomComponent('mqdt_exp:probe', {
		onTick: ({ block }) => {
			const key = `${block.typeId}@${block.x},${block.y},${block.z}`;
			const n = (tickSeen.get(key) ?? 0) + 1;
			tickSeen.set(key, n);

			// 前 2 次详细, 之后每 15 次打一次心跳
			const verbose = n <= 2;
			if (!verbose && n % 15 !== 0) return;

			console.warn(`[TICK#${n}] ${key}`);

			let comps = [];
			try {
				comps = block.getComponents().map((c) => c.typeId);
			} catch (e) {
				console.warn(`  组件枚举失败: ${e}`);
			}
			if (verbose) console.warn(`  组件: ${comps.join(', ')}`);

			const inv = block.getComponent('minecraft:inventory');
			if (!inv) {
				console.warn(`  ✗ 无 minecraft:inventory 组件`);
				return;
			}
			console.warn(`  ✓ inventory 组件存在`);

			const c = inv.container;
			if (!c) {
				console.warn(`  ✗ container 为空`);
				return;
			}
			console.warn(`  ✓ container.size = ${c.size}`);

			// tick 只读取: 放置、重载世界时不能把玩家物品覆盖成测试火把。
			console.warn(`  slot0=${c.getItem(0)?.typeId ?? '空'} slot1=${c.getItem(1)?.typeId ?? '空'}`);
		},
	});
});

world.afterEvents.playerInventoryItemChange.subscribe(({ player }) => cleanPlayer(player));
for (const signal of [world.afterEvents.entitySpawn, world.afterEvents.entityLoad]) {
	signal.subscribe(({ entity }) => {
		cleanDroppedMarker(entity);
		// Some item entities expose their stack one tick after creation.
		system.run(() => cleanDroppedMarker(entity));
	});
}
system.runInterval(() => {
	for (const player of world.getAllPlayers()) {
		cleanPlayer(player);
		// Also collect marker drops already in loaded chunks before the script starts.
		for (const entity of player.dimension.getEntities({ type: 'minecraft:item',
			location: player.location, maxDistance: 16 })) cleanDroppedMarker(entity);
	}
}, 20);

// /scriptevent mqdt:probe is read-only; explicit probe_write writes only an EMPTY output cell.
system.afterEvents.scriptEventReceive.subscribe((ev) => {
	if (ev.id !== 'mqdt:probe' && ev.id !== 'mqdt:probe_write') return;
	const p = ev.sourceEntity;
	if (!(p instanceof Player)) return;

	p.sendMessage('§e=== 探测 ===');
	const hit = p.getBlockFromViewDirection({ maxDistance: 8 });
	if (!hit?.block) {
		p.sendMessage('§c准星没指到方块');
		return;
	}
	const b = hit.block;
	p.sendMessage(`方块: ${b.typeId} @${b.x},${b.y},${b.z}`);
	try {
		p.sendMessage(`组件: ${b.getComponents().map((c) => c.typeId).join(', ')}`);
	} catch (e) {
		p.sendMessage(`§c组件枚举失败: ${e}`);
	}

	const inv = b.getComponent('minecraft:inventory');
	if (inv?.container) {
		const c = inv.container;
		p.sendMessage(`§a✓ 容器 size=${c.size}`);
		for (let slot = 0; slot < c.size; slot++) {
			const item = c.getItem(slot);
			const durability = item?.getComponent('minecraft:durability');
			p.sendMessage(`§a  slot${slot}=${item?.typeId ?? '空'}${durability
				? ` max=${durability.maxDurability} current=${durability.maxDurability - durability.damage}` : ''}`);
		}
		if (ev.id === 'mqdt:probe_write') {
			const slot = b.typeId === MARKED_BLOCK ? OUTPUT_SLOT : 1;
			if (!['mqdt_exp:be_box', MARKED_BLOCK, 'mqdt_exp:plain_box'].includes(b.typeId)) {
				p.sendMessage('§c仅允许写入实验方块');
			} else if (c.getItem(slot)) p.sendMessage('§c输出格已有物品，未写入');
			else {
				c.setItem(slot, new ItemStack('minecraft:diamond', 7));
				p.sendMessage(`§a✓ 写入 slot${slot}: 7 个钻石`);
			}
		}
	} else {
		p.sendMessage(`§c✗ 没有可用容器 (inv=${!!inv}, container=${!!inv?.container})`);
	}
	p.sendMessage('§e=== 结束 ===');
});
