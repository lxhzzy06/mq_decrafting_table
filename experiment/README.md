# block_entity 隐藏标记 UI 实验（正式版 26.50 / 26.52）

## 当前实现与验证范围

新增 `mqdt_exp:be_marker_box`，库存为三格：slot 0 是隐藏标记，slot 1 输入，slot 2 输出。
标记物 `mqdt_exp:ui_marker` 最大耐久为 32747，剩余耐久为 1193；两项同时匹配才显示
`MQDT MARKER OK`、箭头与两个可见业务格。识别的是布局类型，不是某一个方块的位置。
该数值协议独立于 `@bedrock-core/ui` 的 32749 协议，不占用它的识别码。

新增 `mqdt_exp:plain_box` 作为三格无标记对照；原来的 `mqdt_exp:be_box` 仍是两格，
不迁移、不写标记，原有库存位置不变。三者使用同一种原生容器界面，但只有标记方块显示 MQ UI。
标记恢复在放置、交互及每四 tick 执行：如果标记槽里是普通物品，会移入空业务格，
业务格都满时掉落该普通物品，再补回标记。标记误取后从玩家背包、光标及掉落实体回收。
不使用容器中无效的 slot 锁，也不回收玩家的普通木棍或其他附加包物品。

经典模式只向原版标签/网格追加可见性绑定，向 `panel_top_half.controls` 插入自定义控件；
补丁位于原版路径 `rp/ui/data_driven_container_screen.json`。Pocket 的根入口继承了控件数组，
直接插入会遮蔽继承内容，因此将其指向自己的路由根：未匹配时引用完整原版面板，匹配时显示
独立布局并保留原版玩家库存、关闭按钮、光标与物品动画。Pocket 入口修改仍可能与其他重写
同一 `screen.variables` 的资源包冲突，不能据此声称兼容所有 UI 包。

UI 由 `build-ui.mjs` 生成，数值来自 `bp/scripts/marker.js`，表达式输出为字面量。
修改识别码后需重新生成，检查脚本会核对物品定义、UI 绑定、槽位索引与对照方块容量。

```powershell
node experiment/build-ui.mjs
node experiment/check-experiment.mjs
node --test experiment/marker.test.mjs
./experiment/deploy.ps1
```

七项脚本测试覆盖重载、标记被取、错放物品、满格掉落、掉落失败、两格容器保护和损坏标记恢复；
另有 JSON/绑定检查与 Script API 类型检查。尚未在本机 Minecraft 中验证新增标记 UI 的渲染、
快捷移动、Pocket 交互和原生破坏掉落；脚本模拟通过不等于游戏验证通过。

本实验没有分解逻辑，两个业务格是普通库存。生产包 1.1.0 已另行接入原生分解逻辑，
使用独立的最大耐久 32743。使用生产包时请停用实验 BP/RP，避免两个实验/生产入口同时覆盖。

## 接入方式

`minecraft:block_entity.container.slot_count` 提供原生库存，右键方块由引擎打开界面。
脚本通过 `block.getComponent('minecraft:inventory').container` 访问库存。
JSON UI 改变库存的呈现方式；输入与产出的处理仍由脚本完成。

```json
"minecraft:block_entity": {
  "container": { "slot_count": 2 }
}
```

方块容器使用 `data_driven_container` 命名空间，经典布局入口是
`data_driven_container.panel_top_half`，Pocket 布局入口是
`pocket_containers.data_driven_container_panel`。生产包的
`chest.small_chest_panel_top_half` 用于实体容器，不能承担这个实验的方块 UI。

引擎提供 `$container_size`，物品集合是 `container_items`。
之前的实验用 `$container_size = 2` 选择布局，会误识别其他两格容器；当前已移除容量路由。
现在通过 `collection_details` 和两个耐久 `collection` 绑定读取 slot 0，业务控件通过
`stack_panel.collection_name` 下的实例 `collection_index` 分别读取 slot 1 / slot 2。
箭头不参与物品集合，不会占用库存索引。

正式版当前不能通过 `container.title` 标记方块身份：该字段在 Preview
26.60.29 才加入。隐藏槽耐久标记是另一条路，不要求该新字段。
`minecraft:display_name` 用于方块名称，不能据此推断它会成为容器标题。
后续支持新预览版时，可显式设置 `container.title` 并验证
`$container_title` 收到的原始值后再用它选择布局。

## 已确认的排查结果

