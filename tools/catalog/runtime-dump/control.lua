-- Scenario run headless by tools/catalog/generate.mjs via `factorio --test-scenario`. It writes the engine's finalised
-- view of every signal-capable prototype (defaults resolved, item weights computed, signal GUI flags derived) to
-- script-output/face-runtime-dump.json and ends the test on the first tick.

local function names(list)
  local out = {}
  for _, entry in pairs(list or {}) do out[#out + 1] = type(entry) == "string" and entry or entry.name end
  return out
end

local function base(proto)
  return {
    name = proto.name,
    type = proto.type,
    order = proto.order,
    group = proto.group.name,
    subgroup = proto.subgroup.name,
    hidden = proto.hidden,
    parameter = proto.parameter,
  }
end

local function product(entry)
  return entry and { type = entry.type, name = entry.name } or nil
end

local extra = {
  item = function(proto, out)
    out.stack_size = proto.stack_size
    out.weight = proto.weight
  end,
  fluid = function() end,
  virtual_signal = function(proto, out) out.special = proto.special end,
  entity = function(proto, out) out.items_to_place_this = names(proto.items_to_place_this) end,
  recipe = function(proto, out)
    out.hide_from_signal_gui = proto.hide_from_signal_gui
    out.main_product = product(proto.main_product)
    out.products = {}
    for _, entry in pairs(proto.products) do out.products[#out.products + 1] = product(entry) end
  end,
  space_location = function() end,
  asteroid_chunk = function(proto, out)
    out.hide_from_signal_gui = proto.hide_from_signal_gui
    out.item_signal_alias = proto.item_signal_alias and proto.item_signal_alias.name or nil
  end,
  quality = function(proto, out)
    out.level = proto.level
    out.next = proto.next and proto.next.name or nil
    out.color = proto.color
  end,
}

local function dump()
  local out = { game_version = helpers.game_version, active_mods = script.active_mods, feature_flags = script.feature_flags }
  for kind, fill in pairs(extra) do
    local list = {}
    for _, proto in pairs(prototypes[kind]) do
      local entry = base(proto)
      fill(proto, entry)
      list[#list + 1] = entry
    end
    out[kind] = list
  end
  out.item_group = {}
  for _, group in pairs(prototypes.item_group) do
    out.item_group[#out.item_group + 1] = { name = group.name, order = group.order }
  end
  out.item_subgroup = {}
  for _, subgroup in pairs(prototypes.item_subgroup) do
    out.item_subgroup[#out.item_subgroup + 1] = { name = subgroup.name, order = subgroup.order, group = subgroup.group.name }
  end
  out.utility_constants = { default_item_weight = prototypes.utility_constants.default_item_weight }
  out.rocket_silos = {}
  for _, silo in pairs(prototypes.get_entity_filtered({ { filter = "type", type = "rocket-silo" } })) do
    out.rocket_silos[#out.rocket_silos + 1] = { name = silo.name, lift_weight = silo.lift_weight, rocket_parts_required = silo.rocket_parts_required }
  end
  helpers.write_file("face-runtime-dump.json", helpers.table_to_json(out))
end

script.on_init(function()
  local ok, err = pcall(dump)
  if not ok then helpers.write_file("face-runtime-dump-error.txt", tostring(err)) end
  storage.passed = ok
end)

script.on_event(defines.events.on_tick, function() script.finish_test(storage.passed == true) end)
