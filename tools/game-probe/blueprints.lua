-- Scenario run headless by tools/game-probe/blueprints.mjs via `factorio --test-scenario`. The tool puts one line in front of
-- this file that defines CASES_JSON: the cases of tools/game-probe/lib/blueprintCases.ts as JSON. For every case the game
--   1. imports the blueprint string this project exported and exports it again (what its own parser kept of it),
--   2. builds that blueprint, revives the ghosts, and exports a new blueprint of what stands there,
--   3. builds the same circuit from the runtime API alone, without a blueprint of ours, and exports that.
-- It also exports every supported entity as it is placed, untouched, and records the numbers behind the defines a blueprint uses,
-- those of the enums of the generic entities among them.
-- Everything goes to script-output/face-blueprints.json. A step that fails is recorded with its error and the rest goes on.

local OUTPUT = "face-blueprints.json"
local ERROR_OUTPUT = "face-blueprints-error.txt"
local HALF = 64
local AREA = { { -HALF, -HALF }, { HALF, HALF } }
-- Every prototype of the editor: the ten with a kind of their own, then the generic ones (the entity table of packages/model).
local FRESH = {
  "constant-combinator", "arithmetic-combinator", "decider-combinator", "selector-combinator", "small-lamp", "small-electric-pole", "medium-electric-pole", "big-electric-pole",
  "substation", "programmable-speaker", "accumulator", "active-provider-chest", "agricultural-tower", "artillery-turret", "assembling-machine-1", "assembling-machine-2",
  "assembling-machine-3", "asteroid-collector", "big-mining-drill", "biochamber", "biolab", "blue-chest", "boiler", "bottomless-chest", "buffer-chest", "bulk-inserter", "burner-inserter",
  "burner-mining-drill", "cargo-landing-pad", "centrifuge", "chemical-plant", "crash-site-chest-1", "crash-site-chest-2", "crusher", "cryogenic-plant", "display-panel", "electric-furnace",
  "electric-mining-drill", "electromagnetic-plant", "express-loader", "express-splitter", "express-transport-belt", "fast-inserter", "fast-loader", "fast-splitter", "fast-transport-belt",
  "flamethrower-turret", "foundry", "gun-turret", "heat-exchanger", "heat-pipe", "heating-tower", "infinity-chest", "infinity-pipe", "inserter", "iron-chest", "lab", "land-mine",
  "laser-turret", "linked-chest", "loader", "long-handed-inserter", "nuclear-reactor", "offshore-pump", "oil-refinery", "passive-provider-chest", "pipe", "pipe-to-ground", "power-switch",
  "proxy-container", "pump", "pumpjack", "radar", "rail-chain-signal", "rail-signal", "railgun-turret", "recycler", "red-chest", "requester-chest", "roboport", "rocket-silo",
  "rocket-turret", "space-platform-hub", "splitter", "stack-inserter", "steel-chest", "steel-furnace", "stone-furnace", "stone-wall", "storage-chest", "storage-tank", "tesla-turret",
  "train-stop", "transport-belt", "turbo-loader", "turbo-splitter", "turbo-transport-belt", "wooden-chest",
}
-- Each fresh entity has a cell of this many tiles to itself (the rocket silo covers nine), this many cells to a row.
local FRESH_CELL = 10
local FRESH_COLUMNS = 12
-- The enums of the generic entities, by the name the recording has them under.
local ENUM_DEFINES = {
  inserter_hand_read_mode = { "inserter", "hand_read_mode" },
  mining_drill_resource_read_mode = { "mining_drill", "resource_read_mode" },
  transport_belt_content_read_mode = { "transport_belt", "content_read_mode" },
  radar_mode = { "radar", "mode" },
  roboport_read_items_mode = { "roboport", "read_items_mode" },
  rocket_silo_read_mode = { "rocket_silo", "read_mode" },
  single_fluid_box_exclusive_mode = { "single_fluid_box", "exclusive_mode" },
}
local LAMP_SIGNALS = { "red_signal", "green_signal", "blue_signal", "rgb_signal" }

