import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { MARKER_MAX as EXP_MARKER_MAX, LAYOUT_KEY, INPUT_SLOT, OUTPUT_SLOT } from './bp/scripts/marker.js';

const production = process.argv.includes('--production');
const protocolSource = production ? await readFile(new URL('../src/ui-marker.ts', import.meta.url), 'utf8') : '';
const MARKER_MAX = production ? Number(protocolSource.match(/UI_MARKER_MAX = (\d+);/)[1]) : EXP_MARKER_MAX;
if (production && (Number(protocolSource.match(/UI_LAYOUT_KEY = (\d+);/)[1]) !== LAYOUT_KEY
  || Number(protocolSource.match(/INPUT_SLOT = (\d+);/)[1]) !== INPUT_SLOT
  || Number(protocolSource.match(/OUTPUT_SLOT = (\d+);/)[1]) !== OUTPUT_SLOT)) {
  throw new Error('Production allocation differs from this UI generator');
}
const title = production ? 'mqdt.ui.title' : 'MQDT MARKER OK';

// All expressions are literal: variables in inserted view bindings are not reliable.
const match = `((#mqdt_identity = ${MARKER_MAX}) and (#mqdt_layout = ${LAYOUT_KEY}))`;
const bindings = visible => [
  { binding_type: 'collection_details', binding_collection_name: 'container_items' },
  { binding_name: '#item_durability_total_amount', binding_name_override: '#mqdt_identity',
    binding_type: 'collection', binding_collection_name: 'container_items' },
  { binding_name: '#item_durability_current_amount', binding_name_override: '#mqdt_layout',
    binding_type: 'collection', binding_collection_name: 'container_items' },
  { binding_type: 'view', source_property_name: visible ? match : `(not ${match})`,
    target_property_name: '#visible' },
];
const insert = (array_name, value) => ({ modifications: [{ array_name, operation: 'insert_back', value }] });
const host = (gate, index = 0) => ({
  type: 'stack_panel', orientation: 'vertical', size: ['100%', '100%'],
  collection_name: 'container_items', controls: [{ [`gate@${gate}`]: { collection_index: index } }],
});
const slotHost = (index, pocket = false) => ({
  type: 'stack_panel', orientation: 'vertical', collection_name: 'container_items',
  size: pocket ? [26, 26] : [18, 18],
  controls: [{ [`cell@mqdt_exp.${pocket ? 'pocket_slot_cell' : 'slot_cell'}`]: { collection_index: index } }],
});
const top = { anchor_from: 'top_middle', anchor_to: 'top_middle' };
const desktop = {
  namespace: 'mqdt_exp',
  slot_cell: { type: 'panel', size: ['100%', '100%'],
    controls: [{ 'item@common.container_item': { $item_collection_name: 'container_items' } }] },
  pocket_slot_cell: { type: 'panel', size: ['100%', '100%'],
    controls: [{ 'item@common.pocket_ui_container_item': { $item_collection_name: 'container_items' } }] },
  input_host: slotHost(INPUT_SLOT), output_host: slotHost(OUTPUT_SLOT),
  pocket_input_host: slotHost(INPUT_SLOT, true), pocket_output_host: slotHost(OUTPUT_SLOT, true),
  marker_host: host('mqdt_exp.marker_gate'),
  marker_gate: {
    type: 'panel', size: ['100%', '100%'], bindings: bindings(true),
    controls: [
      { title: { type: 'label', text: title, localize: production,
        size: ['90%', 10], color: production ? [0.3, 0.3, 0.3] : [0.05, 0.5, 0.05], ...top, offset: [0, 0], layer: 2 } },
      { 'input@mqdt_exp.input_host': { ...top, offset: [-28, 20] } },
      { 'output@mqdt_exp.output_host': { ...top, offset: [28, 20] } },
      { arrow: { type: 'image', texture: 'textures/ui/arrow', size: [22, 15],
        ...top, offset: [0, 22], layer: 2 } },
    ],
  },
  pocket_root: { type: 'panel', size: ['100%', '100%'], controls: [
    { 'vanilla@mqdt_exp.pocket_vanilla_host': {} }, { 'mqdt@mqdt_exp.pocket_marker_host': {} },
  ] },
  pocket_vanilla_host: host('mqdt_exp.pocket_vanilla_gate'),
  pocket_vanilla_gate: { type: 'panel', size: ['100%', '100%'], bindings: bindings(false),
    controls: [{ 'vanilla@pocket_containers.data_driven_container_panel': {} }] },
  pocket_marker_host: host('mqdt_exp.pocket_marker_gate'),
  pocket_marker_gate: { type: 'panel', size: ['100%', '100%'], bindings: bindings(true),
    controls: [{ 'mqdt@pocket_containers.mqdt_marker_panel': {} }] },
};
const patch = {
  namespace: 'data_driven_container',
  container_label: insert('bindings', bindings(false)),
  item_grid: insert('bindings', bindings(false)),
  panel_top_half: insert('controls', [{ 'mqdt@mqdt_exp.marker_host': {} }]),
  // The screen inherits controls from common. Inserting here would shadow those controls.
  // Change only its profile routing, following the framework's measured host implementation.
  'screen@common.inventory_screen_common': {
    '$close_on_player_hurt|default': true, '$use_custom_pocket_toast|default': false,
    close_on_player_hurt: '$close_on_player_hurt', use_custom_pocket_toast: '$use_custom_pocket_toast',
    variables: [
      { requires: '$desktop_screen', $screen_content: 'data_driven_container.desktop_panel',
        $screen_bg_content: 'common.screen_background', $screen_background_alpha: 0.4 },
      { requires: '$pocket_screen', $use_custom_pocket_toast: true, $screen_content: 'mqdt_exp.pocket_root' },
    ],
  },
};
const pocket = {
  namespace: 'pocket_containers',
  mqdt_marker_panel: {
    type: 'panel', '$container_title': title, '$localize_title': production,
    controls: [
      { 'helpers@common.container_gamepad_helpers': { layer: 3 } },
      { 'header@pocket_containers.header_area': { layer: 2 } },
      { 'bg@pocket_containers.background_panel': { layer: 0 } },
      { 'inventory@pocket_containers.half_screen': {
        '$container_size': 36, '$pane_collection': 'combined_hotbar_and_inventory_items' } },
      { 'container@pocket_containers.mqdt_marker_half': {} },
      { 'details@common.selected_item_details_factory': {} },
      { 'lock_notice@common.item_lock_notification_factory': { '$offset': [0, '85%'] } },
      { 'cursor@common.gamepad_cursor_button': {} },
      { 'selected@common.inventory_selected_icon_button': {} },
      { 'hold@common.inventory_take_progress_icon_button': {} },
      { 'flying@common.flying_item_renderer': { layer: 12 } },
    ],
  },
  mqdt_marker_half: {
    type: 'panel', size: ['50%', '100%-27px'], offset: [0, 27],
    anchor_from: 'top_right', anchor_to: 'top_right',
    controls: [
      { 'input@mqdt_exp.pocket_input_host': { ...top, offset: [-40, 32] } },
      { 'output@mqdt_exp.pocket_output_host': { ...top, offset: [40, 32] } },
      { arrow: { type: 'image', texture: 'textures/ui/arrow', size: [22, 15],
        ...top, offset: [0, 38], layer: 2 } },
    ],
  },
};
const dir = new URL(production ? '../pack/mq_decrafting_table_rp/ui/' : './rp/ui/', import.meta.url);
await mkdir(dir, { recursive: true });
for (const [file, document] of Object.entries({
  'mqdt_exp_screen.json': desktop,
  'data_driven_container_screen.json': patch,
  'mqdt_exp_pocket.json': pocket,
  '_ui_defs.json': { ui_defs: ['ui/mqdt_exp_screen.json', 'ui/mqdt_exp_pocket.json'] },
})) {
  const name = production ? file.replaceAll('mqdt_exp', 'mqdt') : file;
  const body = JSON.stringify(document, null, 2);
  await writeFile(new URL(name, dir), (production ? body.replaceAll('mqdt_exp', 'mqdt') : body) + '\n');
}
console.log('Generated marker UI: protocol=' + MARKER_MAX + ', layout=' + LAYOUT_KEY);
