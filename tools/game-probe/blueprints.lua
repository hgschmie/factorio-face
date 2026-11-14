-- Scenario run headless by tools/game-probe/blueprints.mjs via `factorio --test-scenario`. The tool puts one line in front of
-- this file that defines CASES_JSON: what tools/game-probe/lib/blueprintCases.ts asks for, as JSON. For every case the game
--   1. imports the blueprint string this project exported and exports it again (what its own parser kept of it),
--   2. builds that blueprint, revives the ghosts, and exports a new blueprint of what stands there,
--   3. builds the same circuit from the runtime API alone, without a blueprint of ours, and exports that.
-- For every prototype of the editor it also records the entity as it is placed (as a blueprint, and every setting as its control
-- behaviour has it), what becomes of each of the sixteen directions, and it records the numbers behind the defines a blueprint
-- uses, those of the enums of the generic entities among them. A space platform is made for the hub, which stands nowhere else.
-- Everything goes to script-output/face-blueprints.json. A step that fails is recorded with its error and the rest goes on.

local OUTPUT = "face-blueprints.json"
local ERROR_OUTPUT = "face-blueprints-error.txt"
local HALF = 64
local AREA = { { -HALF, -HALF }, { HALF, HALF } }
local HUB = "space-platform-hub"
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

-- Everything goes but the hub of a space platform: the platform is gone with it.
local function clear(surface)
  for _, entity in pairs(surface.find_entities()) do
    if entity.valid and entity.name ~= HUB then entity.destroy() end
  end
end

