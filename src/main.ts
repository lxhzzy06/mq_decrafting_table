import {
	Block,
	Container,
	Dimension,
	Entity,
	EntityInventoryComponent,
	ItemStack,
	LootTable,
	Player,
	PlayerCursorInventoryComponent,
	system,
	world,
} from '@minecraft/server';
import { DECRAFT_INDEX, DecraftEntry } from './generated/decrafting-index';
import { ensureUiMarker, isUiMarker, INPUT_SLOT, OUTPUT_SLOT, TABLE_TYPE } from './ui-marker';

declare module '@minecraft/server' {
	interface Player {
		Cursor: PlayerCursorInventoryComponent;
		Token: number | undefined;
		Decraft: (item: ItemStack | undefined) => ItemStack | undefined;
		Init: () => void;
	}
}

const CURSOR_COMPONENT = 'cursor_inventory';
const INVENTORY_COMPONENT = 'inventory';
const ITEM_PREFIX = 'mq_decrafting_item:';
/// 模板物品, 没有对应战利品表, 直接吞掉
const JUNK_ITEM = ITEM_PREFIX + 'mq';
/// 差额占位物品: 输入不够一整批时摆在输出格上, 数量 = 还差几个。
/// 同样走"直接吞掉"分支 —— 玩家就算绕开 slot 锁把它弄出来, 也留不下痕迹。
const NEED_ITEM = ITEM_PREFIX + 'need';
const LOOT_FOLDER = 'decrafting/';
/// 事件驱动是主路径, 兜底扫描覆盖不经背包事件入口进来的中介物(其他插件写入、方块容器转移等)
const SWEEP_TICKS = 20;

/// 保留旧实体定义及迁移入口，新的分解台使用原生方块库存。
const CONTAINER_TYPE = 'mqdt:decrafting_container';
const MAX_STACK = 64;
const CONTAINER_TICKS = 4;
/// 分解台可能出现的维度。getEntities 不带位置条件时只返回已加载区块的实体,
/// 正好就是"活跃"的那些 —— 不用自己按玩家位置筛, 也不用维护登记表
const DIMENSIONS = ['overworld', 'nether', 'the_end'] as const;

const tableCache = new Map<string, LootTable | undefined>();

function lootTableFor(id: string): LootTable | undefined {
	const path = LOOT_FOLDER + id;
	if (!tableCache.has(path)) {
		tableCache.set(path, world.getLootTableManager().getLootTable(path));
	}
	return tableCache.get(path);
}

function inventoryOf(player: Player): Container | undefined {
	return (player.getComponent(INVENTORY_COMPONENT) as EntityInventoryComponent | undefined)?.container;
}

/** 一份材料进背包, 装不下的落地, 不让玩家白跑一趟 */
function grant(player: Player, stacks: ItemStack[]) {
	for (const stack of stacks) {
		const overflow = player.addItem(stack);
		if (overflow) player.dimension.spawnItem(overflow, player.location);
	}
}

Player.prototype.Decraft = function (item: ItemStack | undefined) {
	if (isUiMarker(item)) return undefined;
	if (!item?.typeId.startsWith(ITEM_PREFIX)) return item;
	if (item.typeId === JUNK_ITEM || item.typeId === NEED_ITEM) return undefined;

	const table = lootTableFor(item.typeId.slice(ITEM_PREFIX.length));
	if (!table) {
		this.sendMessage('无法分解物品: ' + item.typeId);
		return item;
	}

	// 一个中介物对应一整套材料, 所以按单位逐个掷表; 数量只在中途失败时保留未处理的部分。
	//
	// 余量必须用局部变量记: 直接 item.amount-- 会在处理最后一份时把它写成 0,
	// 而 amount 的合法范围是 1..255, 引擎会抛 PropertyOutOfBoundsError 并中断整个分解
	// (材料也没发出去, 玩家手里的中介物原封不动)。
	let remaining = item.amount;
	while (remaining > 0) {
		const materials = world.getLootTableManager().generateLootFromTable(table);
		if (!materials?.length) {
			this.sendMessage('无法分解物品: ' + item.typeId);
			// 写回未处理的部分, 且必然 >= 1
			item.amount = remaining;
			return item;
		}
		remaining--;
		grant(this, materials);
	}
	return undefined;
};

