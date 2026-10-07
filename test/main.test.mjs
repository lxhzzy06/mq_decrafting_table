import assert from 'node:assert/strict';
import test from 'node:test';
import { loadAddon } from './harness.mjs';

async function boot() {
	const { cleanup } = await loadAddon();
	return { S: globalThis.__MQDT__, cleanup };
}

/** 玩家进服: 由 playerSpawn 触发初始化 */
function join(S, player) {
	S.handlers.playerSpawn({ initialSpawn: true, player });
	return player;
}

/** 往背包塞中介物并触发一次引擎的背包变化事件 */
function putAndNotify(S, player, slot, itemStack) {
	player.container.setItem(slot, itemStack);
	S.fireInventoryChange(player, slot);
}

test('背包事件: 中介物换成材料并直接进背包', async () => {
	const { S } = await boot();
	const player = join(S, S.createPlayer());
	S.setLootTable('decrafting/oak_planks', () => [S.createItem('minecraft:oak_log', 1)]);

	putAndNotify(S, player, 3, S.createItem('mq_decrafting_item:oak_planks', 1));

	assert.equal(player.container.getItem(3), undefined);
	assert.deepEqual(player.granted.map((item) => item.typeId), ['minecraft:oak_log']);
	assert.equal(player.spawnedItems.length, 0, '放得下就不该落地');
	assert.equal(S.tableCalls('decrafting/oak_planks'), 1);
});

test('堆叠的中介物按单位逐个掷表', async () => {
	const { S } = await boot();
	const player = join(S, S.createPlayer());
	S.setLootTable('decrafting/stick', () => [S.createItem('minecraft:oak_planks', 1)]);

	putAndNotify(S, player, 0, S.createItem('mq_decrafting_item:stick', 3));

	assert.equal(player.container.getItem(0), undefined);
	assert.equal(S.tableCalls('decrafting/stick'), 3, '一个中介物对应一整套材料');
	assert.equal(player.granted.length, 3);
});

test('单个中介物也能分解, 不会把数量写成 0', async () => {
	// 玩家手里最常见就是一个中介物。逐个减到最后一发时若直接写 item.amount = 0,
	// 引擎会因越界(合法范围 1..255)抛错并中断, 表现为整条分解链路失效。
	const { S } = await boot();
	const player = join(S, S.createPlayer());
	S.setLootTable('decrafting/oak_planks', () => [S.createItem('minecraft:oak_log', 1)]);

	putAndNotify(S, player, 0, S.createItem('mq_decrafting_item:oak_planks', 1));

	assert.equal(player.container.getItem(0), undefined, '处理完最后一发应当清空该格');
	assert.deepEqual(player.granted.map((item) => item.typeId), ['minecraft:oak_log']);
});

test('战利品表缺失时保留物品并提示玩家', async () => {
	const { S } = await boot();
	const player = join(S, S.createPlayer());

	putAndNotify(S, player, 0, S.createItem('mq_decrafting_item:nowhere', 2));

	assert.equal(player.container.getItem(0)?.amount, 2, '没有战利品表时一个都不能少');
	assert.ok(player.messages.some((message) => message.translate === 'mqdt.message.cannot_decraft'));
});

test('掷表为空时不吞物品', async () => {
	const { S } = await boot();
	const player = join(S, S.createPlayer());
	S.setLootTable('decrafting/coal', () => []);

	putAndNotify(S, player, 0, S.createItem('mq_decrafting_item:coal', 1));

	assert.equal(player.container.getItem(0)?.typeId, 'mq_decrafting_item:coal');
	assert.equal(S.tableCalls('decrafting/coal'), 1);
	assert.ok(player.messages.some((message) => message.translate === 'mqdt.message.cannot_decraft'));
});

test('中途掷表失败时只消耗成功的部分', async () => {
	const { S } = await boot();
	const player = join(S, S.createPlayer());
	S.setLootTable('decrafting/torch', (call) => (call < 3 ? [S.createItem('minecraft:stick', 1)] : []));

	putAndNotify(S, player, 0, S.createItem('mq_decrafting_item:torch', 3));

	assert.equal(player.container.getItem(0)?.amount, 1, '失败的那一发不能白吃一个中介物');
	assert.equal(player.granted.length, 2);
});

