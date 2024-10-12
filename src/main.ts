import { Container, EntityInventoryComponent, ItemStack, Player, PlayerCursorInventoryComponent, system, world } from '@minecraft/server';

declare module '@minecraft/server' {
	interface Player {
		Cursor: PlayerCursorInventoryComponent;
		Container: Container;
		Token: number | undefined;
		Decraft: (item: ItemStack | undefined) => ItemStack | undefined;
		Init: () => void;
	}
}

Player.prototype.Decraft = function (item: ItemStack | undefined) {
	if (item?.typeId.startsWith('mq_decrafting_item:')) {
		if (item.typeId !== 'mq_decrafting_item:mq') {
			const cmd = `loot spawn ~~~ loot "decrafting/${item.typeId.slice(19)}"`;
			while (item.amount > 1) {
				item.amount--;
				if (this.runCommand(cmd).successCount === 0) {
					this.sendMessage('无法分解物品: ' + item.typeId);
					return item;
				}
			}
			if (this.runCommand(cmd).successCount === 0) {
				this.sendMessage('无法分解物品: ' + item.typeId);
			}
		}
		return undefined;
	}
	return item;
};

Player.prototype.Init = function (this: Player) {
	if (this.getDynamicProperty('has_cursor')) {
		this.Cursor = this.getComponent('cursor_inventory') as PlayerCursorInventoryComponent;
		if (this.Cursor?.isValid()) {
			return (this.Token = system.runInterval(CursorFn.bind(this), 1));
		} else {
			this.setDynamicProperty('has_cursor', false);
			this.sendMessage('无法获取光标组件, 将使用容器模式');
		}
	}
	this.Container = (this.getComponent('inventory') as EntityInventoryComponent).container as Container;
	this.Token = system.runInterval(TouchFn.bind(this), 1);
};

function CursorFn(this: Player) {
	if (this.Decraft(this.Cursor.item) === undefined) this.Cursor.clear();
}

function TouchFn(this: Player) {
	for (let i = 0; i < this.Container.size; i++) {
		this.Container.setItem(i, this.Decraft(this.Container.getItem(i)));
	}
}

world.afterEvents.playerSpawn.subscribe(({ initialSpawn, player }) => {
	if (initialSpawn) {
		player.Init();
	}
});

world.beforeEvents.playerLeave.subscribe(({ player }) => {
	if (player.Token) {
		system.clearRun(player.Token);
	}
});

world.afterEvents.worldInitialize.subscribe(() => {
	for (const player of world.getPlayers()) {
		player.Init();
	}
});

system.afterEvents.scriptEventReceive.subscribe(
	({ id, sourceEntity: player, message }) => {
		if (player instanceof Player) {
			switch (id) {
				case 'mqdt:cursor':
					if (player.Token !== undefined) system.clearRun(player.Token);
					switch (message) {
						case 'enable':
							player.Cursor = player.getComponent('cursor_inventory') as PlayerCursorInventoryComponent;
							if (player.Cursor?.isValid()) {
								player.Token = system.runInterval(CursorFn.bind(player), 1);
								player.setDynamicProperty('has_cursor', true);
								player.sendMessage('光标模式已启用');
							} else {
								player.sendMessage('无法获取光标组件, 将使用容器模式');
							}
							break;

						case 'disable':
							player.setDynamicProperty('has_cursor', false);
							player.Container = (player.getComponent('inventory') as EntityInventoryComponent).container as Container;
							player.Token = system.runInterval(TouchFn.bind(player), 1);
							player.sendMessage('光标模式已禁用');
							break;
					}
					break;
			}
		}
	},
	{ namespaces: ['mqdt'] }
);

world.afterEvents.playerPlaceBlock.subscribe(
	({ block, dimension }) => {
		if (
			block.east()?.typeId === 'minecraft:iron_block' &&
			block.west()?.typeId === 'minecraft:iron_block' &&
			block.north()?.typeId === 'minecraft:iron_block' &&
			block.south()?.typeId === 'minecraft:iron_block' &&
			block.offset({ x: -1, y: 0, z: 1 })?.typeId === 'minecraft:copper_block' &&
			block.offset({ x: 1, y: 0, z: -1 })?.typeId === 'minecraft:copper_block' &&
			block.offset({ x: 1, y: 0, z: 1 })?.typeId === 'minecraft:copper_block' &&
			block.offset({ x: -1, y: 0, z: -1 })?.typeId === 'minecraft:copper_block'
		) {
			block.east()?.setType('air');
			block.west()?.setType('air');
			block.north()?.setType('air');
			block.south()?.setType('air');
			block.offset({ x: -1, y: 0, z: 1 })?.setType('air');
			block.offset({ x: 1, y: 0, z: -1 })?.setType('air');
			block.offset({ x: 1, y: 0, z: 1 })?.setType('air');
			block.offset({ x: -1, y: 0, z: -1 })?.setType('air');

			dimension.spawnEntity('lightning_bolt', block);
			block.setType('mq_decrafting_table:table');
		}
	},
	{ blockTypes: ['minecraft:crafting_table'] }
);