-- A space platform with its hub, which the game places nowhere else, and a floor around it. Each one has a hub that nothing has touched yet.
local function new_platform(name)
  local platform = game.forces.player.create_space_platform({ name = name, planet = "nauvis", starter_pack = "space-platform-starter-pack" })
  if not platform then error("the game made no space platform") end
  platform.apply_starter_pack()
  local surface, hub = platform.surface, platform.hub
  if not surface or not hub then error("the space platform has no surface or no hub") end
  local tiles = {}
  for x = -24, 23 do
    for y = -24, 23 do tiles[#tiles + 1] = { name = "space-platform-foundation", position = { hub.position.x + x, hub.position.y + y } } end
  end
  surface.set_tiles(tiles)
  clear(surface)
  return { surface = surface, hub = hub }
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

-- One entity of a case, placed and set through the runtime API. `offset` moves the case to where the hub of a platform stands,
-- which is the one entity that is there before the case. A wall has a connection point and a control behaviour only while a gate
-- stands next to it: the gate is built below it and named in `helpers`, because it is in the blueprint the game then makes.
local function build_native(place, spec, offset, helpers)
  local direction = spec.direction and defines.direction[spec.direction] or nil
  local position = { x = spec.position.x + offset.x, y = spec.position.y + offset.y }
  local entity = spec.name == HUB and place.hub or place.surface.create_entity({ name = spec.name, position = position, direction = direction, force = "player" })
  if not entity then error("cannot place " .. spec.name) end
  if entity.type == "wall" then
    local gate = place.surface.create_entity({ name = "gate", position = { position.x, position.y + 1 }, direction = defines.direction.north, force = "player" })
    if not gate then error("cannot place a gate next to " .. spec.name) end
    helpers[#helpers + 1] = gate.name
  end
  if spec.description then entity.combinator_description = spec.description end
  if spec.constant then set_constant(entity, spec.constant) end
  if spec.parameters then entity.get_or_create_control_behavior().parameters = spec.parameters end
  if spec.lamp then set_lamp(entity, spec.lamp) end
  if spec.speaker then set_speaker(entity, spec.speaker) end
  if spec.behavior then set_behavior(entity, spec.behavior) end
  return entity
end

local function hub_of(entities)
  for index, entity in ipairs(entities) do
    if entity.name == HUB then return index, entity end
  end
end

-- Builds the blueprint of the stack. A blueprint with the hub of a space platform is not built where it is told to: its
-- positions are taken as they are, the hub being the one that stands at (0, 0) of every platform, whose settings the game takes
-- from the blueprint. Returns the ghosts and the number of entities of the blueprint that stood there before.
local function build_blueprint(stack, place)
  local ghosts = stack.build_blueprint({ surface = place.surface, force = "player", position = { 0, 0 }, build_mode = defines.build_mode.forced })
  return ghosts, (place.hub and hub_of(stack.get_blueprint_entities() or {})) and 1 or 0
end

-- `places` are where the steps "build" and "native" happen: the plain surface twice, or two platforms, so that the hub of each is untouched.
local function record_case(places, case)
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

  local place = places.build
  clear(place.surface)
  step("build", function()
    local ghosts, standing = build_blueprint(inventory[1], place)
    -- What the blueprint has and the game did not build here is named: an offshore pump away from water, a mining drill without ore.
    local unbuilt = {}
    for _, record in ipairs(inventory[1].get_blueprint_entities() or {}) do unbuilt[record.name] = (unbuilt[record.name] or 0) + 1 end
    if standing > 0 then unbuilt[HUB] = nil end
    out.ghosts, out.revived, out.standing = #ghosts, 0, standing
    for _, ghost in pairs(ghosts) do
      if ghost.valid and ghost.type == "entity-ghost" then
        local name = ghost.ghost_name
        local _, revived = ghost.revive()
        if revived then
          out.revived = out.revived + 1
          unbuilt[name] = unbuilt[name] > 1 and unbuilt[name] - 1 or nil
        end
      end
    end
    out.unbuilt = {}
    for name in pairs(unbuilt) do out.unbuilt[#out.unbuilt + 1] = name end
    table.sort(out.unbuilt)
    out.rebuilt = blueprint_of(place.surface, inventory[2])
  end)
  clear(place.surface)

  place = places.native
  clear(place.surface)
  out.helpers = {}
  step("native", function()
    local built = {}
    local _, hub_spec = hub_of(case.entities)
    local offset = (place.hub and hub_spec) and { x = place.hub.position.x - hub_spec.position.x, y = place.hub.position.y - hub_spec.position.y } or { x = 0, y = 0 }
    for index, spec in ipairs(case.entities) do
      local ok, result = pcall(build_native, place, spec, offset, out.helpers)
      if not ok then error("entity " .. index .. " (" .. spec.name .. "): " .. tostring(result)) end
      built[index] = result
    end
    local function connector(index, id)
      local entity = built[index]
      local found = entity.get_wire_connector(defines.wire_connector_id[id], true)
      if not found then error("entity " .. index .. " (" .. entity.name .. ") has no connector " .. id) end
      return found
    end
    for _, wire in ipairs(case.wires) do
      local connected = connector(wire[1], wire[2]).connect_to(connector(wire[3], wire[4]), false)
      if not connected then error("no wire from entity " .. wire[1] .. " " .. wire[2] .. " to entity " .. wire[3] .. " " .. wire[4]) end
    end
    out.native = blueprint_of(place.surface, inventory[2])
  end)
  clear(place.surface)

  inventory.destroy()
  return out
end

-- Every prototype as the game places it, each on a cell of its own, as one blueprint. `touch` also gives each its control
-- behaviour, as a first wire does. A prototype that is missing from the blueprint is one the game does not place here (the hub
-- of a space platform) or does not put into a blueprint.
local function record_fresh(surface, names, touch)
  clear(surface)
  for index, name in ipairs(names) do
    local proto = prototypes.entity[name]
    if proto and name ~= HUB then
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

-- The hub of a platform nothing has touched, as a blueprint.
local function record_fresh_hub(place, touch)
  if touch then place.hub.get_or_create_control_behavior() end
  local inventory = game.create_inventory(1)
  local text = blueprint_of(place.surface, inventory[1])
  inventory.destroy()
  return text
end

-- A constant combinator whose sections were all removed, as a blueprint. The editor writes no such combinator (one without
-- sections there is the one the game places, with its empty section), so no case has it.
local function record_without_sections(surface)
  clear(surface)
  local entity = surface.create_entity({ name = "constant-combinator", position = { 0.5, 0.5 }, force = "player" })
  set_constant(entity, { enabled = true, sections = {} })
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

-- What the control behaviour of a new entity says for every setting of the editor: `attributes` are { field, attribute } pairs. A
-- signal that is not set is left out; an attribute the game does not have is in `errors`.
local function read_defaults(entity, attributes)
  local out = { values = {}, errors = {} }
  local behavior = entity.get_or_create_control_behavior()
  if not behavior then return { values = {}, errors = { control_behavior = "none" } } end
  for _, pair in ipairs(attributes) do
    local ok, value = pcall(function() return behavior[pair.attribute] end)
    if not ok then out.errors[pair.field] = tostring(value)
    elseif type(value) == "table" and value.condition ~= nil then out.values[pair.field] = value.condition
    else out.values[pair.field] = value end
  end
  return out
end

-- The direction of the one entity in the blueprint string of a stack, as the game writes it: north when it writes none, -1 without an entity.
local function exported_direction(stack)
  if not stack.is_blueprint_setup() then return -1 end
  local written = helpers.json_to_table(helpers.decode_string(string.sub(stack.export_stack(), 2)))
  local entity = written and written.blueprint and written.blueprint.entities and written.blueprint.entities[1]
  return entity and (entity.direction or 0) or -1
end

-- What becomes of each of the sixteen directions of one prototype: in the string of a blueprint that is given the direction
-- (`blueprint`), on the entity the game builds from that blueprint (`built`), in the string of a blueprint the game makes of
-- that entity (`exported`), and on an entity created with the direction (`created`). -1: there is no such blueprint or entity,
-- because the game does not put the prototype into a blueprint or does not build it here.
local function read_directions(surface, name)
  local proto = prototypes.entity[name]
  local out = { supports_direction = proto.supports_direction, blueprint = {}, built = {}, exported = {}, created = {} }
  local inventory = game.create_inventory(2)
  local stack = inventory[1]
  local position = { x = proto.tile_width / 2, y = proto.tile_height / 2 }
  for direction = 0, 15 do
    local slot = direction + 1
    out.blueprint[slot], out.built[slot], out.exported[slot], out.created[slot] = -1, -1, -1, -1
    clear(surface)
    pcall(function()
      stack.set_stack({ name = "blueprint" })
      stack.set_blueprint_entities({ { entity_number = 1, name = name, position = position, direction = direction } })
      out.blueprint[slot] = exported_direction(stack)
      for _, ghost in pairs(stack.build_blueprint({ surface = surface, force = "player", position = { 0, 0 }, build_mode = defines.build_mode.forced })) do
        local _, revived = ghost.revive()
        if revived then
          out.built[slot] = revived.direction
          inventory[2].set_stack({ name = "blueprint" })
          inventory[2].create_blueprint({ surface = surface, force = "player", area = AREA })
          out.exported[slot] = exported_direction(inventory[2])
        end
      end
    end)
    clear(surface)
    local ok, entity = pcall(surface.create_entity, { name = name, position = position, direction = direction, force = "player" })
    if ok and entity then out.created[slot] = entity.direction end
  end
  clear(surface)
  inventory.destroy()
  return out
end

local function run()
  local request = helpers.json_to_table(CASES_JSON)
  local surface = game.create_surface("face-blueprints")
  prepare(surface)
  local plain = { surface = surface }
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
    defaults = {},
    directions = {},
    cases = {},
    errors = {},
  }
  for name, path in pairs(ENUM_DEFINES) do
    local ok, values = pcall(function() return defines.control_behavior[path[1]][path[2]] end)
    if ok and values then out.defines[name] = numbers(values) end
  end

  -- Three platforms: one whose hub stays as it is placed until the blueprints of the cases are built on it, one for the circuits
  -- built through the runtime API, one whose hub gives its defaults.
  local platforms = {}
  for _, key in ipairs({ "build", "native", "defaults" }) do
    local ok, result = pcall(new_platform, "face-blueprints-" .. key)
    if ok then platforms[key] = result else out.errors[#out.errors + 1] = "space platform (" .. key .. "): " .. tostring(result) end
  end

  local names = {}
  for index, prototype in ipairs(request.prototypes) do names[index] = prototype.name end
  for _, variant in ipairs({ { key = "placed", touch = false }, { key = "with_control_behavior", touch = true } }) do
    local ok, result = pcall(record_fresh, surface, names, variant.touch)
    out.fresh[variant.key] = ok and { string = result } or { error = tostring(result) }
    if platforms.build then
      ok, result = pcall(record_fresh_hub, platforms.build, variant.touch)
      out.fresh[variant.key .. "_on_platform"] = ok and { string = result } or { error = tostring(result) }
    end
  end

  local ok, result = pcall(record_without_sections, surface)
  out.states = { constant_without_sections = ok and { string = result } or { error = tostring(result) } }

  for _, prototype in ipairs(request.prototypes) do
    local name = prototype.name
    if name == HUB then
      if platforms.defaults then out.defaults[name] = read_defaults(platforms.defaults.hub, prototype.attributes) end
    else
      clear(surface)
      local ok, entity = pcall(surface.create_entity, { name = name, position = { 0, 0 }, force = "player" })
      if ok and entity and #prototype.attributes > 0 then out.defaults[name] = read_defaults(entity, prototype.attributes) end
      local done, result = pcall(read_directions, surface, name)
      if done then out.directions[name] = result else out.errors[#out.errors + 1] = "directions of " .. name .. ": " .. tostring(result) end
    end
  end
  clear(surface)

  for _, case in ipairs(request.cases) do
    local on_platform = case.surface == "platform"
    if on_platform and not (platforms.build and platforms.native) then
      out.cases[#out.cases + 1] = { label = case.label, sent = case.string, errors = { "no space platform to build on" } }
    else
      out.cases[#out.cases + 1] = record_case(on_platform and platforms or { build = plain, native = plain }, case)
    end
  end
  helpers.write_file(OUTPUT, helpers.table_to_json(out))
end

script.on_init(function()
  local ok, err = pcall(run)
  if not ok then helpers.write_file(ERROR_OUTPUT, tostring(err)) end
  storage.passed = ok
end)

script.on_event(defines.events.on_tick, function() script.finish_test(storage.passed == true) end)