Player.prototype.Init = function () {
	// 幂等守卫: 玩家可能被多个初始化入口重复调用, 必须先注销旧的定时任务再注册
	if (this.Token !== undefined) {
		system.clearRun(this.Token);
		this.Token = undefined;
	}
	if (this.getDynamicProperty('has_cursor')) {
		this.Cursor = this.getComponent(CURSOR_COMPONENT) as PlayerCursorInventoryComponent;
		if (this.Cursor?.isValid) {
			this.Token = system.runInterval(CursorFn.bind(this), 1);
		} else {
			this.setDynamicProperty('has_cursor', false);
			this.sendMessage('无法获取光标组件, 将使用容器模式');
		}
	}
	const container = inventoryOf(this);
	// 背包里可能已经躺着上一个会话合成的中介物
	if (container) decraftContainer(this, container);
};

/** 只处理中介物所在的格子, 其余一概不写, 避免每轮扫描产生大量容器写入 */
function decraftContainer(player: Player, container: Container, slot?: number) {
	const last = slot === undefined ? container.size : Math.min(slot + 1, container.size);
	for (let i = slot ?? 0; i < last; i++) {
		const item = container.getItem(i);
		if (isUiMarker(item) || item?.typeId.startsWith(ITEM_PREFIX)) container.setItem(i, player.Decraft(item));
	}
}

function CursorFn(this: Player) {
	if (this.Decraft(this.Cursor.item) === undefined) this.Cursor.clear();
}

world.afterEvents.playerSpawn.subscribe(({ initialSpawn, player }) => {
	if (initialSpawn) player.Init();
});

world.afterEvents.playerInventoryItemChange.subscribe(({ player, slot }) => {
	const container = inventoryOf(player);
	if (!container || slot >= container.size) return;
	if (isUiMarker(container.getItem(slot))) {
		container.setItem(slot, undefined);
		return;
	}
	if (player.getDynamicProperty('has_cursor')) return;
	decraftContainer(player, container, slot);
});

world.beforeEvents.playerLeave.subscribe(({ player }) => {
	if (player.Token !== undefined) {
		system.clearRun(player.Token);
		player.Token = undefined;
	}
});

let sweepRegistered = false;

// ---------------------------------------------------------------------------
// 原生分解台库存与旧实体迁移，UI 只显示输入/输出各一格
// ---------------------------------------------------------------------------

// 原生库存通过方块 tick 恢复；旧实体按已加载维度扫描，离开区块再回来也能迁移。

/** 容器实体的中心坐标: 方块占 [x, x+1], 实体居中 */
function center(block: Block) {
	const loc = block.location;
	return { x: loc.x + 0.5, y: loc.y, z: loc.z + 0.5 };
}

/** 找到该方块位置上的容器实体 */
function containersAt(block: Block): Entity[] {
	return block.dimension.getEntities({
		location: center(block),
		maxDistance: 0.8,
		type: CONTAINER_TYPE,
	});
}

/** 原生库存由引擎持久化，脚本只维护隐藏标记。 */
function ensureContainer(block: Block): Container | undefined {
	const container = block.getComponent('minecraft:inventory')?.container;
	if (!container) return;
	ensureUiMarker(container, item => block.dimension.spawnItem(item, {
		x: block.x + 0.5, y: block.y + 0.5, z: block.z + 0.5,
	}));
	return container;
}

/** Upgrade a loaded legacy entity without replacing either occupied native business cell. */
function migrateContainer(entity: Entity, block: Block, target: Container) {
	const source = (entity.getComponent('inventory') as EntityInventoryComponent | undefined)?.container;
	if (!source) { entity.remove(); return; }
	for (let slot = 0; slot < source.size; slot++) {
		const item = source.getItem(slot);
		if (!item) continue;
		if (item.typeId === NEED_ITEM || isUiMarker(item)) {
			source.setItem(slot, undefined);
			continue;
		}
		const to = slot === 0 ? INPUT_SLOT : OUTPUT_SLOT;
		if (slot < 2 && !target.getItem(to)) source.moveItem(slot, to, target);
		else {
			block.dimension.spawnItem(item, { x: block.x + 0.5, y: block.y + 0.5, z: block.z + 0.5 });
			source.setItem(slot, undefined);
		}
	}
	entity.remove();
}

