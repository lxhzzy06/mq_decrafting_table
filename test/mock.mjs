/**
 * @minecraft/server 的测试替身。
 *
 * src/main.ts 由 esbuild 打进测试包时, `@minecraft/server` 会被 alias 到本文件。
 * 由于打包会让本文件产生一份独立副本, 所有状态统一挂在 globalThis.__MQDT__ 上,
 * 使被测代码与测试进程看到同一份世界状态。
 */

function createState() {
	const state = {
		players: [],
		intervals: new Map(),
		handlers: {},
		nextIntervalId: 1,
		grid: null,
		spawned: [],
		/** 模拟正在下落中的方块实体, 由 setFallingBlocks 配置 */
		fallingBlocks: [],
		/** 活跃区块里的容器实体, 由 addContainer 生成, 供 getEntities({type}) 返回 */
		containers: [],
		/** path -> 掷表结果工厂, 调用次数记录在 .calls 上 */
		tables: new Map(),
		/** {x,y,z} -> 玩家, 供事件之外的位置校验使用 */
		lootTableManager: {
			getLootTable: (path) => (state.tables.has(path) ? { path } : undefined),
			generateLootFromTable: ({ path }) => {
				const factory = state.tables.get(path);
				if (!factory) return undefined;
				factory.calls++;
				return factory.produce(factory.calls);
			},
		},
		createPlayer: (name) => {
			const player = new Player(name);
			state.players.push(player);
			return player;
		},
		createItem: (typeId, amount = 1) => new ItemStack(typeId, amount),
		/** 配置"正在下落中的方块", 元素形如 { location: {x,y,z} } */
		setFallingBlocks: (list) => {
			state.fallingBlocks = list;
		},
		/**
		 * 造一个带库存的容器实体, 模拟方块里塞的那个。
		 * 返回的实体带 getComponent('inventory') 与被 tick 循环用到的 isValid/remove。
		 */
		addContainer: (size = 2) => {
			const container = new Container(size);
			const entity = {
				container,
				location: { x: 0.5, y: 0, z: 0.5 },
				isValid: true,
				nameTag: undefined,
				getComponent: (id) => (id === 'inventory' ? { container } : undefined),
				remove() {
					this.isValid = false;
				},
				dimension: {
					spawnItem: () => ({}),
				},
			};
			state.containers.push(entity);
			return entity;
		},
		newGrid: () => {
			state.grid = new BlockGrid();
			state.spawned = [];
			state.containers = [];
			return state.grid;
		},
		blockAt: (x, y, z) => new Block(state.grid, x, y, z),
	dimension: {
		spawnEntity: (identifier) => {
			state.spawned.push(identifier);
			return {};
		},
		getEntities: (opts) => opts?.type === 'mqdt:decrafting_container' ? state.containers.filter(e => e.isValid) : [],
		spawnItem: (itemStack) => { state.dropped ??= []; state.dropped.push(itemStack); return {}; },
	},
		/** 注册一张战利品表; produce(第几次掷表) 返回 undefined 或空数组表示没出东西 */
		setLootTable: (path, produce) => {
			state.tables.set(path, { produce, calls: 0 });
		},
		tableCalls: (path) => state.tables.get(path)?.calls ?? 0,
		/** 模拟引擎在玩家往格子里写东西后抛出的背包变化事件 */
		fireInventoryChange: (player, slot) => {
			state.handlers.inventoryItemChange?.({ player, slot, inventoryType: 'Inventory' });
		},
		/** 按真实 tick 周期推进, 用来区分"每 tick 扫描"与"每 20 tick 兜底扫描" */
		advance: (ticks) => {
			for (const entry of state.intervals.values()) {
				entry.elapsed += ticks;
				while (entry.elapsed >= entry.ticks) {
					entry.elapsed -= entry.ticks;
					entry.callback();
				}
			}
		},
	};
	return state;
}

const state = (globalThis.__MQDT__ = createState());

/** 与 @minecraft/server 同名的枚举: 脚本会 import 它来给占位物品上锁 */
export const ItemLockMode = {
	inventory: 'inventory',
	none: 'none',
	slot: 'slot',
};

export class ItemStack {
	#amount;

