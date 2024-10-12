use crate::item_stack;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum FurnaceItem {
    Id(String),
    Item(item_stack::ItemStack),
    Tag(item_stack::ItemTag),
}

#[derive(Debug, Deserialize)]
struct RecipeFurnace {
    input: FurnaceItem,
    output: FurnaceItem,
    tags: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct Furnace {
    #[serde(rename = "minecraft:recipe_furnace")]
    recipe_furnace: RecipeFurnace,
}