- 2026-10-07 本机正式版 ContentLog 已记录 `minecraft:inventory` 存在、
  `container.size = 2`，所以库存接入已在实机运行。
- 正式版 GDK 开发资源包中部署的 UI 与项目源码的 SHA-256 不同。
  已部署版本的 `ALIVE` 标签没有显式 `size`，上半面板被设为 110 高，
  与原版一行容器的 42 高面板不匹配。它们是显示异常的候选原因；
  需要实机确认，不能仅凭 JSON 静态检查认定根因。
- 原探针 `#T=[$container_title] #S=[$container_size]` 不应当作字符串插值。
  本版本使用静态文字加 `visible` 条件验证槽位数，避免依赖插值和数字转字符串。
- 经典模式的探针和槽位均放在原生上半面板范围内，不扩大根面板，
  不把标签移到负 Y 坐标；Pocket 模式另有独立覆盖文件。
- 旧方块的 onTick 探针保持只读；新方块只维护自己的标记槽。
  `/scriptevent mqdt:probe` 现在也是只读，显示各槽物品、最大耐久和剩余耐久。
  `/scriptevent mqdt:probe_write` 是显式写入命令，只向实验方块的空输出格写 7 个钻石。

## 实机验证

1. 在世界中启用实验 BP 和 RP，并按当前版本要求开启 Upcoming Creator Features。
   单独启用 Beta APIs 不能代替方块组件要求的实验开关。
2. 把 `bp/` 和 `rp/` 的完整内容分别同步到开发包目录；仅修改仓库不会部署。
   项目的 `gulpfile.js` 只部署 `pack/`，没有部署本实验目录。
3. 本机正式版开发路径为：
   `%APPDATA%/Minecraft Bedrock/users/shared/games/com.mojang/development_behavior_packs/mqdt_exp_bp/`
   和对应 `development_resource_packs/mqdt_exp_rp/`。
   检查世界实际启用的包 UUID、资源包优先级和 UI 文件内容，再退出并重新进入世界加载。
4. 分别 `/give @s mqdt_exp:be_marker_box`、`/give @s mqdt_exp:plain_box`，放置并右键。
   标记方块应显示 `MQDT MARKER OK`、箭头与两格；无标记对照应显示原生三格。
   原来的 `mqdt_exp:be_box` 应显示原生两格。分别在经典、Pocket 模式验证。
5. 标记方块两格分别存入不同物品，取出、快捷移动、重进世界核对物品；破坏方块应掉落
   两格业务物品，标记掉落应被回收。准星指向标记方块时运行 `/scriptevent mqdt:probe`，
   应记录 size=3、slot0 最大耐久 32747 / 剩余耐久 1193，业务物品位于 slot1/slot2。
   若只看到原生三格，分别检查标记写入、耐久日志、资源包补丁是否生效。
6. 若没有探针，先检查部署和界面模式，再查看内容日志的 UI 错误。
   当前改动只通过静态校验，尚未验证本版布局的实际渲染与交互。

## 官方依据

- [方块组件参数](https://learn.microsoft.com/en-us/minecraft/creator/reference/content/blockreference/examples/blockcomponents/minecraftblock_block_entity)
- [26.50 更新说明：原生容器、持久化、破坏掉落与脚本访问](https://www.minecraft.net/en-us/article/minecraft--bedrock-edition-26-50-changelog)
- [官方 data_driven_container UI](https://github.com/Mojang/bedrock-samples/blob/main/resource_pack/ui/data_driven_container_screen.json)
- [官方 Pocket 容器 UI](https://github.com/Mojang/bedrock-samples/blob/main/resource_pack/ui/pocket_containers.json)
- [Preview 26.60.29：新增 container.title](https://www.minecraft.net/en-us/article/minecraft-preview-26-60-29)

## 社区实现依据

- [Bedrock Core 容器路由说明](https://bedrock-core.drav.dev/docs/ui/compiler/output/)
- [已核对源码：路由器及集合索引](https://github.com/bedrock-core/ui/blob/main/packages/resource-pack/packs/RP/ui/core-ui/hosts/chest/router.json)
- [已核对源码：向原版绑定数组追加条件](https://github.com/bedrock-core/ui/blob/main/packages/resource-pack/packs/RP/ui/chest_screen.json)
- [作者实测：自定义物品最大耐久与剩余耐久通道](https://github.com/bedrock-core/ui/blob/main/docs/spikes/S14-custom-item-carriers.md)