test('非中介物不会被写进处理路径', async () => {
	const { S } = await boot();
	const player = join(S, S.createPlayer());
	const before = player.container.writes;

	putAndNotify(S, player, 1, S.createItem('minecraft:diamond', 2));

	assert.equal(player.container.getItem(1).typeId, 'minecraft:diamond');
	assert.equal(player.container.getItem(1).amount, 2);
	assert.deepEqual(player.granted, []);
	assert.equal(player.container.writes, before + 1, '只有那次真实放置才写容器');
});

test('背包满时材料落地而不是消失', async () => {
	const { S } = await boot();
	const player = join(S, S.createPlayer());
	for (let i = 1; i < 36; i++) player.container.setItem(i, S.createItem(`minecraft:filler_${i}`, 1));
	S.setLootTable('decrafting/bookshelf', () => [S.createItem('minecraft:oak_planks', 6)]);

	putAndNotify(S, player, 0, S.createItem('mq_decrafting_item:bookshelf', 1));

	assert.equal(player.container.getItem(0), undefined);
	assert.equal(player.spawnedItems.length, 1, '装不下必须掉在地上');
	assert.equal(player.spawnedItems[0].typeId, 'minecraft:oak_planks');
});

test('光标模式: 光标里的中介物被换成材料', async () => {
	const { S } = await boot();
	const player = join(S, S.createPlayer());
	player.setDynamicProperty('has_cursor', true);
	S.setLootTable('decrafting/noteblock', () => [S.createItem('minecraft:oak_planks', 8)]);

	S.handlers.playerSpawn({ initialSpawn: true, player });
	player.cursor.item = S.createItem('mq_decrafting_item:noteblock', 1);
	S.advance(1);

	assert.equal(player.cursor.item, undefined);
	assert.deepEqual(player.granted.map((item) => item.typeId), ['minecraft:oak_planks']);
});

test('光标组件无效时降级为容器模式并立即清理已有中介物', async () => {
	const { S } = await boot();
	const player = S.createPlayer();
	player.setDynamicProperty('has_cursor', true);
	player.hasValidCursor = false;
	player.container.setItem(0, S.createItem('mq_decrafting_item:coal', 1));
	S.setLootTable('decrafting/coal', () => [S.createItem('minecraft:coal', 1)]);

	S.handlers.playerSpawn({ initialSpawn: true, player });

	assert.equal(player.getDynamicProperty('has_cursor'), false);
	assert.equal(player.container.getItem(0), undefined);
	assert.deepEqual(player.granted.map((item) => item.typeId), ['minecraft:coal']);
});

// 分解台容器的 tick 是模块加载时就常驻的, 任务计数一律用基线做相对断言,
// 免得以后再多加一个定时任务就把这些用例全打挂
test('Init 幂等: 重复初始化只保留一个光标任务', async () => {
	const { S } = await boot();
	const player = S.createPlayer();
	player.setDynamicProperty('has_cursor', true);
	const base = S.intervals.size;

	S.handlers.playerSpawn({ initialSpawn: true, player });
	S.handlers.playerSpawn({ initialSpawn: true, player });

	assert.equal(S.intervals.size, base + 1);
});

test('模式切换不泄漏定时任务', async () => {
	const { S } = await boot();
	const player = S.createPlayer();
	S.handlers.playerSpawn({ initialSpawn: true, player });
	const base = S.intervals.size;

	const event = (message) => S.handlers.scriptEvent({ id: 'mqdt:cursor', sourceEntity: player, message });
	event('enable');
	event('enable');
	assert.equal(S.intervals.size, base + 1);
	event('disable');
	event('disable');
	assert.equal(S.intervals.size, base, '容器模式靠事件驱动, 不该留下定时器');
});