	constructor(typeId, amount = 1) {
		this.typeId = typeId;
		this.amount = amount;
		// 真实 ItemStack 上这两个是可写属性, 脚本用它们给差额占位物品附说明与锁
		this.nameTag = undefined;
		this.lockMode = 'none';
		this.localizationKey = `item.${typeId.split(':')[1]}.name`;
		this.lore = [];
		this.components = new Map();
		if (typeId === 'mqdt:ui_marker') this.components.set('minecraft:durability', { maxDurability: 32743, damage: 0 });
	}

	getComponent(id) { return this.components.get(id); }
	setLore(lines = []) { this.lore = structuredClone(lines.map(line => typeof line === 'string' ? { text: line } : line)); }
	getRawLore() { return structuredClone(this.lore); }

	get amount() {
		return this.#amount;
	}

	/**
	 * 真实引擎对 ItemStack.amount 有 1..255 的硬约束, 写 0 会抛 PropertyOutOfBoundsError
	 * 并中断整个调用栈。mock 必须复现这条约束, 否则"把数量减到 0"这类写法在测试里
	 * 一路绿灯、进了游戏才整条分解链路失效。
	 */
	set amount(value) {
		if (!Number.isInteger(value) || value < 1 || value > 255) {
			throw new Error(
				`PropertyOutOfBoundsError: Unsupported or out of bounds value set on Property: amount, Value: ${value}, Property bounds: [1, 255]`,
			);
		}
		this.#amount = value;
	}
}

export class Container {
	constructor(size) {
		this.size = size;
		this.slots = new Array(size).fill(undefined);
		// 统计容器写入次数, 用来验证脚本不会在无关格子上空写
		this.writes = 0;
	}

	getItem(slot) {
		return this.slots[slot];
	}

	setItem(slot, itemStack) {
		this.writes++;
		this.slots[slot] = itemStack;
	}

	moveItem(from, to, destination) {
		if (destination.getItem(to)) throw new Error('destination occupied');
		destination.setItem(to, this.getItem(from));
		this.setItem(from, undefined);
	}

	/** 找一个空格塞进去, 塞不下就把剩余量返回给调用方 */
	addItemInternal(itemStack) {
		let left = itemStack.amount;
		for (let i = 0; i < this.size && left > 0; i++) {
			const current = this.slots[i];
			if (!current) {
				const take = Math.min(left, 64);
				this.slots[i] = new ItemStack(itemStack.typeId, take);
				left -= take;
			} else if (current.typeId === itemStack.typeId && current.amount < 64) {
				const take = Math.min(left, 64 - current.amount);
				current.amount += take;
				left -= take;
			}
		}
		if (left > 0) return new ItemStack(itemStack.typeId, left);
		return undefined;
	}
}

export class Player {
	constructor(name = 'tester') {
		this.name = name;
		this.properties = new Map();
		this.messages = [];
		this.granted = [];
		this.spawnedItems = [];
		this.location = { x: 0, y: 0, z: 0 };
		this.hasValidCursor = true;
		this.container = new Container(36);
		const self = this;
		this.cursor = {
			item: undefined,
			clear() {
				self.cursor.item = undefined;
			},
			get isValid() {
				return self.hasValidCursor;
			},
		};
		this.dimension = {
			spawnItem: (itemStack) => {
				self.spawnedItems.push(itemStack);
				return {};
			},
			getEntities: () => [],
		};
	}

	getDynamicProperty(identifier) {
		return this.properties.get(identifier);
	}

	setDynamicProperty(identifier, value) {
		this.properties.set(identifier, value);
	}

	getComponent(componentId) {
		if (componentId === 'cursor_inventory') return this.cursor;
		if (componentId === 'inventory') return { container: this.container };
		return undefined;
	}

	addItem(itemStack) {
		const overflow = this.container.addItemInternal(itemStack);
		this.granted.push(itemStack);
		return overflow;
	}

	sendMessage(message) {
		this.messages.push(message);
	}
}

class BlockGrid {
	constructor() {
		this.map = new Map();
		this.containers = new Map();
	}

	key(x, y, z) {
		return `${x},${y},${z}`;
	}

