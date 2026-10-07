use serde_json::Value;
use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;
use std::process::Command;

fn fixture_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures")
}

fn generate_into(out: &PathBuf) -> std::process::Output {
    Command::new(env!("CARGO_BIN_EXE_mq_decrafting_table"))
        .env("MQDT_SRC_DIR", fixture_root())
        .env("MQDT_OUT_DIR", out)
        .output()
        .expect("运行生成器失败")
}

struct TempDir(PathBuf);

impl TempDir {
    fn new(name: &str) -> Self {
        let dir = std::env::temp_dir().join(format!("mqdt-it-{}-{}", name, std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("创建临时目录失败");
        Self(dir)
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn read_json(path: PathBuf) -> Value {
    let text = fs::read_to_string(&path).unwrap_or_else(|e| panic!("读取 {:?} 失败: {}", path, e));
    serde_json::from_str(&text).expect("解析 JSON 失败")
}

/// 生成器给出的换算表: 物品 id -> { table, batch }
fn index_of(out: &PathBuf) -> BTreeMap<String, Value> {
    read_json(out.join("decrafting_index.json"))
        .as_object()
        .expect("索引不是对象")
        .into_iter()
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect()
}

fn batch_of(out: &PathBuf, item: &str) -> u64 {
    index_of(out)
        .get(item)
        .unwrap_or_else(|| panic!("索引里没有 {item}"))
        ["batch"]
        .as_u64()
        .expect("batch 不是数字")
}

fn table_of(out: &PathBuf, id: &str) -> Value {
    read_json(out.join("loot_tables/decrafting").join(format!("{id}.json")))
}

fn exists(out: &PathBuf, dir: &str, name: &str) -> bool {
    out.join(dir).join(name).exists()
}

#[test]
fn 生成全部fixture的中介物与战利品表() {
    let out = TempDir::new("basic");
    assert!(generate_into(&out.0).status.success());

    for name in ["test_boat.json", "test_noteblock.json", "test_shapeless.json"] {
        assert!(exists(&out.0, "loot_tables/decrafting", name), "缺少战利品表 {}", name);
        assert!(exists(&out.0, "items/decrafting", name), "缺少中介物 {}", name);
    }
}

#[test]
fn 不再产出反向配方() {
    let out = TempDir::new("no_recipe");
    assert!(generate_into(&out.0).status.success());
    // 分解已经不走合成台匹配了, 留着配方只会让玩家在别处误触
    let left = fs::read_dir(out.0.join("recipes/decrafting"))
        .expect("缺少 recipes/decrafting")
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().map(|x| x == "json").unwrap_or(false))
        .count();
    assert_eq!(left, 0, "仍在产出反向配方, 容器模式不需要它们");
}

#[test]
fn 补全缺失的命名空间() {
    let out = TempDir::new("namespace");
    assert!(generate_into(&out.0).status.success());

    // 源配方里的 "test_noteblock" 不带命名空间
    let table = table_of(&out.0, "test_noteblock");
    let mut checked = 0;
    for pool in table["pools"].as_array().expect("缺少 pools") {
        for entry in pool["entries"].as_array().expect("缺少 entries") {
            let name = entry["name"].as_str().expect("条目缺少 name");
            assert!(
                name.starts_with("minecraft:"),
                "条目标识符合法性失败: {}",
                name
            );
            checked += 1;
        }
    }
    assert!(checked > 0, "战利品表为空, 无法验证命名空间补全");
}

#[test]
fn 中介物与战利品表成对产出() {
    let out = TempDir::new("pair");
    assert!(generate_into(&out.0).status.success());

    let items = fs::read_dir(out.0.join("items/decrafting"))
        .expect("缺少 items 目录")
        .filter_map(|e| e.ok())
        .count();
    let tables = fs::read_dir(out.0.join("loot_tables/decrafting"))
        .expect("缺少 loot_tables 目录")
        .filter_map(|e| e.ok())
        .count();
    assert_eq!(items, tables, "每个中介物都必须有对应的战利品表");
    assert!(items > 0, "应至少产出一个中介物");

    for entry in fs::read_dir(out.0.join("items/decrafting")).unwrap() {
        let path = entry.unwrap().path();
        let stem = path.file_stem().unwrap().to_str().unwrap().to_owned();
        let item = read_json(path);
        let identifier = item["minecraft:item"]["description"]["identifier"]
            .as_str()
            .expect("缺少 identifier");
        assert_eq!(identifier, format!("mq_decrafting_item:{}", stem));
    }
}

#[test]
fn 索引记录了整批的数量() {
    let out = TempDir::new("batch_idx");
    assert!(generate_into(&out.0).status.success());
    // 16 个玻璃板换 6 个玻璃: 玩家必须投入 16 个才换一份材料
    assert_eq!(batch_of(&out.0, "minecraft:test_pane"), 16);
    // 2 个柱子换 1 个板
    assert_eq!(batch_of(&out.0, "minecraft:test_pillar"), 2);
    // 4 个碗换 3 个木板
    assert_eq!(batch_of(&out.0, "minecraft:test_bowl"), 4);
}

#[test]
fn 整批产物不再受9格限制() {
    let out = TempDir::new("no_9_slot");
    assert!(generate_into(&out.0).status.success());
    // 16 个铁轨换 6 铁锭 + 1 木棍: 合成台摆不下 16 格, 但容器模式一个输入格就够。
    // 这是离开配方匹配后最大的收益 —— 以前这条路线要么缩批要么整个放弃。
    assert_eq!(batch_of(&out.0, "minecraft:test_rail"), 16);
    let table = table_of(&out.0, "test_rail");
    let mut names: Vec<String> = vec![];
    for pool in table["pools"].as_array().expect("缺少 pools") {
        for entry in pool["entries"].as_array().expect("缺少 entries") {
            names.push(entry["name"].as_str().unwrap().to_owned());
        }
    }
    names.sort();
    assert_eq!(
        names,
        vec![
            "minecraft:test_batch_ingot".to_owned(),
            "minecraft:test_batch_stick".to_owned()
        ],
        "整批路线的每一种材料都必须原样返还"
    );
}

#[test]
fn 多产物配方被跳过() {
    let out = TempDir::new("multi_skip");
    assert!(generate_into(&out.0).status.success());
    // 2 原木 -> 4 木板 + 2 木棍: 容器只有一个输入格, 玩家没法一次投入完整的一份。
    // 战利品表按产物名命名, 所以查索引比查文件名靠谱
    assert!(
        !index_of(&out.0).contains_key("minecraft:test_planks"),
        "多产物无法用单格输入表达, 不该生成"
    );
}

#[test]
fn aux_变种无法分辨因此被跳过() {
    let out = TempDir::new("aux_skip");
    assert!(generate_into(&out.0).status.success());
    // test_stew@1 与 test_stew@2 在脚本里长得一模一样(ItemStack 已经没有 data 属性),
    // 生成了只会让玩家拿到错的材料
    for id in ["test_stew_1", "test_stew_2"] {
        assert!(
            !exists(&out.0, "loot_tables/decrafting", &format!("{id}.json")),
            "aux 变种 {id} 不该生成: 运行时分不出来"
        );
    }
    assert!(
        !index_of(&out.0).contains_key("minecraft:test_stew"),
        "索引里不该出现靠 aux 区分的物品"
    );
}

#[test]
fn 同产物只保留最省材料的路线() {
    let out = TempDir::new("cheapest");
    assert!(generate_into(&out.0).status.success());
    // 战利品表按产物命名, 两条路线都叫 test_block.json, 去重后只剩最省材料的那条
    let table = table_of(&out.0, "test_block");
    let name = table["pools"][0]["entries"][0]["name"]
        .as_str()
        .expect("缺少条目");
    assert_eq!(
        name, "minecraft:test_dirt",
        "1 泥土路线应当胜出, 4 石头路线会让分解净增益物资"
    );
}

#[test]
fn 仅有备用路线的产物仍被覆盖() {
    let out = TempDir::new("from_fallback");
    assert!(generate_into(&out.0).status.success());
    assert!(
        exists(&out.0, "loot_tables/decrafting", "test_chest.json"),
        "test_chest 只有 _from_ 命名的路线, 不能再按文件名整类跳过"
    );
}

#[test]
fn tag_路线的战利品表按用量展开() {
    let out = TempDir::new("tag_table");
    assert!(generate_into(&out.0).status.success());
    // 原版用 3 块木板换 4 个碗, tag 展开后战利品表要在候选木板里挑一种给 3 个
    let table = table_of(&out.0, "test_bowl");
    assert_eq!(table["pools"][0]["entries"][0]["functions"][0]["count"], 3);
    let names: Vec<&str> = table["pools"][0]["entries"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["name"].as_str().unwrap())
        .collect();
    assert!(
        names.contains(&"minecraft:oak_planks"),
        "tag 必须展开成具体木板: {names:?}"
    );
}

#[test]
fn 重新生成会清掉上一版的残留产物() {
    let out = TempDir::new("stale");
    let tables = out.0.join("loot_tables/decrafting");
    fs::create_dir_all(&tables).expect("创建目录失败");
    fs::write(tables.join("removed_by_vanilla.json"), "{}").expect("写入残留文件失败");

    assert!(generate_into(&out.0).status.success());
    assert!(
        !tables.join("removed_by_vanilla.json").exists(),
        "官方语料里已不存在的配方必须被清掉, 否则该物品还能被分解"
    );
    assert!(tables.join("test_boat.json").exists());
}
