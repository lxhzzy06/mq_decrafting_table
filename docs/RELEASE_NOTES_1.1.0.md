# MQ's Decrafting Table 1.1.0

For Minecraft Bedrock **26.50 / 26.52**. Enable both packs and **Upcoming Creator Features**; native block containers are still experimental.

- Native block inventory with two visible slots and a hidden UI marker. Ordinary containers with the same capacity keep their normal interface.
- Classic and Pocket layouts. No `container.title` preview API is required.
- 901 generated decrafting rules from Mojang's stable `v1.26.50.4` recipes.
- Loaded legacy entity inventories migrate to the native container. Occupied destination cells are preserved; conflicting legacy items drop beside the workstation.
- Fixed completed output being overwritten by a shortfall hint, and fixed handling of a full output slot.
- Damaged or enchanted equipment is preserved and rejected instead of returning full materials or losing enchantments.
- Fixed script entry and stale generated indices in the release build; BP and RP versions are now 1.1.0.

Create the workstation by dropping an anvil onto a crafting table. Insert items on the left, then take the result on the right. Result tokens turn into materials in your inventory; overflow drops nearby. Batch recipes need the original output quantity. Multiple crafting routes do not retain the original crafting history or original wood species.

Automated checks cover inventory processing, migration, marker cleanup, output conservation, recipe generation and package consistency. A separate marker experiment is included in the source; the complete production migration and Pocket interactions still need broader gameplay testing. Disable the earlier `mqdt_exp` test packs when enabling this release.

---

适用于基岩版正式版 **26.50 / 26.52**，需开启 **即将推出的创作者功能**。

本次更新接入原生方块库存，通过隐藏标记识别分解台，保留经典/Pocket 双布局；使用正式版官方配方生成 901 条规则。
旧实体容器加载后迁移，已有业务物品不会被覆盖；修复差额提示吞产物和输出满格处理，拒绝损坏或附魔装备。
分解台现在通过铁砧落到工作台上制作。批量物品需凑齐整份产量，返还规则不追踪原始制作来源。
原生容器仍为实验功能；正式包迁移和 Pocket 交互还需要更广泛的实机测试。