	get(x, y, z) {
		return this.map.get(this.key(x, y, z)) ?? 'minecraft:air';
	}

	place(x, y, z, blockType) {
		this.map.set(this.key(x, y, z), blockType);
		if (blockType === 'mq_decrafting_table:table') this.containers.set(this.key(x, y, z), new Container(3));
	}
}

export class Block {
	constructor(grid, x, y, z) {
		this.grid = grid;
		this.x = x;
		this.y = y;
		this.z = z;
	}

	get location() {
		return { x: this.x, y: this.y, z: this.z };
	}

	get typeId() {
		return this.grid?.get(this.x, this.y, this.z) ?? 'minecraft:air';
	}

	get dimension() {
		return state.dimension;
	}

	getComponent(id) {
		return id === 'minecraft:inventory' ? { container: this.grid?.containers.get(this.grid.key(this.x, this.y, this.z)) } : undefined;
	}

	setType(blockType) {
		this.grid.map.delete(this.grid.key(this.x, this.y, this.z));
		if (blockType && blockType !== 'air') {
			this.grid.place(this.x, this.y, this.z, blockType);
		}
	}

	east(steps = 1) {
		return new Block(this.grid, this.x + steps, this.y, this.z);
	}

	west(steps = 1) {
		return new Block(this.grid, this.x - steps, this.y, this.z);
	}

	north(steps = 1) {
		return new Block(this.grid, this.x, this.y, this.z - steps);
	}

	south(steps = 1) {
		return new Block(this.grid, this.x, this.y, this.z + steps);
	}

	offset(vector) {
		return new Block(this.grid, this.x + vector.x, this.y + vector.y, this.z + vector.z);
	}
}

export const world = {
	// 替身里没有真的维度: 方块读写走同一张 grid, 下落方块由测试按需塞进来
	getDimension: () => ({
		getEntities: (opts) => {
			if (opts?.type === 'minecraft:falling_block') return state.fallingBlocks;
			if (opts?.type === 'mqdt:decrafting_container') return state.containers.filter((e) => e.isValid);
			return [];
		},
		getBlock: (pos) => new Block(state.grid, pos.x, pos.y, pos.z),
		spawnEntity: (identifier) => {
			state.spawned.push(identifier);
			return {};
		},
	}),
	getPlayers: () => state.players,
	getAllPlayers: () => state.players,
	getLootTableManager: () => state.lootTableManager,
	afterEvents: {
		playerSpawn: {
			subscribe(callback) {
				state.handlers.playerSpawn = callback;
			},
		},
		entitySpawn: { subscribe(callback) { state.handlers.entitySpawn = callback; } },
		entityLoad: { subscribe(callback) { state.handlers.entityLoad = callback; } },
		playerPlaceBlock: {
			subscribe(callback) {
				state.handlers.playerPlaceBlock = callback;
			},
		},
		playerInventoryItemChange: {
			subscribe(callback) {
				state.handlers.inventoryItemChange = callback;
			},
		},
		worldLoad: {
			subscribe(callback) {
				state.handlers.worldLoad = callback;
			},
		},
	},
	beforeEvents: {
		playerLeave: {
			subscribe(callback) {
				state.handlers.playerLeave = callback;
			},
		},
	},
};

export const system = {
	currentTick: 0,
	run(callback) { callback(); },
	runInterval(callback, ticks = 1) {
		const id = state.nextIntervalId++;
		state.intervals.set(id, { callback, ticks, elapsed: 0 });
		return id;
	},
	clearRun(runId) {
		state.intervals.delete(runId);
	},
	// 自定义方块组件必须在这里注册, 方块 JSON 里的组件名才认得出来。
	// 引擎是在世界加载前调用它的, 替身也照这个时机立即触发。
	beforeEvents: {
		startup: {
			subscribe(callback) {
				state.handlers.startup = callback;
				state.blockComponents ??= new Map();
				callback({
					blockComponentRegistry: {
						registerCustomComponent(name, component) {
							state.blockComponents.set(name, component);
						},
					},
				});
			},
		},
	},
	afterEvents: {
		scriptEventReceive: {
			subscribe(callback) {
				state.handlers.scriptEvent = callback;
			},
		},
	},
};