/** 拆台子时把里面的东西全倒出来, 再删掉实体 */
function dropAndKill(block: Block) {
	const loc = block.location;
	const drop = { x: loc.x + 0.5, y: loc.y + 0.5, z: loc.z + 0.5 };
	for (const entity of containersAt(block)) {
		const container = (entity.getComponent('inventory') as EntityInventoryComponent | undefined)
			?.container;
		if (container) {
			for (let slot = 0; slot < container.size; slot++) {
				const item = container.getItem(slot);
				if (item && item.typeId !== NEED_ITEM && !isUiMarker(item)) entity.dimension.spawnItem(item, drop);
				container.setItem(slot, undefined);
			}
		}
		entity.remove();
	}
}

/**
 * 输入不够一整批时, 在输出格摆一个"还差几个"的占位。
 *
 * 界面上唯一会自动刷新的数字就是格子里的物品数量, 所以想让玩家不 hover 也能看到差额,
 * 只有把差额做成物品数量这一条路 —— 这就是 NEED_ITEM 存在的全部理由。
 * 它被 Decraft 直接吞掉, 玩家就算把它拿走也只会消失, 白嫖路径是堵死的。
 *
 * 刻意不上 lockMode: ItemLockMode.slot 在挂在实体上的容器里拦不住拖拽(实机验证),
 * 却仍会触发原版的"物品无法移动"通知, 纯副作用。
 *
 * 输入补够 -> 被真正的中介物顶掉; 输入清空 -> 占位跟着清掉(在调用方处理)。
 */
function showShortfall(container: Container, input: ItemStack, entry: DecraftEntry, output: ItemStack | undefined, outputSlot: number) {
	const missing = entry.batch - input.amount;
	// 已产出的中介物不能被差额提示覆盖；满输出格也不应生成负数量提示。
	if (missing <= 0 || (output && output.typeId !== NEED_ITEM)) return;
	// 差额没变就别重写, 免得每 4 tick 都产生一次容器写入
	if (output?.typeId === NEED_ITEM && output.amount === missing) return;

	const placeholder = new ItemStack(NEED_ITEM, missing);
	placeholder.nameTag = `还差 ${missing} 个 ${displayNameOf(input)} (每份需 ${entry.batch} 个)`;
	container.setItem(outputSlot, placeholder);
}

/** 玩家看得懂的名字: 自定义名优先, 否则把命名空间剥掉当兜底 */
function displayNameOf(item: ItemStack): string {
	return item.nameTag || item.typeId.replace(/^[a-z_]+:/, '').replace(/_/g, ' ');
}

/**
 * 把整批输入换成中介物。真正的还原在背包侧: 玩家把中介物拿走才掷战利品表变材料。
 *
 * 输出因此永远只有一个物品, 不存在"多种材料塞不满两格"的问题 —— 这本来就是中介物的
 * 用意: 它是待分解的信物, 一份中介物对应一整套材料。
 *
 * 一份中介物 = 一整份材料(背包侧按 amount 逐个掷表), 所以份数必须严格等于
 * floor(输入 / batch), 多给一份就等于凭空造出一套材料。
 */
