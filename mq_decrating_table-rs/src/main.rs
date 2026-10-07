use anyhow::{bail, Context, Result};
use recipe::Recipe;
use rustc_hash::{FxHashMap, FxHashSet};
use serde::Serialize;
use serde_json::Value;
use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;
mod loot_table;
mod recipe;

#[global_allocator]
static GLOBAL: mimalloc::MiMalloc = mimalloc::MiMalloc;

const ITEM_TEMPLATE: &'static str = include_str!("item.json");
const TARGT: &'static str = "../pack/mq_decrafting_table_bp/";

/// crate 自身的绝对路径, 使默认路径不依赖调用时的工作目录
const MANIFEST_DIR: &'static str = env!("CARGO_MANIFEST_DIR");

/// 配方来源目录, 可用 MQDT_SRC_DIR 覆盖以便测试使用 fixture
fn source_root() -> PathBuf {
    std::env::var("MQDT_SRC_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from(MANIFEST_DIR).join("../bedrock-samples"))
}

/// 产物输出根目录, 可用 MQDT_OUT_DIR 覆盖以便测试写入临时目录
fn target_root() -> PathBuf {
    std::env::var("MQDT_OUT_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from(MANIFEST_DIR).join(TARGT))
}

/// 定位官方配方目录。
///
/// 可能是 `<root>/behavior_pack/recipes`(fixture), 也可能隔着一层仓库目录
/// (`bedrock-samples/sample/behavior_pack/recipes`)。目录枚举顺序在不同文件系统上不可靠,
/// 而且签出目录里还有 `.git`/`README.md` 之类杂项, 所以逐个候选试到底, 不取"第一个条目"。
fn recipes_dir() -> Result<PathBuf> {
    let root = source_root();
    let direct = root.join("behavior_pack").join("recipes");
    if direct.is_dir() {
        return Ok(direct);
    }
    let mut dirs: Vec<PathBuf> = fs::read_dir(&root)
        .with_context(|| format!("读取源目录失败: {}", root.display()))?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.is_dir())
        .collect();
    dirs.sort();
    for dir in dirs {
        let candidate = dir.join("behavior_pack").join("recipes");
        if candidate.is_dir() {
            return Ok(candidate);
        }
    }
    bail!("在 {} 下找不到 behavior_pack/recipes", root.display())
}

/// 补全缺失的命名空间。
///
/// 官方配方里的物品名有时不带命名空间(例如 `redstone`), 直接写进战利品表会得到非法 id,
/// 玩家分解时 loot 表无法命中, 表现为中介物被吞且没有任何产出。
/// `data`(aux) 必须原样保留: 原版最新的 1.26.50 配方仍用它表达变种
/// (`suspicious_stew@7`、`banner@4`), 只有已被拆成独立物品 id 的那批才不再需要 aux。
fn normalize(value: &mut Value) -> Result<()> {
    match value {
        Value::Object(map) => {
            for key in ["item", "tag", "name"] {
                if let Some(Value::String(id)) = map.get_mut(key) {
                    if !id.contains(':') {
                        id.insert_str(0, "minecraft:");
                    }
                }
            }
            for val in map.values_mut() {
                normalize(val)?;
            }
        }
        Value::Array(items) => {
            for item in items.iter_mut() {
                normalize(item)?;
            }
        }
        _ => {}
    }
    Ok(())
}

/// 读取一个配方文件并交给 `f`。反序列化结果借用局部字符串, 因此只能在这一层内使用。
fn with_recipe<T>(path: &PathBuf, f: impl FnOnce(&str, Recipe<'_>) -> Result<T>) -> Result<T> {
    let text = fs::read_to_string(path).context("无法读取配方文件")?;
    let mut source: Value = serde_json::from_str(text.trim_end()).context("解析配方 JSON 失败")?;
    normalize(&mut source)?;
    let normalized = serde_json::to_string(&source).context("序列化配方失败")?;
    let parsed: Recipe = serde_json::from_str(&normalized).context("配方字段与结构不匹配")?;
    f(
        path.file_name()
            .unwrap()
            .to_str()
            .context("文件名不是 UTF-8")?,
        parsed,
    )
}

/// 同一种可分解物品常有多条官方配方, 这里只保留最省材料的那条:
/// 反转昂贵的路线会让玩家用便宜路线拿到物品、再按昂贵路线分解, 凭空造出物资。
struct Candidate {
    path: PathBuf,
    /// 输出文件名用不带扩展名的源文件名, 天然唯一
    stem: String,
    cost: u32,
    tag_inputs: u32,
    /// 产物清单(物品 id, 数量)。容器模式拿它决定"投入几个才换一份材料"
    products: Vec<(String, u32)>,
    /// 官方以 `_from_` 后缀命名的备用路线, 同等成本时排在最后
    alt_route: bool,
}

impl Candidate {
    /// 成本最低优先(反转贵路线会凭空造物资); 成本相同则优先带 tag 的通用路线,
    /// 因为战利品表能表达"任意一种木板", 而写死具体木材的备用路线会把玩家的橡木换成绯木。
    fn rank(&self) -> (u32, u32, bool, &str) {
        (
            self.cost,
            255 - self.tag_inputs.min(255),
            self.alt_route,
            &self.stem,
        )
    }
}

/// 返回该文件生成的候选; `Err(原因)` 表示不该为它生成分解配方。
fn inspect(path: &PathBuf, winners: &mut FxHashMap<String, Candidate>) -> Result<bool> {
    with_recipe(path, |filename, parsed| {
        let Some(component) = parsed.component else {
            bail!("非工作台配方");
        };
        if component.is_deprecated() {
            bail!("tags 含 deprecated");
        }
        let summary = component.summary();
        let candidate = Candidate {
            path: path.clone(),
            stem: filename.trim_end_matches(".json").to_owned(),
            cost: summary.cost,
            tag_inputs: summary.tag_inputs,
            products: summary.products,
            alt_route: filename.contains("_from_"),
        };
        match winners.get(&summary.signature) {
            None => {
                winners.insert(summary.signature, candidate);
                Ok(true)
            }
            Some(best) if candidate.rank() < best.rank() => {
                winners.insert(summary.signature, candidate);
                Ok(true)
            }
            Some(_) => bail!("被更省材料的同产物配方抢占"),
        }
    })
}

/// 容器模式需要的一份换算数据: 投入 batch 个物品, 换回一个 `table` 中介物。
#[derive(Serialize)]
struct IndexEntry {
    table: String,
    batch: u32,
}

/// 生成中介物 + 战利品表, 并把换算规则记进索引。
///
/// 不再产出反向配方: 分解走的是容器实体(输入格 -> 输出中介物), 不经合成台匹配。
fn emit(
    winner: &Candidate,
    intermediates: &mut FxHashSet<String>,
    index: &mut BTreeMap<String, IndexEntry>,
) -> Result<()> {
    let out = target_root();
    with_recipe(&winner.path, |_filename, parsed| {
        let component = parsed.component.context("非工作台配方")?;
        // 容器的输入格只能放一种物品, 多产物配方没法让玩家一次投入完整的一份
        let [(item, batch)] = winner.products.as_slice() else {
            bail!("产物多于一种, 单格输入摆不下");
        };
        // @minecraft/server 2.x 的 ItemStack 已经没有 data 属性, aux 变种在运行时无从分辨,
        // 留着只会让玩家拿到错的材料(banner@4 与 banner@9 会长得一模一样)
        if item.contains('@') {
            bail!("产物靠 aux 区分, 运行时无法分辨");
        }
        let (id, table) = component.inverse()?;
        let bare = id.trim_start_matches("mq_decrafting_item:");
        if !intermediates.insert(bare.to_owned()) {
            bail!("中介物 {bare} 与另一条配方撞名, 跳过");
        }
        let name = format!("{bare}.json");
        for (dir, content) in [
            (
                out.join("loot_tables/decrafting").join(&name),
                serde_json::to_string(&table)?,
            ),
            (
                out.join("items/decrafting").join(&name),
                ITEM_TEMPLATE.replace("$IDENTIFIER", bare),
            ),
        ] {
            fs::write(&dir, content).with_context(|| format!("写入 {} 失败", dir.display()))?;
        }
        index.insert(
            item.clone(),
            IndexEntry {
                table: bare.to_owned(),
                batch: *batch,
            },
        );
        Ok(())
    })
}

/// 清掉上一次生成的产物, 只保留 `.gitkeep` 之类的占位文件。
///
/// 生成器只覆盖同名文件, 不会删除旧文件: 官方语料里删掉某个配方后, 残留的旧分解配方会让
/// 该物品继续可分解; 一次运行里连续为多个版本生成时更会直接串数据。
fn clear_generated(dir: &std::path::Path) -> Result<()> {
    for entry in fs::read_dir(dir)
        .with_context(|| format!("读取输出目录失败: {}", dir.display()))?
        .filter_map(Result::ok)
    {
        let path = entry.path();
        if path.extension().map(|e| e == "json").unwrap_or(false) {
            fs::remove_file(&path)
                .with_context(|| format!("删除旧产物失败: {}", path.display()))?;
        }
    }
    Ok(())
}

fn main() -> Result<()> {
    let target = target_root();
    for dir in [
        "recipes/decrafting",
        "loot_tables/decrafting",
        "items/decrafting",
    ] {
        let path = target.join(dir);
        fs::create_dir_all(&path).context("创建输出目录失败")?;
        clear_generated(&path)?;
    }

    let source = recipes_dir()?;
    let mut files: Vec<PathBuf> = fs::read_dir(&source)
        .with_context(|| format!("读取源文件夹失败: {}", source.display()))?
        .filter_map(Result::ok)
        .map(|e| e.path())
        .filter(|p| p.extension().map(|e| e == "json").unwrap_or(false))
        .collect();
    // 目录枚举顺序在不同文件系统上不稳定, 先按文件名排序, 保证同一输入产出同一结果
    files.sort();

    let mut winners: FxHashMap<String, Candidate> = FxHashMap::default();
    let mut candidates = 0;
    let mut skipped: FxHashMap<String, u32> = FxHashMap::default();
    for path in &files {
        match inspect(path, &mut winners) {
            Ok(true) => candidates += 1,
            Ok(false) => {}
            Err(e) => {
                let reason = e.root_cause().to_string();
                *skipped.entry(reason).or_default() += 1;
            }
        }
    }

    let mut ordered: Vec<&Candidate> = winners.values().collect();
    ordered.sort_unstable_by_key(|c| c.stem.clone());
    let mut intermediates = FxHashSet::default();
    let mut index: BTreeMap<String, IndexEntry> = BTreeMap::new();
    let mut written = 0;
    for winner in &ordered {
        if let Err(e) = emit(winner, &mut intermediates, &mut index) {
            let reason = e.root_cause().to_string();
            *skipped.entry(reason).or_default() += 1;
        } else {
            written += 1;
        }
    }

    // 脚本读不到包里的 JSON, 这份索引交给 scripts/gen-index.mjs 转成 TS 再打进 main.js
    fs::write(
        target.join("decrafting_index.json"),
        serde_json::to_string(&index)?,
    )
    .context("写出索引失败")?;

    println!("读取源配方 {}", files.len());
    println!(
        "候选 {} 条 → 同产物去重后 {} 组 → 写出 {} 个中介物(含战利品表), 索引 {} 条",
        candidates,
        winners.len(),
        written,
        index.len()
    );
    let mut reasons: Vec<(&String, u32)> = skipped.iter().map(|(k, v)| (k, *v)).collect();
    reasons.sort_unstable_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(b.0)));
    println!("未生成 {} 类原因:", reasons.len());
    for (reason, n) in reasons {
        println!("  {n:>4}  {reason}");
    }
    Ok(())
}
