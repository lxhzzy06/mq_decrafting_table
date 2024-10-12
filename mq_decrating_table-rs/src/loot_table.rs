use crate::recipe::{Ingredient, ItemStack, ItemTag, Key, Shaped};
use anyhow::{bail, Result};
use serde::Serialize;

#[derive(Serialize)]
struct SetCount<'a> {
    function: &'a str,
    count: u8,
}

impl<'a> SetCount<'a> {
    const fn new(count: u8) -> Self {
        Self {
            function: "set_count",
            count,
        }
    }
}

#[derive(Serialize)]
struct SetData<'a> {
    function: &'a str,
    data: u8,
}

impl<'a> SetData<'a> {
    const fn new(data: u8) -> Self {
        Self {
            function: "set_data",
            data,
        }
    }
}

#[derive(Serialize)]
#[serde(untagged)]
enum Function<'a> {
    #[serde(borrow)]
    SetCount(SetCount<'a>),
    #[serde(borrow)]
    SetData(SetData<'a>),
}

#[derive(Serialize)]
struct Entry<'a> {
    #[serde(rename = "type")]
    ty: &'a str,
    weight: u8,
    name: &'a str,
    functions: [Function<'a>; 2],
}

impl<'a> Entry<'a> {
    const fn new(name: &'a str, count: u8, data: u8) -> Self {
        Self {
            ty: "item",
            weight: 1,
            name,
            functions: [
                Function::SetCount(SetCount::new(count)),
                Function::SetData(SetData::new(data)),
            ],
        }
    }

    const fn from_item_stack(item_stack: ItemStack<'a>) -> Self {
        Self::new(
            item_stack.item,
            match item_stack.count {
                Some(c) => c,
                None => 1,
            },
            match item_stack.data {
                Some(d) => d,
                None => 0,
            },
        )
    }
}

#[derive(Serialize)]
pub struct Pool<'a> {
    rolls: u8,
    entries: Vec<Entry<'a>>,
}

macro_rules! build_entries {
    ($c:expr, $($elem:expr),+ $(,)?) => {{
        [$(
            Entry::new($elem, $c, 0)
        ),+]
    }};
}

impl<'a> Pool<'a> {
    const fn new(entries: Vec<Entry<'a>>) -> Self {
        Self { rolls: 1, entries }
    }