function tickContainer(container: Container, inputSlot = INPUT_SLOT, outputSlot = OUTPUT_SLOT) {
	const input = container.getItem(inputSlot);
	const output = container.getItem(outputSlot);

	// 输入没了: 占位也跟着撤掉, 别让"还差 3 个"孤零零留在空输入旁边
	if (!input) {
		if (output?.typeId === NEED_ITEM) container.setItem(outputSlot, undefined);
		return;
	}

	const entry: DecraftEntry | undefined = DECRAFT_INDEX[input.typeId];
	if (!entry) return;
	if ((input.getComponent('minecraft:durability')?.damage ?? 0) > 0
		|| (input.getComponent('minecraft:enchantable')?.getEnchantments().length ?? 0) > 0) {
		if (!output || output.typeId === NEED_ITEM) {
			const message = '损坏或附魔装备不可分解';
			if (output?.nameTag !== message) {
				const hint = new ItemStack(NEED_ITEM, 1);
				hint.nameTag = message;
				container.setItem(outputSlot, hint);
			}
		}
		return;
	}

	const intermediate = ITEM_PREFIX + entry.table;
	// 输出格躺着别的东西(比如玩家塞进去的杂物)就先原样留着, 等他取走, 别覆盖掉
	if (output && output.typeId !== intermediate && output.typeId !== NEED_ITEM) return;

	// 能出几份受两头卡: 输入够几整批, 以及输出格还剩多少空间
	const batches = Math.min(
		Math.floor(input.amount / entry.batch),
		MAX_STACK - (output?.typeId === intermediate ? output.amount : 0)
	);
	if (batches <= 0) {
		showShortfall(container, input, entry, output, outputSlot);
		return;
	}

	const kept = output?.typeId === intermediate ? output.amount : 0;
	container.setItem(outputSlot, new ItemStack(intermediate, kept + batches));

	// 扣掉已换算的部分。剩下要么 >= 1, 要么清空整格, 不会写出非法的 0
	const leftover = input.amount - batches * entry.batch;
	if (leftover > 0) {
		input.amount = leftover;
		container.setItem(inputSlot, input);
	} else {
		container.setItem(inputSlot, undefined);
	}
}

system.beforeEvents.startup.subscribe(({ blockComponentRegistry }) => {
	blockComponentRegistry.registerCustomComponent('mqdt:container_lifecycle', {
		onPlace: ({ block }) => {
			ensureContainer(block);
		},
		onBreak: ({ block }) => {
			dropAndKill(block);
		},
		onPlayerInteract: ({ block }) => {
			ensureContainer(block);
		},
		onTick: ({ block }) => {
			try {
				const container = ensureContainer(block);
				if (container) tickContainer(container);
			} catch (error) { console.warn(`[MQDT] 方块库存处理失败: ${error}`); }
		},
	});
});

system.runInterval(() => {
	for (const id of DIMENSIONS) {
		const dimension = world.getDimension(id);
		for (const entity of dimension.getEntities({ type: CONTAINER_TYPE })) {
			if (!entity.isValid) continue;
			try {
				const loc = entity.location;
				const block = dimension.getBlock({ x: Math.floor(loc.x), y: Math.floor(loc.y), z: Math.floor(loc.z) });
				if (block?.typeId === TABLE_TYPE) {
					const target = ensureContainer(block);
					if (target) { migrateContainer(entity, block, target); continue; }
				}
				const source = (entity.getComponent('inventory') as EntityInventoryComponent | undefined)?.container;
				if (source) tickContainer(source, 0, 1);
			} catch (e) {
				// 打出来才能在 content log 里查; 不把容器踢出去, 免得一次偶发错误就让它永久失效
				console.warn(`[MQDT] 分解台 tick 失败: ${e}`);
			}
		}
	}
}, CONTAINER_TICKS);

function cleanMarkerEntity(entity: Entity) {
	if (entity.isValid && entity.typeId === 'minecraft:item'
		&& isUiMarker(entity.getComponent('minecraft:item')?.itemStack)) entity.remove();
}
for (const signal of [world.afterEvents.entitySpawn, world.afterEvents.entityLoad]) {
	signal.subscribe(({ entity }) => {
		cleanMarkerEntity(entity);
		system.run(() => cleanMarkerEntity(entity));
	});
}

world.afterEvents.worldLoad.subscribe(() => {
	for (const player of world.getAllPlayers()) player.Init();
	if (sweepRegistered) return;
	sweepRegistered = true;
	system.runInterval(() => {
		for (const player of world.getAllPlayers()) {
			const container = inventoryOf(player);
			if (container) decraftContainer(player, container);
			const cursor = player.getComponent(CURSOR_COMPONENT) as PlayerCursorInventoryComponent | undefined;
			if (cursor && isUiMarker(cursor.item)) cursor.clear();
			for (const entity of player.dimension.getEntities({ type: 'minecraft:item',
				location: player.location, maxDistance: 16 })) cleanMarkerEntity(entity);
		}
	}, SWEEP_TICKS);
});

