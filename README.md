# MQ's Decrafting Table / MQ 的分解台

Minecraft Bedrock 附加包，适用于正式版 **26.50 / 26.52**。当前附加包版本 **1.1.0**。
从 Mojang 的官方工作台配方生成分解规则；本次使用固定标签 `v1.26.50.4`，提供 901 条规则。
并非所有物品都可分解：非工作台配方、无法区分的旧 aux 变种及多产物配方会跳过。

下载：[GitHub Releases](https://github.com/lxhzzy06/mq_decrafting_table/releases) ·
[CurseForge](https://www.curseforge.com/minecraft-bedrock/addons/mqs-decrafting-table)

## 安装与使用

1. 打开 `.mcaddon` 导入，启用行为包和资源包，停用此前的 `mqdt_exp` 实验包。世界需要开启 **Upcoming Creator Features（即将推出的创作者功能）**，原生方块容器仍属于实验功能。
2. 在工作台上方让铁砧从至少一格高处落下，工作台会转为分解台，铁砧降低一个磨损档。
3. 右键打开分解台，左侧放入物品，右侧取出分解产物。取出的中介物进入背包后会转换成材料；背包装不下的材料掉落在玩家身边。
4. 批量合成物品需凑齐原配方产量，例如门每份需要 3 个。数量不足时右侧提示还差多少。

损坏或带附魔的装备会留在输入格，避免返还完整材料或误吞附魔。多配方物品按生成器选定的一条规则返还；系统不记录物品的制作历史，也不能保证返还原先使用的木材种类。

经典和 Pocket 布局均提供输入、输出两格。实际库存另有一个隐藏 UI 标记槽；普通同容量容器不应显示分解台界面。

## 从旧版本升级

保留原有行为包与资源包 UUID，导入 1.1.0 后替换世界中的旧版本并重新进入。
加载区块内的旧实体库存会迁到原生方块库存，迁移完成后移除旧容器实体。
如果对应业务格已经有物品，旧库存物品会掉落在台子旁边，不覆盖新库存。
未加载区块中的旧容器在之后加载时迁移；旧的合成台制作方式已改为上述铁砧落下的方式。

## 开发

需要 Node.js 22+ 和 Rust。安装依赖后：

```text
npm ci
npm run gen
npm run gen:ui
npm run check
npm test
npm run test:rust
npm run test:pack
npm run build
```

`MQDT_SRC_DIR` 可指定官方语料目录，目录内应包含 `behavior_pack/recipes`。
构建会重新生成脚本索引与 UI，产物为 `target/mq_decrafting_table.mcaddon`。
`npm run deploy` 部署 Windows GDK 开发包；`MQDT_PREVIEW=1` 使用预览版目录。

手动发布在 GitHub Actions 的 **Release** 页面填写 `upstream_tag`（例如 `v1.26.50.4`）
和 `release_tag`（例如 `v1.1.0`）。检查通过后依次生成 GitHub Release、上传 123 云盘，正式版再上传 CurseForge；各渠道失败会独立记录。

## 实现与许可

Rust 生成材料战利品表和中介物，TypeScript 处理库存与返还。原生容器通过隐藏物品的
最大耐久和剩余耐久识别 UI，独立协议值与实验包、Bedrock Core 分开。
经典布局用局部插入，Pocket 使用独立路由入口；同样重写 Pocket 入口的其他资源包仍需实测兼容性。

实现参考：[Bedrock Core 的容器路由](https://bedrock-core.drav.dev/docs/ui/compiler/output/)。
配方来源：[Mojang/bedrock-samples](https://github.com/Mojang/bedrock-samples)。
项目代码采用 MIT 许可；Minecraft 及官方资源归各自权利人所有。

---

**English:** MQ's Decrafting Table 1.1.0 targets Bedrock 26.50 / 26.52 and requires **Upcoming Creator Features**. Import both packs. Drop an anvil onto a crafting table to create the workstation. Insert items on the left and take the result on the right; intermediate result items turn into ingredients in your inventory. Batch outputs require a complete recipe batch. Damaged or enchanted equipment is rejected. The release uses 901 generated rules from Mojang's `v1.26.50.4` crafting data; not every item or recipe is reversible. Loaded legacy entity inventories migrate to the native block container. See the [release notes](docs/RELEASE_NOTES_1.1.0.md).