    fn from_item_tag(value: &ItemTag<'a>, count: u8) -> Result<Self> {
        Ok(Self {
            rolls: 1,
            entries: (match value.tag {
                "minecraft:planks" => build_entries!(
                    count,
                    "minecraft:oak_planks",
                    "minecraft:spruce_planks",
                    "minecraft:birch_planks",
                    "minecraft:jungle_planks",
                    "minecraft:acacia_planks",
                    "minecraft:dark_oak_planks",
                    "minecraft:mangrove_planks",
                    "minecraft:cherry_planks",
                    "minecraft:bamboo_planks",
                    "minecraft:crimson_planks",
                    "minecraft:warped_planks"
                )
                .into_iter()
                .collect(),

                "minecraft:wooden_slabs" => build_entries!(
                    count,
                    "minecraft:oak_slab",
                    "minecraft:spruce_slab",
                    "minecraft:birch_slab",
                    "minecraft:jungle_slab",
                    "minecraft:acacia_slab",
                    "minecraft:dark_oak_slab",
                    "minecraft:mangrove_slab",
                    "minecraft:cherry_slab",
                    "minecraft:bamboo_slab"
                )
                .into_iter()
                .collect(),

                "minecraft:stone_crafting_materials" | "minecraft:stone_tool_materials" => {
                    build_entries!(
                        count,
                        "minecraft:cobblestone",
                        "minecraft:cobbled_deepslate",
                        "minecraft:blackstone"
                    )
                    .into_iter()
                    .collect()
                }

                "minecraft:logs" => build_entries!(
                    count,
                    "minecraft:oak_wood",
                    "minecraft:stripped_oak_wood",
                    "minecraft:spruce_wood",
                    "minecraft:stripped_spruce_wood",
                    "minecraft:birch_wood",
                    "minecraft:stripped_birch_wood",
                    "minecraft:jungle_wood",
                    "minecraft:stripped_jungle_wood",
                    "minecraft:acacia_wood",
                    "minecraft:stripped_acacia_wood",
                    "minecraft:dark_oak_wood",
                    "minecraft:stripped_dark_oak_wood",
                    "minecraft:mangrove_wood",
                    "minecraft:stripped_mangrove_wood",
                    "minecraft:cherry_wood",
                    "minecraft:stripped_cherry_wood",
                    "minecraft:crimson_hyphae",
                    "minecraft:warped_hyphae",
                    "minecraft:stripped_crimson_hyphae",
                    "minecraft:stripped_warped_hyphae",
                    "minecraft:oak_log",
                    "minecraft:spruce_log",
                    "minecraft:birch_log",
                    "minecraft:jungle_log",
                    "minecraft:acacia_log",
                    "minecraft:dark_oak_log",
                    "minecraft:mangrove_log",
                    "minecraft:cherry_log",
                    "minecraft:crimson_stem",
                    "minecraft:warped_stem",
                    "minecraft:stripped_spruce_log",
                    "minecraft:stripped_birch_log",
                    "minecraft:stripped_jungle_log",
                    "minecraft:stripped_acacia_log",
                    "minecraft:stripped_dark_oak_log",
                    "minecraft:stripped_oak_log",
                    "minecraft:stripped_mangrove_log",
                    "minecraft:stripped_cherry_log",
                    "minecraft:stripped_crimson_stem",
                    "minecraft:stripped_warped_stem",
                    "minecraft:bamboo_block",
                    "minecraft:stripped_bamboo_block"
                )
                .into_iter()
                .collect(),

                "minecraft:coals" => build_entries!(count, "minecraft:coal", "minecraft:charcoal")
                    .into_iter()
                    .collect(),

                "minecraft:soul_fire_base_blocks" => {
                    build_entries!(count, "minecraft:soul_sand", "minecraft:soul_soil")
                        .into_iter()
                        .collect()
                }
                "minecraft:wool" => build_entries!(
                    count,
                    "minecraft:white_wool",
                    "minecraft:orange_wool",
                    "minecraft:magenta_wool",
                    "minecraft:light_blue_wool",
                    "minecraft:yellow_wool",
                    "minecraft:lime_wool",
                    "minecraft:pink_wool",
                    "minecraft:gray_wool",
                    "minecraft:light_gray_wool",
                    "minecraft:cyan_wool",
                    "minecraft:purple_wool",
                    "minecraft:blue_wool",
                    "minecraft:brown_wool",
                    "minecraft:green_wool",
                    "minecraft:red_wool",
                    "minecraft:black_wool"
                )
                .into_iter()
                .collect(),
                _ => bail!("不支持的的 Tag {}", value.tag),
            }),
        })
    }
}

impl<'a> From<ItemStack<'a>> for Pool<'a> {
    fn from(value: ItemStack<'a>) -> Self {
        Self::new(vec![Entry::from_item_stack(value)])
    }
}

#[derive(Serialize)]
pub struct LootTable<'a> {
    pools: Vec<Pool<'a>>,
}

impl<'a> LootTable<'a> {
    pub fn from_vec_ingredient(value: Vec<Ingredient<'a>>) -> Result<Self> {
        Ok(LootTable {
            pools: value.into_iter().try_fold(vec![], |mut acc, i| {
                acc.push(match i {
                    Ingredient::Item(item_stack) => item_stack.into(),
                    Ingredient::Tag(item_tag) => Pool::from_item_tag(&item_tag, 1)?,
                });
                Ok::<Vec<Pool<'_>>, anyhow::Error>(acc)
            })?,
        })
    }

    pub fn from_shaped(shaped: Shaped<'a>) -> Result<Self> {
        Ok(Self {
            pools: shaped
                .key
                .into_iter()
                .try_fold(vec![], |mut acc, (k, i)| {
                    let count = shaped
                        .pattern
                        .iter()
                        .map(|s| s.chars().filter(|&c| c == k).count())
                        .sum::<usize>() as u8;
                    acc.push(match i {
                        Key::Item(pair) => ItemStack {
                            item: pair.item,
                            data: pair.data,
                            count: Some(count),
                        }
                        .into(),
                        Key::Tag(item_tag) => Pool::from_item_tag(&item_tag, count)?,
                    });
                    Ok::<Vec<Pool<'_>>, anyhow::Error>(acc)
                })?
                .into_iter()
                .collect(),
        })
    }
}

impl<'a> From<&ItemTag<'a>> for Result<LootTable<'a>> {
    fn from(value: &ItemTag<'a>) -> Result<LootTable<'a>> {
        Ok(LootTable {
            pools: vec![Pool::from_item_tag(value, 1)?],
        })
    }
}