-- A flat floor without anything on it, so that every ghost can be revived.
local function prepare(surface)
  surface.request_to_generate_chunks({ 0, 0 }, 3)
  surface.force_generate_chunk_requests()
  local tiles = {}
  for x = -HALF - 8, HALF + 7 do
    for y = -HALF - 8, HALF + 7 do tiles[#tiles + 1] = { name = "refined-concrete", position = { x, y } } end
  end
  surface.set_tiles(tiles)
end

local function clear(surface)
  for _, entity in pairs(surface.find_entities()) do
    if entity.valid then entity.destroy() end
  end
end

-- The blueprint string of everything that stands in the area.
local function blueprint_of(surface, stack)
  stack.set_stack({ name = "blueprint" })
  stack.create_blueprint({ surface = surface, force = "player", area = AREA })
  if not stack.is_blueprint_setup() then error("the game made an empty blueprint") end
  return stack.export_stack()
end

local function set_constant(entity, spec)
  local behavior = entity.get_or_create_control_behavior()
  -- A new constant combinator may come with a section; the case says exactly which sections there are.
  for index = behavior.sections_count, 1, -1 do behavior.remove_section(index) end
  for _, wanted in ipairs(spec.sections) do
    local section = behavior.add_section(wanted.group)
    if not section then error("the game added no section") end
    for slot, filter in ipairs(wanted.filters) do section.set_slot(slot, filter) end
    section.multiplier = wanted.multiplier
    section.active = wanted.active
  end
  behavior.enabled = spec.enabled
end

local function set_lamp(entity, spec)
  entity.always_on = spec.always_on
  if spec.color then entity.color = spec.color end
  local wanted = spec.behavior
  if not wanted then return end
  local behavior = entity.get_or_create_control_behavior()
  if wanted.input_networks then behavior.input_networks = wanted.input_networks end
  if wanted.circuit_enabled then behavior.circuit_enable_disable = true end
  if wanted.circuit_condition then behavior.circuit_condition = wanted.circuit_condition end
  if wanted.use_colors then behavior.use_colors = true end
  behavior.color_mode = defines.control_behavior.lamp.color_mode[wanted.color_mode]
  for _, key in ipairs(LAMP_SIGNALS) do
    if wanted[key] then behavior[key] = wanted[key] end
  end
end

local function set_speaker(entity, spec)
  entity.parameters = spec.parameters
  entity.alert_parameters = spec.alert_parameters
  if not spec.behavior then return end
  local behavior = entity.get_or_create_control_behavior()
  behavior.circuit_condition = spec.behavior.circuit_condition
  behavior.circuit_parameters = spec.behavior.circuit_parameters
end

-- A generic entity: every setting is an attribute of its control behaviour, an enum a member of defines.control_behavior.
local function set_behavior(entity, assignments)
  local behavior = entity.get_or_create_control_behavior()
  if not behavior then error("no control behaviour") end
  for _, assignment in ipairs(assignments) do
    local value = assignment.value
    if assignment.define then
      value = defines.control_behavior
      for _, key in ipairs(assignment.define) do value = value[key] end
    end
    local ok, err = pcall(function() behavior[assignment.attribute] = value end)
    if not ok then error(assignment.attribute .. ": " .. tostring(err)) end
  end
end

-- One entity of a case, placed and set through the runtime API.
local function build_native(surface, spec)
  local direction = spec.direction and defines.direction[spec.direction] or nil
  local entity = surface.create_entity({ name = spec.name, position = spec.position, direction = direction, force = "player" })
  if not entity then error("cannot place " .. spec.name) end
  if spec.description then entity.combinator_description = spec.description end
  if spec.constant then set_constant(entity, spec.constant) end
  if spec.parameters then entity.get_or_create_control_behavior().parameters = spec.parameters end
  if spec.lamp then set_lamp(entity, spec.lamp) end
  if spec.speaker then set_speaker(entity, spec.speaker) end
  if spec.behavior then set_behavior(entity, spec.behavior) end
  return entity
end

local function record_case(surface, case)
  local out = { label = case.label, sent = case.string, errors = {} }
  local function step(name, action)
    local ok, err = pcall(action)
    if not ok then out.errors[#out.errors + 1] = name .. ": " .. tostring(err) end
  end
  local inventory = game.create_inventory(2)

  step("import", function()
    out.import_result = inventory[1].import_stack(case.string)
    out.reexported = inventory[1].export_stack()
  end)

  clear(surface)
  step("build", function()
    local ghosts = inventory[1].build_blueprint({ surface = surface, force = "player", position = { 0, 0 }, build_mode = defines.build_mode.forced })
    out.ghosts = #ghosts
    out.revived = 0
    for _, ghost in pairs(ghosts) do
      if ghost.valid and ghost.type == "entity-ghost" then
        local _, revived = ghost.revive()
        if revived then out.revived = out.revived + 1 end
      end
    end
    out.rebuilt = blueprint_of(surface, inventory[2])
  end)

  clear(surface)
  step("native", function()
    local built = {}
    for index, spec in ipairs(case.entities) do
      local ok, result = pcall(build_native, surface, spec)
      if not ok then error("entity " .. index .. " (" .. spec.name .. "): " .. tostring(result)) end
      built[index] = result
    end
    for _, wire in ipairs(case.wires) do
      local from = built[wire[1]].get_wire_connector(defines.wire_connector_id[wire[2]], true)
      local to = built[wire[3]].get_wire_connector(defines.wire_connector_id[wire[4]], true)
      if not from.connect_to(to, false) then error("no wire from entity " .. wire[1] .. " " .. wire[2] .. " to entity " .. wire[3] .. " " .. wire[4]) end
    end
    out.native = blueprint_of(surface, inventory[2])
  end)

  clear(surface)
  inventory.destroy()
  return out
end

-- Every supported entity as the game places it, each on a cell of its own. `touch` also gives each its control behaviour, as a
-- first wire does. A prototype the game does not place here (it wants rails, water or a space platform under it) is left out;
-- the tests of packages/blueprints name the ones that are missing from the recording.
local function record_fresh(surface, touch)
  clear(surface)
  for index, name in ipairs(FRESH) do
    local proto = prototypes.entity[name]
    if proto then
      local column, row = (index - 1) % FRESH_COLUMNS, math.floor((index - 1) / FRESH_COLUMNS)
      local position = { x = (column - FRESH_COLUMNS / 2) * FRESH_CELL + proto.tile_width / 2, y = (row - 5) * FRESH_CELL + proto.tile_height / 2 }
      local ok, entity = pcall(surface.create_entity, { name = name, position = position, force = "player" })
      if ok and entity and touch then pcall(entity.get_or_create_control_behavior) end
    end
  end
  local inventory = game.create_inventory(1)
  local text = blueprint_of(surface, inventory[1])
  inventory.destroy()
  clear(surface)
  return text
end

local function numbers(values)
  local out = {}
  for name, value in pairs(values) do out[name] = value end
  return out
end

local function run()
  local cases = helpers.json_to_table(CASES_JSON)
  local surface = game.create_surface("face-blueprints")
  prepare(surface)
  local out = {
    game_version = helpers.game_version,
    active_mods = script.active_mods,
    defines = {
      direction = numbers(defines.direction),
      wire_connector_id = numbers(defines.wire_connector_id),
      wire_type = numbers(defines.wire_type),
      lamp_color_mode = numbers(defines.control_behavior.lamp.color_mode),
    },
    fresh = {},
    cases = {},
  }
  for name, path in pairs(ENUM_DEFINES) do
    local ok, values = pcall(function() return defines.control_behavior[path[1]][path[2]] end)
    if ok and values then out.defines[name] = numbers(values) end
  end
  for _, variant in ipairs({ { key = "placed", touch = false }, { key = "with_control_behavior", touch = true } }) do
    local ok, result = pcall(record_fresh, surface, variant.touch)
    out.fresh[variant.key] = ok and { string = result } or { error = tostring(result) }
  end
  for _, case in ipairs(cases) do out.cases[#out.cases + 1] = record_case(surface, case) end
  helpers.write_file(OUTPUT, helpers.table_to_json(out))
end

script.on_init(function()
  local ok, err = pcall(run)
  if not ok then helpers.write_file(ERROR_OUTPUT, tostring(err)) end
  storage.passed = ok
end)

script.on_event(defines.events.on_tick, function() script.finish_test(storage.passed == true) end)
