use anyhow::{bail, ensure, Context, Result};
use recipe::Recipe;
use rustc_hash::FxHashSet;
use std::fs::{self, DirEntry};
mod loot_table;
mod recipe;

#[global_allocator]
static GLOBAL: mimalloc::MiMalloc = mimalloc::MiMalloc;

const ITEM_TEMPLATE: &'static str = include_str!("item.json");
const TARGT: &'static str = "../pack/mq_decrafting_table_bp/";

static mut RESULT_ID: String = String::new();

fn process(entry: DirEntry, ids: &mut FxHashSet<String>) -> Result<()> {
    let path = entry.path();
    let filename = path.file_name().unwrap().to_str().unwrap();
    println!("读取配方文件: {}", filename);

    ensure!(!filename.contains("_from_"), "跳过_from_的配方");
    let s = fs::read_to_string(&path)
        .context("无法读取配方文件")?
        .trim_end()
        .to_owned();
    let source: Recipe = serde_json::from_str(&s).context("反序列化配方失败")?;
    match source.component {
        Some(component) => {
            println!("开始处理: {}", component.description.identifier);
            ensure!(
                !ids.contains(component.description.identifier.as_ref()),
                "跳过重复的配方"
            );

            ids.insert(component.description.identifier.clone().into_owned());
            ensure!(!component.is_deprecated(), "跳过弃用的配方");
            let result_id = component
                .description
                .identifier
                .to_string()
                .replace("minecraft:", "mq_decrafting_table:");
            unsafe { RESULT_ID.clear() };

            let (recipe, table) = component
                .inverse(&result_id, unsafe {
                    std::ptr::addr_of_mut!(RESULT_ID).as_mut().unwrap()
                })
                .context("生成配方失败")?;

            if let Some(recipe) = recipe {
                fs::write(
                    TARGT.to_owned() + "recipes/decrafting/" + filename,
                    serde_json::to_string(&recipe)?,
                )
                .context("写入配方失败")?;
            } else {
                bail!("无法生成配方");
            }

            if let Some(loot_table) = table {
                let c = serde_json::to_string(&loot_table)?;
                let id = unsafe { &RESULT_ID.get_unchecked(19..) };
                fs::write(
                    TARGT.to_owned() + "loot_tables/decrafting/" + id + ".json",
                    c,
                )
                .context("写入loot_table失败")?;

                fs::write(
                    TARGT.to_owned() + "items/decrafting/" + id + ".json",
                    ITEM_TEMPLATE.replace("$IDENTIFIER", id),
                )
                .context("写入item失败")?;
            }
        }
        None => {
            bail!("跳过其他配方");
        }
    }
    Ok(())
}

fn main() -> Result<()> {
    let source = fs::read_dir("../bedrock-samples")?
        .next()
        .unwrap()?
        .path()
        .join("behavior_pack/recipes");
    println!("读取源文件夹: {}", source.display());
    let mut ids: FxHashSet<String> = FxHashSet::default();
    for entry in fs::read_dir(&source).context("读取源文件夹失败")? {
        match process(entry?, &mut ids) {
            Ok(_) => {
                println!("处理成功");
            }
            Err(e) => {
                eprintln!("处理失败: {e}");
            }
        }
    }
    Ok(())
}
