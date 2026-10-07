use crate::loot_table::LootTable;
use anyhow::Result;
use rustc_hash::FxHashMap;
use serde::{ser::SerializeStruct, Deserialize, Serialize, Serializer};
use serde_json::Value;
use std::{borrow::Cow, char};


impl<'a> From<ItemStack<'a>> for ItemPair<'a> {
    #[inline(always)]
    fn from(value: ItemStack<'a>) -> Self {
        Self {
            item: value.item,
            data: value.data,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Copy)]
pub struct ItemPair<'a> {
    pub item: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<u8>,
}

/// `Copy` 是为了能在不消费 `Shaped` 的前提下结算材料清单(`inverse_results`)
#[derive(Serialize, Deserialize, Clone, Copy)]
#[serde(untagged)]
pub enum Key<'a> {
    #[serde(borrow)]
    Item(ItemPair<'a>),
    Tag(ItemTag<'a>),
}


#[derive(Serialize, Deserialize, Clone, Copy)]
pub struct ItemStack<'a> {
    pub item: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub count: Option<u8>,
}

impl<'a> std::fmt::Display for ItemStack<'a> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.item)?;
        if let Some(data) = self.data {
            write!(f, ":{}", data)?;
        }
        if let Some(count) = self.count {
            write!(f, ":{}", count)?;
        }
        Ok(())
    }
}


impl<'a> From<&'a str> for ItemStack<'a> {
    #[inline(always)]
    fn from(value: &'a str) -> Self {
        ItemStack {
            item: value,
            data: None,
            count: None,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Copy)]
pub struct ItemTag<'a> {
    pub tag: &'a str,
}

#[derive(Serialize, Deserialize, Clone, Copy)]
#[serde(untagged)]
pub enum Ingredient<'a> {
    #[serde(borrow)]
    Item(ItemStack<'a>),
    #[serde(borrow)]
    Tag(ItemTag<'a>),
}


impl<'a> From<ItemStack<'a>> for Vec<Ingredient<'a>> {
    #[inline(always)]
    fn from(value: ItemStack<'a>) -> Self {
        vec![Ingredient::Item(value)]
    }
}

impl<'a> From<ItemStacks<'a>> for Vec<Ingredient<'a>> {
    #[inline(always)]
    fn from(value: ItemStacks<'a>) -> Self {
        match value {
            ItemStacks::Single(i) => vec![Ingredient::Item(i)],
            ItemStacks::Multiple(is) => is.into_iter().map(|i| Ingredient::Item(i)).collect(),
        }
    }
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(untagged)]
pub enum ItemStacks<'a> {
    #[serde(borrow)]
    Single(ItemStack<'a>),
    #[serde(borrow)]
    Multiple(Vec<ItemStack<'a>>),
}

impl<'a> std::fmt::Display for ItemStacks<'a> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ItemStacks::Single(item_stack) => write!(f, "{item_stack}")?,
            ItemStacks::Multiple(vec) => {
                for (i, item_stack) in vec.iter().enumerate() {
                    if i > 0 {
                        write!(f, ", ")?;
                    }
                    write!(f, "{item_stack}")?;
                }
            }
        }
        Ok(())
    }
}

impl<'a> ItemStacks<'a> {
    #[inline(always)]
    fn take_item_or_first(&self) -> &ItemStack<'a> {
        match self {
            ItemStacks::Single(i) => i,
            ItemStacks::Multiple(is) => unsafe { is.get_unchecked(0) },
        }
    }

}

#[derive(Deserialize, Serialize)]
pub struct Description<'a> {
    #[serde(borrow)]
    pub identifier: Cow<'a, str>,
}

impl<'a> From<Cow<'a, str>> for Description<'a> {
    #[inline(always)]
    fn from(value: Cow<'a, str>) -> Self {
        Description { identifier: value }
    }
}

