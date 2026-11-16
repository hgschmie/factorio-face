-- Scenario run headless by tools/catalog/generate.mjs via `factorio --test-scenario`. It writes the engine's finalised
-- view of every signal-capable prototype (defaults resolved, item weights computed, signal GUI flags derived) to
-- script-output/face-runtime-dump.json and ends the test on the first tick. For every prototype a wire connects to it also
-- writes what the entity table (tools/catalog/lib/entities.mjs) derives from data.raw or cannot find there, so that the
-- generator can check the table against the game: `circuit_entities`. What only an entity says, it builds one for.
--
-- Every prototype that becomes a record of the catalog or of the entity table says which mod created it (`created`), for the
-- single-set build (tools/catalog/lib/single.ts): one dump of a game with mods cannot tell otherwise. The generator of the
-- standard tables has its own, exact attribution from its module sets and does not read the field.

local function names(list)
  local out = {}
  for _, entry in pairs(list or {}) do out[#out + 1] = type(entry) == "string" and entry or entry.name end
  return out
end

-- The mod that created a prototype, `core` for the engine's own data; nil (so absent from the JSON) when the game does not
-- say. `type` is the prototype's own type ("ammo", "lamp", "planet"), not the kind it is listed under.
local function creator(type, name)
  local ok, history = pcall(prototypes.get_history, type, name)
  return ok and history.created or nil
end

local function base(proto)
  return {
    name = proto.name,
    type = proto.type,
    created = creator(proto.type, proto.name),
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

-- Fields only some prototype types have; reading one on another type may raise.
local OPTIONAL_FIELDS = { "two_direction_only", "turret_base_has_direction", "direction_count", "default_universe_channel" }
local DEFAULT_SIGNAL_FIELDS = {
  "default_output_signal", "default_empty_slots_signal", "default_temperature_signal", "default_fluid_temperature_signal", "default_stack_control_input_signal",
  "default_technology_level_signal", "default_recipe_finished_signal", "default_working_signal", "default_launched_signal",
  "default_red_signal", "default_green_signal", "default_blue_signal", "default_rgb_signal",
  "default_red_output_signal", "default_orange_output_signal", "default_green_output_signal", "default_blue_output_signal",
  "default_available_logistic_output_signal", "default_total_logistic_output_signal", "default_available_construction_output_signal",
  "default_total_construction_output_signal", "default_roboport_count_output_signal",
  "default_game_tick_output_signal", "default_day_tick_output_signal", "default_day_length_output_signal",
  "default_train_stopped_signal", "default_trains_count_signal", "default_trains_limit_signal", "default_priority_signal",
  "default_speed_signal", "default_damage_taken_signal",
}

-- The value of a field: false when the prototype has none, nil (so absent from the JSON) when the game does not let a script read it.
local function read(proto, field)
  local ok, value = pcall(function() return proto[field] end)
  if not ok then return nil end
  if value == nil then return false end
  return value
end

-- A wire distance for every quality, by quality name.
local function distances(get)
  local out = {}
  for name in pairs(prototypes.quality) do out[name] = get(name) end
  return out
end

-- The recipes with a fluid among their ingredients or products, by name.
local function fluid_recipes()
  local out = {}
  for name, recipe in pairs(prototypes.recipe) do
    local fluid = false
    for _, list in pairs({ recipe.ingredients, recipe.products }) do
      for _, entry in pairs(list) do fluid = fluid or entry.type == "fluid" end
    end
    if fluid then out[#out + 1] = name end
  end
  table.sort(out)
  return out
end

-- What only an entity says: whether it has a direction once it stands. `supports_direction` of the prototype is true for
-- every crafting machine; the entity's only while its fluid boxes are in use, which for some takes a recipe with a fluid
-- (`fluid_recipe`: the first one that gives it a direction), or when it is not square. Nil for a prototype that a script
-- cannot build on an empty surface.
local function built(surface, proto, recipes)
  local entity = surface.create_entity({ name = proto.name, position = { 0, 0 }, force = "player" })
  if not entity then return nil end
  local out = { supports_direction = entity.supports_direction }
  if not out.supports_direction and proto.type == "assembling-machine" then
    for _, recipe in pairs(recipes) do
      if pcall(entity.set_recipe, recipe) and entity.supports_direction then
        out.fluid_recipe = recipe
        break
      end
    end
  end
  entity.destroy()
  return out
end

local function circuit_entity(proto, surface, recipes)
  local flags = {}
  for flag in pairs(proto.flags) do flags[#flags + 1] = flag end
  table.sort(flags)
  local optional = {}
  for _, field in pairs(OPTIONAL_FIELDS) do optional[field] = read(proto, field) end
  -- Only what the game answers with a signal: for a type the field is not documented for, nil may mean "not readable" as well as "none".
  local signals = {}
  for _, field in pairs(DEFAULT_SIGNAL_FIELDS) do
    local value = read(proto, field)
    if type(value) == "table" and value.name then signals[field] = { type = value.type or "item", name = value.name } end
  end
  local ok, standing = pcall(built, surface, proto, recipes)
  if not ok then
    for _, entity in pairs(surface.find_entities()) do entity.destroy() end
  end
  local box = proto.selection_box
  return {
    name = proto.name,
    type = proto.type,
    supports_direction = proto.supports_direction,
    built = ok and standing or nil,
    tile_width = proto.tile_width,
    tile_height = proto.tile_height,
    selection_box = { box.left_top.x, box.left_top.y, box.right_bottom.x, box.right_bottom.y },
    flags = flags,
    circuit_wire_distance = distances(function(quality) return proto.get_max_circuit_wire_distance(quality) end),
    wire_distance = distances(function(quality) return proto.get_max_wire_distance(quality) end),
    optional = optional,
    default_signals = signals,
  }
end

-- Every entity prototype with a wire reach: circuit wires, or the copper wires of a pole and a power switch.
local function circuit_entities()
  local surface = game.create_surface("face-runtime-dump")
  surface.request_to_generate_chunks({ 0, 0 }, 3)
  surface.force_generate_chunk_requests()
  local recipes = fluid_recipes()
  local list = {}
  for _, proto in pairs(prototypes.entity) do
    if proto.get_max_circuit_wire_distance() > 0 or proto.get_max_wire_distance() > 0 then list[#list + 1] = circuit_entity(proto, surface, recipes) end
  end
  return list
end

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
    out.item_group[#out.item_group + 1] = { name = group.name, order = group.order, created = creator("item-group", group.name) }
  end
  out.item_subgroup = {}
  for _, subgroup in pairs(prototypes.item_subgroup) do
    out.item_subgroup[#out.item_subgroup + 1] = { name = subgroup.name, order = subgroup.order, group = subgroup.group.name, created = creator("item-subgroup", subgroup.name) }
  end
  out.utility_constants = { default_item_weight = prototypes.utility_constants.default_item_weight }
  out.rocket_silos = {}
  for _, silo in pairs(prototypes.get_entity_filtered({ { filter = "type", type = "rocket-silo" } })) do
    out.rocket_silos[#out.rocket_silos + 1] = { name = silo.name, lift_weight = silo.lift_weight, rocket_parts_required = silo.rocket_parts_required }
  end
  -- On its own: a failure here must not cost the catalog its dump. The generator reports the error.
  local ok, result = pcall(circuit_entities)
  if ok then out.circuit_entities = result else out.circuit_entities_error = tostring(result) end
  helpers.write_file("face-runtime-dump.json", helpers.table_to_json(out))
end

script.on_init(function()
  local ok, err = pcall(dump)
  if not ok then helpers.write_file("face-runtime-dump-error.txt", tostring(err)) end
  storage.passed = ok
end)

script.on_event(defines.events.on_tick, function() script.finish_test(storage.passed == true) end)