system.afterEvents.scriptEventReceive.subscribe(
	({ id, sourceEntity: player, message }) => {
		if (!(player instanceof Player)) return;
		if (id !== 'mqdt:cursor') return;
		switch (message) {
			case 'enable':
				player.setDynamicProperty('has_cursor', true);
				player.Init();
				if (player.Cursor?.isValid) player.sendMessage('光标模式已启用');
				break;
			case 'disable':
				player.setDynamicProperty('has_cursor', false);
				player.Init();
				player.sendMessage('光标模式已禁用');
				break;
		}
	},
	{ namespaces: ['mqdt'] }
);

// ---------------------------------------------------------------------------
// 分解台的合成: 铁砧从至少一格高处砸到工作台上, 劈道闪电变成分解台
// ---------------------------------------------------------------------------

const FALLING_BLOCK = 'minecraft:falling_block';
/// 铁砧的三个磨损档都算
const ANVILS = ['minecraft:anvil', 'minecraft:chipped_anvil', 'minecraft:damaged_anvil'];
/// 砸一次降一档, 已经是最坏的 damaged_anvil 时才真的消失。
/// 一个铁砧能用三次, 也跟原版铁砧"用一次裂一点"的磨损机制对得上。
const ANVIL_WEAR: Record<string, string> = {
	'minecraft:anvil': 'minecraft:chipped_anvil',
	'minecraft:chipped_anvil': 'minecraft:damaged_anvil',
};
/// 被下落方块砸中、等着确认落成铁砧的工作台。key = "维度:x,y,z"
const struck = new Map<string, { dimension: Dimension; x: number; y: number; z: number; tick: number }>();
/// 等不到铁砧就别一直留着, 免得这张表越攒越大
const STRIKE_TIMEOUT = 40;

system.runInterval(() => {
	for (const id of DIMENSIONS) {
		const dimension = world.getDimension(id);

		// 一、下落方块正压在工作台上 -> 先记一笔
		// 铁砧是垂直下落的, x/z 不会偏, 所以实体所在的那一列就是落点
		for (const entity of dimension.getEntities({ type: FALLING_BLOCK })) {
			const loc = entity.location;
			const x = Math.floor(loc.x);
			const z = Math.floor(loc.z);
			const y = Math.floor(loc.y) - 1;
			if (dimension.getBlock({ x, y, z })?.typeId !== 'minecraft:crafting_table') continue;
			struck.set(`${id}:${x},${y},${z}`, { dimension, x, y, z, tick: system.currentTick });
		}

		// 二、落点上方真出现铁砧了才算数 —— 这一步把沙子、沙砾这类下落方块挡掉
		for (const [key, hit] of struck) {
			if (!key.startsWith(`${id}:`)) continue;
			if (system.currentTick - hit.tick > STRIKE_TIMEOUT) {
				struck.delete(key);
				continue;
			}
			const table = dimension.getBlock({ x: hit.x, y: hit.y, z: hit.z });
			if (table?.typeId !== 'minecraft:crafting_table') {
				struck.delete(key);
				continue;
			}
			const anvil = dimension.getBlock({ x: hit.x, y: hit.y + 1, z: hit.z });
			if (!anvil || !ANVILS.includes(anvil.typeId)) continue;
			struck.delete(key);
			convertTable(table, anvil);
		}
	}
}, 2);

/** 铁砧落到工作台上: 铁砧降一档, 工作台变分解台, 劈道闪电 */
function convertTable(table: Block, anvil: Block) {
	// 降到下一档; 已经是最坏的 damaged_anvil(不在表里)就直接碎掉
	anvil.setType(ANVIL_WEAR[anvil.typeId] ?? 'minecraft:air');
	const loc = table.location;
	table.dimension.spawnEntity('minecraft:lightning_bolt', {
		x: loc.x + 0.5,
		y: loc.y + 1,
		z: loc.z + 0.5,
	});
	table.setType('mq_decrafting_table:table');
	// setType 不触发 onPlace，转化后主动初始化原生库存的隐藏标记。
	ensureContainer(table);
}