#[derive(Serialize, Deserialize)]
pub struct Shaped<'a> {
    pub pattern: Vec<Cow<'a, str>>,
    #[serde(borrow)]
    pub key: FxHashMap<char, Key<'a>>,
    #[serde(borrow)]
    pub result: ItemStacks<'a>,
}


#[derive(Serialize, Deserialize)]
pub struct Shapeless<'a> {
    #[serde(borrow)]
    pub ingredients: Vec<Ingredient<'a>>,
    /// 官方 schema 允许 shapeless 的产物写成数组, 只是原版从未使用; 多于一种材料时必须用数组
    #[serde(borrow)]
    pub result: ItemStacks<'a>,
}


#[derive(Serialize, Deserialize)]
#[serde(untagged)]
pub enum Data<'a> {
    #[serde(borrow)]
    Shaped(Shaped<'a>),
    #[serde(borrow)]
    Shapeless(Shapeless<'a>),
}


#[derive(Serialize, Deserialize)]
pub struct RecipeComponent<'a> {
    pub description: Description<'a>,
    #[serde(skip_deserializing)]
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(serialize_with = "serialize_unlock")]
    pub unlock: Option<Value>,
    pub tags: Vec<&'a str>,
    #[serde(borrow)]
    #[serde(flatten)]
    pub data: Data<'a>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub priority: Option<i8>,
}

fn serialize_unlock<S>(unlock: &Option<Value>, serializer: S) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    match unlock {
        Some(value) => {
            if let Value::String(s) = value {
                let mut unlock = serializer.serialize_struct("Unlock", 1)?;
                unlock.serialize_field("context", s.as_str())?;
                unlock.end()
            } else {
                return Err(serde::ser::Error::custom(format!(
                    "Unlock必须为字符串: {}",
                    value
                )));
            }
        }
        None => {
            return Err(serde::ser::Error::custom("Unlock必须为字符串: None"));
        }
    }
}

#[derive(Deserialize)]
pub struct Recipe<'a> {
    #[serde(skip_deserializing)]
    pub format_version: &'a str,
    #[serde(borrow)]
    #[serde(rename = "minecraft:recipe_shaped")]
    #[serde(alias = "minecraft:recipe_shapeless")]
    pub component: Option<RecipeComponent<'a>>,
}

impl<'a> Serialize for Recipe<'a> {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let mut recipe = serializer.serialize_struct("Recipe", 2)?;
        recipe.serialize_field("format_version", &self.format_version)?;
        match &self.component {
            Some(component) => {
                recipe.serialize_field(
                    match component.data {
                        Data::Shaped(_) => "minecraft:recipe_shaped",
                        Data::Shapeless(_) => "minecraft:recipe_shapeless",
                    },
                    &self.component,
                )?;
            }
            None => {}
        };
        recipe.end()
    }
}

impl<'a> From<RecipeComponent<'a>> for Recipe<'a> {
    #[inline(always)]
    fn from(value: RecipeComponent<'a>) -> Self {
        Self {
            format_version: "1.21.10",
            component: Some(value),
        }
    }
}

/// 中介物的物品 id。原版用 aux 区分变种 (`suspicious_stew@7` 与 `suspicious_stew@9` 是不同汤),
/// 而中介物是新物品没有 aux, 所以把 aux 编进 id 尾巴, 否则同一基础名的多个变种会抢同一张战利品表。
fn mq_decrafting_item(id: &str, data: Option<u8>) -> String {
    let base = id.strip_prefix("minecraft:").unwrap_or(id);
    match data {
        Some(d) if d != 0 => format!("mq_decrafting_item:{base}_{d}"),
        _ => format!("mq_decrafting_item:{base}"),
    }
}

/// 供选择路线使用的配方摘要
pub struct Summary {
    /// 正向配方的材料总数。反转成本最低的路线, 才能保证分解不会凭空造出物资。
    pub cost: u32,
    /// 其中来自 tag 的输入个数, 越少返还越确定。
    pub tag_inputs: u32,
    /// 原配方的产物清单(物品 id 带 aux, 数量)。容器模式拿它决定中介物 id 与"一批多少个"。
    pub products: Vec<(String, u32)>,
    /// 产物是哪几种物品。同一物品的多种配方只保留最省材料的那条, 所以签名里**不带**数量。
    pub signature: String,
}

