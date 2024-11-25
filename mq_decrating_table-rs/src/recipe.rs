use crate::loot_table::LootTable;
use anyhow::{bail, Result};
use rustc_hash::FxHashMap;
use serde::{ser::SerializeStruct, Deserialize, Serialize, Serializer};
use serde_json::Value;
use std::{borrow::Cow, char};

const CHARS: [char; 9] = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'];
const BUCKET: &'static str = "minecraft:bucket";

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

#[derive(Serialize, Deserialize)]
#[serde(untagged)]
pub enum Key<'a> {
    #[serde(borrow)]
    Item(ItemPair<'a>),
    Tag(ItemTag<'a>),
}

impl<'a> Key<'a> {
    #[inline(always)]
    fn take_item(self) -> ItemPair<'a> {
        unsafe { (&self as *const Key as *const ItemPair).read() }
    }
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

impl<'a> ItemStack<'a> {
    const fn crate_mq(&self, id: &'a str) -> ItemStack<'a> {
        Self {
            item: id,
            data: self.data,
            count: self.count,
        }
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

impl<'a> Ingredient<'a> {
    #[inline(always)]
    fn take_item(self) -> ItemStack<'a> {
        unsafe { (&self as *const Ingredient as *const ItemStack).read() }
    }
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

#[inline(always)]
fn push_char(pattern: &mut Vec<String>, i: u8, ch: char, item: &ItemStack) -> Result<()> {
    unsafe {
        pattern.get_unchecked_mut(match i {
            0..=2 => 0,
            3..=5 => 1,
            6..=8 => 2,
            _ => bail!("物品 {item} 数量过多"),
        })
    }
    .push(ch);
    Ok(())
}

impl<'a> Shaped<'a> {
    #[inline(always)]
    fn create_pattern(item: ItemStack<'a>) -> Result<Vec<Cow<'a, str>>> {
        let mut pattern = vec!["".to_owned(); 3];
        for i in 0..item.count.unwrap_or(1) {
            push_char(&mut pattern, i, '#', &item)?;
        }
        Ok(pattern.into_iter().map(Cow::from).collect())
    }

    #[inline]
    fn inverse(self) -> Result<Shaped<'a>> {
        let mut vecs: Vec<ItemStack> = vec![];
        let mut results: Vec<ItemStack> = self
            .key
            .into_iter()
            .map(|(k, i)| {
                let pair = i.take_item();
                let count = self
                    .pattern
                    .iter()
                    .map(|s| s.chars().filter(|&c| c == k).count())
                    .sum::<usize>() as u8;
                match pair.item {
                    "minecraft:bucket" if count > 1 => {
                        for _ in 1..count {
                            vecs.push(ItemStack {
                                item: BUCKET,
                                data: pair.data,
                                count: None,
                            })
                        }
                        ItemStack {
                            count: None,
                            data: pair.data,
                            item: pair.item,
                        }
                    }
                    _ => ItemStack {
                        count: Some(count),
                        data: pair.data,
                        item: pair.item,
                    },
                }
            })
            .collect();
        results.extend(vecs.into_iter());
        Ok(match self.result {
            ItemStacks::Multiple(items) => {
                let mut pattern: Vec<String> = vec!["".to_owned(); 3];
                let mut key: FxHashMap<char, Key> = FxHashMap::default();
                for (mut i, item) in items.into_iter().enumerate() {
                    let char = unsafe { CHARS.get_unchecked(i) };
                    match item.item {
                        "minecraft:bucket" if item.count.is_some() => {
                            for c in 0..item.count.unwrap() {
                                i += c as usize;
                                push_char(&mut pattern, i as u8, *char, &item)?;
                            }
                        }
                        _ => {
                            push_char(&mut pattern, i as u8, *char, &item)?;
                        }
                    }
                    key.insert(
                        *char,
                        Key::Item(ItemPair {
                            item: item.item,
                            data: item.data,
                        }),
                    );
                }
                Self {
                    pattern: pattern.into_iter().map(Cow::from).collect(),
                    key,
                    result: ItemStacks::Multiple(results),
                }
            }
            ItemStacks::Single(item) => Shaped {
                key: FxHashMap::from_iter([('#', Key::Item(item.into()))]),
                pattern: Shaped::create_pattern(item)?,
                result: ItemStacks::Multiple(results),
            },
        })
    }
}

#[derive(Serialize, Deserialize)]
pub struct Shapeless<'a> {
    #[serde(borrow)]
    pub ingredients: Vec<Ingredient<'a>>,
    pub result: ItemStack<'a>,
}

impl<'a> Shapeless<'a> {
    #[inline]
    fn inverse(self) -> Result<Shaped<'a>> {
        Ok(Shaped {
            key: FxHashMap::from_iter([('#', Key::Item(self.result.into()))]),
            pattern: Shaped::create_pattern(self.result)?,
            result: ItemStacks::Multiple(
                self.ingredients
                    .into_iter()
                    .map(|i| i.take_item())
                    .collect(),
            ),
        })
    }

    pub const fn return_item(ingredients: Vec<Ingredient<'a>>, result: ItemStack<'a>) -> Self {
        Self {
            ingredients,
            result,
        }
    }
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
pub struct Unlock<'a> {
    context: &'a str,
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

#[inline(always)]
fn mq_decrafting_item(id: &str) -> String {
    if id.starts_with("minecraft:") {
        id.replace("minecraft:", "mq_decrafting_item:")
    } else {
        "mq_decrafting_item:".to_owned() + id
    }
}

impl<'a> RecipeComponent<'a> {
    #[inline(always)]
    pub fn new(id: &'a str, data: Data<'a>) -> Self {
        Self {
            description: Cow::Borrowed(id).into(),
            unlock: Some("AlwaysUnlocked".into()),
            tags: vec!["mq_decrafting_table"],
            data,
            priority: None,
        }
    }

    #[inline(always)]
    pub fn is_deprecated(&self) -> bool {
        self.tags.contains(&"deprecated")
    }

    #[inline]
    pub fn inverse(
        mut self,
        result_recipe_id: &'a str,
        result_item_id: &'a mut String,
    ) -> anyhow::Result<(Option<Recipe<'a>>, Option<LootTable<'a>>)> {
        self.description.identifier = Cow::Owned(result_recipe_id.to_owned());
        self.tags = vec!["mq_decrafting_table"];
        self.unlock = Some("AlwaysUnlocked".into());
        Ok(match self.data {
            Data::Shaped(shaped) => {
                if match &shaped.result {
                    ItemStacks::Single(item) => item.count.unwrap_or(1) > 9,
                    ItemStacks::Multiple(items) => {
                        items.iter().map(|item| item.count.unwrap_or(1)).sum::<u8>() > 9
                    }
                } {
                    println!("物品数量过多: {}", &shaped.result);
                    return Ok((None, None));
                }
                if shaped.key.values().any(
                    const {
                        |v: &Key| {
                            if let Key::Tag(_) = v {
                                true
                            } else {
                                false
                            }
                        }
                    },
                ) {
                    let itemstack: &ItemStack<'_> = shaped.result.take_item_or_first();
                    result_item_id.push_str(&mq_decrafting_item(itemstack.item));
                    (
                        Some(
                            RecipeComponent::new(
                                result_recipe_id,
                                Data::Shapeless(Shapeless::return_item(
                                    shaped.result.clone().into(),
                                    itemstack.crate_mq(result_item_id.as_str()),
                                )),
                            )
                            .into(),
                        ),
                        Some(LootTable::from_shaped(shaped)?),
                    )
                } else {
                    self.data = Data::Shaped(shaped.inverse()?);
                    (Some(self.into()), None)
                }
            }
            Data::Shapeless(shapeless) => {
                if shapeless.result.count.unwrap_or(1) > 9 {
                    return Ok((None, None));
                }
                if shapeless.ingredients.iter().any(
                    const {
                        |v: &Ingredient| {
                            if let Ingredient::Tag(_) = v {
                                true
                            } else {
                                false
                            }
                        }
                    },
                ) {
                    result_item_id.push_str(&mq_decrafting_item(shapeless.result.item));
                    (
                        Some(
                            RecipeComponent::new(
                                result_recipe_id,
                                Data::Shapeless(Shapeless::return_item(
                                    shapeless.result.into(),
                                    shapeless.result.crate_mq(result_item_id.as_str()),
                                )),
                            )
                            .into(),
                        ),
                        Some(LootTable::from_vec_ingredient(
                            shapeless.ingredients.clone(),
                        )?),
                    )
                } else {
                    self.data = Data::Shaped(shapeless.inverse()?);
                    (Some(self.into()), None)
                }
            }
        })
    }
}