test('worldLoad 注册兜底扫描, 每 20 tick 跑一次', async () => {
	const { S } = await boot();
	const player = S.createPlayer();
	S.setLootTable('decrafting/crafting_table', () => [S.createItem('minecraft:oak_planks', 4)]);
	const base = S.intervals.size;

	S.handlers.worldLoad();
	S.handlers.worldLoad();
	assert.equal(S.intervals.size, base + 1, '重复加载世界不能叠加兜底扫描');

	// 事件没抛出来的入口(其他插件直接写入容器)也要被兜底扫描处理
	player.container.setItem(5, S.createItem('mq_decrafting_item:crafting_table', 1));
	S.advance(19);
	assert.equal(S.tableCalls('decrafting/crafting_table'), 0, '不到周期不该扫描');

	S.advance(1);
	assert.equal(S.tableCalls('decrafting/crafting_table'), 1);
	assert.equal(player.container.getItem(5), undefined);
});

test('worldLoad 会初始化已在世界的玩家并清理遗留中介物', async () => {
	const { S } = await boot();
	const player = S.createPlayer();
	S.setLootTable('decrafting/bowl', () => [S.createItem('minecraft:oak_planks', 1)]);
	player.container.setItem(2, S.createItem('mq_decrafting_item:bowl', 1));

	S.handlers.worldLoad();

	assert.equal(player.container.getItem(2), undefined);
	assert.deepEqual(player.granted.map((item) => item.typeId), ['minecraft:oak_planks']);
});

test('模板物品 mq 被直接吞掉而不查战利品表', async () => {
	const { S } = await boot();
	const player = join(S, S.createPlayer());

	putAndNotify(S, player, 0, S.createItem('mq_decrafting_item:mq', 1));

	assert.equal(player.container.getItem(0), undefined);
	assert.deepEqual(player.messages, []);
});

test('铁砧砸到工作台: 转成原生分解台并初始化标记', async () => {
	const { S } = await boot();
	const grid = S.newGrid();
	grid.place(0, 0, 0, 'minecraft:crafting_table');
	// 正在下落的方块压在工作台那一列
	S.setFallingBlocks([{ location: { x: 0.5, y: 1.2, z: 0.5 } }]);
	// 落点上方出现了铁砧 —— 靠这一步确认砸下来的是铁砧而不是沙子
	grid.place(0, 1, 0, 'minecraft:anvil');

	S.advance(2);

	assert.equal(grid.get(0, 0, 0), 'mq_decrafting_table:table');
	assert.equal(grid.get(0, 1, 0), 'minecraft:chipped_anvil', '完好的铁砧该降一档, 而不是直接消失');
	assert.deepEqual(S.spawned, ['minecraft:lightning_bolt']);
	assert.equal(S.blockAt(0, 0, 0).getComponent('minecraft:inventory').container.getItem(0).typeId, 'mqdt:ui_marker');
});

test('开裂的铁砧再砸一次变严重损坏', async () => {
	const { S } = await boot();
	const grid = S.newGrid();
	grid.place(0, 0, 0, 'minecraft:crafting_table');
	S.setFallingBlocks([{ location: { x: 0.5, y: 1.2, z: 0.5 } }]);
	grid.place(0, 1, 0, 'minecraft:chipped_anvil');

	S.advance(2);

	assert.equal(grid.get(0, 0, 0), 'mq_decrafting_table:table');
	assert.equal(grid.get(0, 1, 0), 'minecraft:damaged_anvil');
});

test('最坏档的铁砧砸完就碎掉', async () => {
	const { S } = await boot();
	const grid = S.newGrid();
	grid.place(0, 0, 0, 'minecraft:crafting_table');
	S.setFallingBlocks([{ location: { x: 0.5, y: 1.2, z: 0.5 } }]);
	grid.place(0, 1, 0, 'minecraft:damaged_anvil');

	S.advance(2);

	assert.equal(grid.get(0, 0, 0), 'mq_decrafting_table:table');
	assert.equal(grid.get(0, 1, 0), 'minecraft:air', 'damaged_anvil 是最后一档, 用完该碎掉');
});