impl<'a> RecipeComponent<'a> {
    pub fn summary(&self) -> Summary {
        // 签名里的物品必须带上 aux: 原版用 `banner@4`/`suspicious_stew@7` 这类写法表达不同物品,
        // 去掉 aux 会把它们误判成同一个可分解物品而互相吞掉。
        let mut out: Vec<(String, u32)> = Vec::new();
        let mut push = |item: &str, data: Option<u8>, count: u32| {
            out.push((
                match data {
                    Some(d) if d != 0 => format!("{item}@{d}"),
                    _ => item.to_owned(),
                },
                count,
            ))
        };
        let (cost, tag_inputs) = match &self.data {
            Data::Shaped(s) => {
                let mut cost = 0;
                let mut tags = 0;
                for line in &s.pattern {
                    for ch in line.chars() {
                        match s.key.get(&ch) {
                            Some(Key::Item(_)) => cost += 1,
                            Some(Key::Tag(_)) => {
                                cost += 1;
                                tags += 1;
                            }
                            None => {}
                        }
                    }
                }
                match &s.result {
                    ItemStacks::Single(i) => push(i.item, i.data, i.count.unwrap_or(1) as u32),
                    ItemStacks::Multiple(v) => {
                        for i in v {
                            push(i.item, i.data, i.count.unwrap_or(1) as u32)
                        }
                    }
                }
                (cost, tags)
            }
            Data::Shapeless(s) => {
                let mut cost = 0;
                let mut tags = 0;
                for i in &s.ingredients {
                    match i {
                        Ingredient::Item(_) => cost += 1,
                        Ingredient::Tag(_) => {
                            cost += 1;
                            tags += 1;
                        }
                    }
                }
                match &s.result {
                    ItemStacks::Single(i) => push(i.item, i.data, i.count.unwrap_or(1) as u32),
                    ItemStacks::Multiple(v) => {
                        for i in v {
                            push(i.item, i.data, i.count.unwrap_or(1) as u32)
                        }
                    }
                }
                (cost, tags)
            }
        };
        out.sort_unstable();
        Summary {
            cost,
            tag_inputs,
            // 不带数量: 16 个一批和 8 个一批是同一种物品的两条路线, 必须在这里就合并掉,
            // 否则两条都会进 winners, 最后靠中介物撞名随机留一条(按文件名, 不是按成本)
            signature: out
                .iter()
                .map(|(i, _)| i.clone())
                .collect::<Vec<_>>()
                .join("+"),
            products: out,
        }
    }


    #[inline(always)]
    pub fn is_deprecated(&self) -> bool {
        self.tags.contains(&"deprecated")
    }

    /// 反转: 不产出配方, 只给出中介物 id 与它对应的战利品表。
    ///
    /// 分解已经不走合成台的配方匹配了 —— 容器实体直接把整批物品换成中介物,
    /// 背包侧再按数量逐个掷战利品表还原材料。于是 9 格上限、shapeless 的 count 按格计、
    /// 缩批撞形这些约束全部失效, 所有路线都能用同一套结构表达, 不再需要分情况讨论。
    #[inline]
    pub fn inverse(self) -> anyhow::Result<(String, LootTable<'a>)> {
        let (first, table) = match self.data {
            Data::Shaped(shaped) => {
                let item = *shaped.result.take_item_or_first();
                (item, LootTable::from_shaped(shaped)?)
            }
            Data::Shapeless(shapeless) => {
                let item = *shapeless.result.take_item_or_first();
                (item, LootTable::from_vec_ingredient(shapeless.ingredients)?)
            }
        };
        Ok((mq_decrafting_item(first.item, first.data), table))
    }
}