test('掉下来的不是铁砧就不转化', async () => {
	const { S } = await boot();
	const grid = S.newGrid();
	grid.place(0, 0, 0, 'minecraft:crafting_table');
	S.setFallingBlocks([{ location: { x: 0.5, y: 1.2, z: 0.5 } }]);
	grid.place(0, 1, 0, 'minecraft:sand');

	S.advance(4);

	assert.equal(grid.get(0, 0, 0), 'minecraft:crafting_table', '沙子砸下来不该把工作台变掉');
	assert.deepEqual(S.spawned, []);
});

// ---------------------------------------------------------------------------
// 差额提示: 输入不够一整批时, 输出格摆一个数量=差额的占位物品
// ---------------------------------------------------------------------------

test('输入不够一批: 输出格出现占位物品, 数量正好是差额', async () => {
	const { S } = await boot();
	const entity = S.addContainer(2);
	const container = entity.container;
	// acacia_door 的 batch 是 3: 放 1 个还差 2 个
	container.setItem(0, S.createItem('minecraft:acacia_door', 1));

	S.advance(4);

	const output = container.getItem(1);
	assert.equal(output.typeId, 'mq_decrafting_item:need');
	assert.equal(output.amount, 2, 'batch=3 放了 1 个, 差额该是 2');
	assert.equal(output.lockMode, 'none', '刻意不上锁: slot 锁在实体容器里拦不住拖拽, 却会触发原版通知');
	assert.equal(output.nameTag, undefined, '共享容器不能写死某个玩家的语言');
	assert.deepEqual(output.getRawLore(), [
		{ translate: 'mqdt.hint.missing', with: ['2'] },
		{ translate: 'mqdt.hint.item', with: { rawtext: [{ translate: 'item.acacia_door.name' }] } },
		{ translate: 'mqdt.hint.batch', with: ['3'] },
	]);
});

test('输入补够一批: 占位被真正的中介物顶掉', async () => {
	const { S } = await boot();
	const entity = S.addContainer(2);
	const container = entity.container;
	container.setItem(0, S.createItem('minecraft:acacia_door', 1));

	S.advance(4);
	assert.equal(container.getItem(1).typeId, 'mq_decrafting_item:need');

	container.setItem(0, S.createItem('minecraft:acacia_door', 3));
	S.advance(4);

	const output = container.getItem(1);
	assert.equal(output.typeId, 'mq_decrafting_item:acacia_door');
	assert.equal(output.amount, 1);
	assert.equal(container.getItem(0), undefined, '刚好一批, 输入该清空');
});

test('输入清空: 占位跟着撤掉', async () => {
	const { S } = await boot();
	const entity = S.addContainer(2);
	const container = entity.container;
	container.setItem(0, S.createItem('minecraft:acacia_door', 1));

	S.advance(4);
	assert.equal(container.getItem(1).typeId, 'mq_decrafting_item:need');

	container.setItem(0, undefined);
	S.advance(4);

	assert.equal(container.getItem(1), undefined, '输入没了, 还差提示不该留在格子里');
});

test('差额不变时不重复写容器', async () => {
	const { S } = await boot();
	const entity = S.addContainer(2);
	const container = entity.container;
	container.setItem(0, S.createItem('minecraft:acacia_door', 1));

	S.advance(4);
	const writes = container.writes;
	S.advance(8);

	assert.equal(container.writes, writes, '占位物品原样不变时不该每轮都写一遍');
});

test('占位物品 need 被直接吞掉, 不会原样退回', async () => {
	const { S } = await boot();
	const player = S.createPlayer('tester');
	join(S, player);

	putAndNotify(S, player, 0, S.createItem('mq_decrafting_item:need', 3));

	assert.equal(player.container.getItem(0), undefined);
	assert.deepEqual(player.messages, []);
});

test('换入不认识的物品: 占位被让位, 不误当产出', async () => {
	const { S } = await boot();
	const entity = S.addContainer(2);
	const container = entity.container;
	container.setItem(0, S.createItem('minecraft:acacia_door', 1));

	S.advance(4);
	assert.equal(container.getItem(1).typeId, 'mq_decrafting_item:need');

	container.setItem(0, S.createItem('minecraft:diamond', 1));
	S.advance(4);

	assert.equal(container.getItem(1).typeId, 'mq_decrafting_item:need', '不认识的输入不动输出格, 等玩家自己取走');
});
