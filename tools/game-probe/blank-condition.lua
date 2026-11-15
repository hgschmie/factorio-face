-- Scenario run headless by tools/game-probe/blank-condition.mjs via `factorio --test-scenario`. It asks the game what an entity
-- does whose circuit condition is in use ("Enable/disable" on) and blank (no first signal). Every prototype of PROTOTYPES is
-- set up once per state of STATES and per way of building it, each on a cell of its own with power, next to a constant
-- combinator that sends signal-A = 1:
--   "blueprint": a blueprint string with the entity, the combinator and the wire is imported, built and its ghosts revived, as
--                a blueprint of the user arrives;
--   "api":       the entity is created and set through its control behaviour.
-- The game then runs for READ_TICK ticks, and what every entity says is written to script-output/face-blank-condition.json:
-- its control behaviour (flag, condition with `fulfilled`, `disabled`), its status, what it visibly does (the item on a belt,
-- the state of a power switch, the gate next to a wall, a rail signal) and its control behaviour in a blueprint the game makes
-- of it. A step the game refuses is recorded with its error; a read the entity does not have is named in `unavailable`.
-- Next to them stand decider combinators with a blank condition and with none (DECIDERS), which have no switch: what they send
-- says whether their conditions hold.

local OUTPUT = "face-blank-condition.json"
local ERROR_OUTPUT = "face-blank-condition-error.txt"
-- The combinator's signal is on the wire after one tick; the rest is for the belt to carry its item and the gate to open.
local READ_TICK = 60
local CELL = 16
local COLUMNS = 16
local RED = defines.wire_connector_id.circuit_red
local SIGNAL = { type = "virtual", name = "signal-A" }
local ITEM = "iron-plate"
-- Where the item is put on a belt, as the distance to the end of its line: an express belt needs nine ticks from there.
local ITEM_AT = 0.875

local function compare(comparator) return { first_signal = SIGNAL, constant = 0, comparator = comparator } end

-- `flag` is the "Enable/disable" switch, `condition` what is written; without one the entity keeps the blank one it is made with.
-- "blank-equals-zero" has a comparator that holds if a blank first signal reads as 0: is a blank condition compared at all?
local STATES = {
  { key = "blank", flag = true, wired = true },
  { key = "blank-unwired", flag = true, wired = false },
  { key = "true", flag = true, wired = true, condition = compare(">") },
  { key = "false", flag = true, wired = true, condition = compare("<") },
  { key = "false-unwired", flag = true, wired = false, condition = compare("<") },
  { key = "off", flag = false, wired = true, condition = compare("<") },
  { key = "blank-equals-zero", flag = true, wired = true, condition = { constant = 0, comparator = "=" } },
}

-- The switch of the condition: its field in a blueprint and its attribute in the runtime API. A speaker has none.
local KINDS = {
  onoff = { field = "circuit_enabled", attribute = "circuit_enable_disable" },
  wall = { field = "circuit_open_gate", attribute = "open_gate" },
  signal = { field = "circuit_close_signal", attribute = "close_signal" },
  speaker = {},
}

-- `needs`: what the game wants around the entity before it builds it from a blueprint.
local PROTOTYPES = {
  { name = "express-transport-belt", kind = "onoff" },
  { name = "transport-belt", kind = "onoff" },
  { name = "inserter", kind = "onoff" },
  { name = "small-lamp", kind = "onoff" },
  { name = "pump", kind = "onoff" },
  { name = "offshore-pump", kind = "onoff", needs = "water" },
  { name = "burner-mining-drill", kind = "onoff", needs = "ore" },
  { name = "electric-mining-drill", kind = "onoff", needs = "ore" },
  { name = "train-stop", kind = "onoff" },
  { name = "power-switch", kind = "onoff" },
  { name = "assembling-machine-2", kind = "onoff" },
  { name = "electric-furnace", kind = "onoff" },
  { name = "boiler", kind = "onoff" },
  { name = "gun-turret", kind = "onoff" },
  { name = "laser-turret", kind = "onoff" },
  { name = "artillery-turret", kind = "onoff" },
  { name = "land-mine", kind = "onoff" },
  { name = "loader", kind = "onoff" },
  { name = "agricultural-tower", kind = "onoff" },
  { name = "asteroid-collector", kind = "onoff" },
  { name = "programmable-speaker", kind = "speaker" },
  { name = "stone-wall", kind = "wall" },
  -- Without a rail: a rail signal closes all the same, a chain signal does not show it and is left out.
  { name = "rail-signal", kind = "signal" },
}

-- A decider combinator sends signal-B = 1 when its conditions hold and signal-C = 1 when they do not. The last three hold if a
-- blank first signal reads as 0.
local DECIDERS = {
  { key = "blank", wired = true, conditions = { {} } },
  { key = "blank-unwired", wired = false, conditions = { {} } },
  { key = "true", wired = true, conditions = { compare(">") } },
  { key = "false", wired = true, conditions = { compare("<") } },
  { key = "empty", wired = true, conditions = {} },
  { key = "blank-equals-zero", wired = true, conditions = { { constant = 0, comparator = "=" } } },
  { key = "blank-above-minus-one", wired = true, conditions = { { constant = -1, comparator = ">" } } },
  { key = "blank-below-signal", wired = true, conditions = { { second_signal = SIGNAL, comparator = "<" } } },
}

local STATUS = {}
for name, value in pairs(defines.entity_status) do STATUS[value] = name end
local SIGNAL_STATE = {}
for name, value in pairs(defines.signal_state) do SIGNAL_STATE[value] = name end

-- What was set up, kept until it is read: the scenario runs once and is never saved.
local surface
local cells = {}
local deciders = {}

-- Where an entity of that many tiles stands so that it lies on the tile grid: (0, 0) is a corner of four tiles.
local function on_grid(proto, x, y) return { x = x + (proto.tile_width % 2) / 2, y = y + (proto.tile_height % 2) / 2 } end

local function decode(text) return helpers.json_to_table(helpers.decode_string(string.sub(text, 2))) end

-- An error without the line of this file it was raised on, which is not the game's and changes with the file.
local function message(err) return (string.gsub(tostring(err), "^__level__/control.lua:%d+: ", "")) end

local function area_of(cell)
  return { { cell.x - CELL / 2, cell.y - CELL / 2 }, { cell.x + CELL / 2, cell.y + CELL / 2 } }
end

-- The parts of a cell, as { name, position, direction } around (0, 0): the entity, the combinator and the gate a wall needs.
local function parts(prototype)
  local proto = prototypes.entity[prototype.name]
  if not proto then error("no prototype " .. prototype.name .. " with the enabled modules") end
  local list = { { name = prototype.name, position = on_grid(proto, 0, 0) }, { name = "constant-combinator", position = { x = 4.5, y = 0.5 } } }
  if prototype.kind == "wall" then list[3] = { name = "gate", position = { x = 0.5, y = 1.5 }, direction = defines.direction.north } end
  return list
end

local function blueprint_string(version, prototype, state)
  local kind = KINDS[prototype.kind]
  local behavior = {}
  if kind.field then behavior[kind.field] = state.flag end
  if state.condition then behavior.circuit_condition = state.condition end
  local entities = {}
  for index, part in ipairs(parts(prototype)) do
    entities[index] = { entity_number = index, name = part.name, position = part.position, direction = part.direction }
  end
  if next(behavior) then entities[1].control_behavior = behavior end
  entities[2].control_behavior = { sections = { sections = { { index = 1, filters = { { index = 1, type = "virtual", name = SIGNAL.name, quality = "normal", comparator = "=", count = 1 } } } } } }
  local blueprint = { item = "blueprint", version = version, entities = entities }
  if state.wired then blueprint.wires = { { 1, RED, 2, RED } } end
  return "0" .. helpers.encode_string(helpers.table_to_json({ blueprint = blueprint }))
end

-- Builds the blueprint so that its first entity stands where the cell wants it: the game centers a blueprint on where it is
-- built, so the place is found with a first build and corrected with a second.
local function build_blueprint(surface, cell, text, wanted)
  local inventory = game.create_inventory(1)
  local stack = inventory[1]
  local built = {}
  local ok, err = pcall(function()
    cell.import_result = stack.import_stack(text)
    if not stack.is_blueprint_setup() then error("the game made no blueprint of the string (import_stack gave " .. tostring(cell.import_result) .. ")") end
    local function build(position) return stack.build_blueprint({ surface = surface, force = "player", position = position, build_mode = defines.build_mode.forced }) end
    local function place_of(ghosts, name)
      for _, ghost in pairs(ghosts) do
        if ghost.valid and ghost.type == "entity-ghost" and ghost.ghost_name == name then return ghost.position end
      end
    end
    local at = { x = cell.x, y = cell.y }
    local ghosts = build(at)
    -- The combinator is in every blueprint and the game builds its ghost everywhere.
    local stands = place_of(ghosts, "constant-combinator")
    if not stands then error("the game built no ghost of the combinator") end
    local dx, dy = cell.x + 4.5 - stands.x, cell.y + 0.5 - stands.y
    if dx ~= 0 or dy ~= 0 then
      for _, ghost in pairs(ghosts) do
        if ghost.valid then ghost.destroy() end
      end
      ghosts = build({ x = at.x + dx, y = at.y + dy })
    end
    cell.ghosts = #ghosts
    for _, ghost in pairs(ghosts) do
      if ghost.valid and ghost.type == "entity-ghost" then
        local name = ghost.ghost_name
        local _, revived = ghost.revive()
        if revived then built[name] = revived end
      end
    end
    if not built[wanted] then error("the game did not build " .. wanted .. " from the blueprint") end
  end)
  inventory.destroy()
  if not ok then error(err, 0) end
  return built
end

-- The parts of a cell, created by name, the combinator sending its signal.
local function place(surface, cell, prototype)
  local built = {}
  for _, part in ipairs(parts(prototype)) do
    local entity = surface.create_entity({ name = part.name, position = { x = cell.x + part.position.x, y = cell.y + part.position.y }, direction = part.direction, force = "player" })
    if not entity then error("cannot place " .. part.name) end
    built[part.name] = entity
  end
  local combinator = built["constant-combinator"]
  local behavior = combinator.get_or_create_control_behavior()
  local section = behavior.get_section(1) or behavior.add_section()
  section.set_slot(1, { value = { type = "virtual", name = SIGNAL.name, quality = "normal", comparator = "=" }, min = 1 })
  return built
end

local function build_api(surface, cell, prototype, state)
  local kind = KINDS[prototype.kind]
  local built = place(surface, cell, prototype)
  local entity = built[prototype.name]
  if state.wired then
    local from, to = entity.get_wire_connector(RED, true), built["constant-combinator"].get_wire_connector(RED, true)
    if not from then error(prototype.name .. " has no red circuit connector") end
    if not from.connect_to(to, false) then error("no wire from " .. prototype.name .. " to the combinator") end
  end
  local behavior = entity.get_or_create_control_behavior()
  if not behavior then error(prototype.name .. " has no control behaviour") end
  if state.condition then behavior.circuit_condition = state.condition end
  if kind.attribute then behavior[kind.attribute] = state.flag end
  return built
end

-- What the game wants below an entity, laid before it is built: ore below a drill, water north of an offshore pump.
local function prepare_cell(surface, cell, needs)
  if needs == "ore" then
    for x = -3, 2 do
      for y = -3, 2 do surface.create_entity({ name = "iron-ore", position = { cell.x + x + 0.5, cell.y + y + 0.5 }, amount = 1000 }) end
    end
  elseif needs == "water" then
    local tiles = {}
    for x = -3, 2 do
      for y = -5, -1 do tiles[#tiles + 1] = { name = "water", position = { cell.x + x, cell.y + y } } end
    end
    surface.set_tiles(tiles, false)
  end
end

local function power(surface, cell)
  surface.create_entity({ name = "substation", position = { cell.x - 6, cell.y + 6 }, force = "player" })
  surface.create_entity({ name = "electric-energy-interface", position = { cell.x - 4, cell.y + 6 }, force = "player" })
end

-- Where the item of a belt is: the distance to the end of its line, 0 once the belt has carried it there.
local function item_position(entity)
  local found = entity.get_transport_line(1).get_detailed_contents()[1]
  if not found then error("the item is gone from the belt") end
  return found.position
end

local function set_up(surface, version, cell, prototype, state)
  prepare_cell(surface, cell, prototype.needs)
  power(surface, cell)
  local built
  if cell.built == "blueprint" then built = build_blueprint(surface, cell, blueprint_string(version, prototype, state), prototype.name)
  else built = build_api(surface, cell, prototype, state) end
  cell.entity, cell.gate = built[prototype.name], built.gate
  if cell.entity.type == "transport-belt" then
    if not cell.entity.get_transport_line(1).insert_at(ITEM_AT, { name = ITEM, count = 1 }) then error("the belt took no item") end
    cell.item_from = item_position(cell.entity)
  end
end

local function set_up_decider(surface, cell, case)
  power(surface, cell)
  local built = place(surface, cell, { name = "decider-combinator" })
  cell.entity = built["decider-combinator"]
  if case.wired then
    local from, to = cell.entity.get_wire_connector(defines.wire_connector_id.combinator_input_red, true), built["constant-combinator"].get_wire_connector(RED, true)
    if not from.connect_to(to, false) then error("no wire from the decider combinator to the constant combinator") end
  end
  local signal = function(name) return { signal = { type = "virtual", name = name }, copy_count_from_input = false, constant = 1 } end
  cell.entity.get_or_create_control_behavior().parameters = { conditions = case.conditions, outputs = { signal("signal-B") }, else_outputs = { signal("signal-C") } }
end

-- The control behaviour of the cell's entity as the game writes it into a blueprint of the cell; nil when it writes none.
local function exported(surface, cell, stack)
  stack.set_stack({ name = "blueprint" })
  stack.create_blueprint({ surface = surface, force = "player", area = area_of(cell) })
  if not stack.is_blueprint_setup() then error("the game made an empty blueprint") end
  for _, entity in ipairs(decode(stack.export_stack()).blueprint.entities) do
    if entity.name == cell.entity.name then return entity.control_behavior end
  end
  error("the entity is not in the blueprint the game made")
end

local function read(surface, cell, prototype, stack)
  local entity = cell.entity
  local kind = KINDS[prototype.kind]
  local out = { state = cell.state, built = cell.built, import_result = cell.import_result, unavailable = {} }
  -- A read that gives nil is left out; one the entity does not have is named.
  local function try(key, get)
    local ok, value = pcall(get)
    if ok then out[key] = value else out.unavailable[#out.unavailable + 1] = key end
  end
  local behavior = entity.get_control_behavior()
  out.control_behavior = behavior ~= nil
  try("wires", function()
    local connector = entity.get_wire_connector(RED, false)
    return connector and connector.real_connection_count or 0
  end)
  try("signal", function() return entity.get_signal(SIGNAL, RED) end)
  if behavior then
    if kind.attribute then try("flag", function() return behavior[kind.attribute] end) end
    try("condition", function() return behavior.circuit_condition end)
    try("disabled", function() return behavior.disabled end)
  end
  try("status", function() return STATUS[entity.status] end)
  try("active", function() return entity.active end)
  try("disabled_by_control_behavior", function() return entity.disabled_by_control_behavior end)
  if entity.type == "transport-belt" then
    out.item_from = cell.item_from
    try("item_to", function() return item_position(entity) end)
  elseif entity.type == "power-switch" then
    try("switch_on", function() return entity.power_switch_state end)
  elseif entity.type == "rail-signal" then
    try("signal_state", function() return SIGNAL_STATE[entity.signal_state] end)
  elseif entity.type == "wall" and cell.gate and cell.gate.valid then
    try("gate_opened", function() return cell.gate.is_opened() end)
  end
  try("exported", function() return exported(surface, cell, stack) or "none" end)
  return out
end

local function read_decider(cell)
  local behavior = cell.entity.get_control_behavior()
  local out = { state = cell.state, conditions = behavior.parameters.conditions, output = {} }
  out.signal = cell.entity.get_signal(SIGNAL, defines.wire_connector_id.combinator_input_red)
  for _, sent in ipairs(behavior.signals_last_tick) do out.output[sent.signal.name] = sent.count end
  return out
end

local function set_up_all()
  local count = #PROTOTYPES * #STATES * 2 + #DECIDERS
  local rows = math.ceil(count / COLUMNS)
  local half = math.max(COLUMNS, rows) * CELL / 2 + CELL
  surface = game.create_surface("face-blank-condition")
  surface.request_to_generate_chunks({ 0, 0 }, math.ceil(half / 32) + 1)
  surface.force_generate_chunk_requests()
  local tiles = {}
  for x = -half, half - 1 do
    for y = -half, half - 1 do tiles[#tiles + 1] = { name = "refined-concrete", position = { x, y } } end
  end
  surface.set_tiles(tiles)
  for _, entity in pairs(surface.find_entities()) do
    if entity.valid then entity.destroy() end
  end
  -- Night, so that a lamp nothing switches off is lit.
  surface.daytime = 0.5
  surface.freeze_daytime = true

  -- The version the game itself writes into a blueprint.
  local inventory = game.create_inventory(1)
  local probe = surface.create_entity({ name = "constant-combinator", position = { 0.5, 0.5 }, force = "player" })
  inventory[1].set_stack({ name = "blueprint" })
  inventory[1].create_blueprint({ surface = surface, force = "player", area = { { -1, -1 }, { 2, 2 } } })
  local version = decode(inventory[1].export_stack()).blueprint.version
  probe.destroy()
  inventory.destroy()

  local index = 0
  local function next_cell(fields)
    fields.x, fields.y = (index % COLUMNS - COLUMNS / 2) * CELL + CELL / 2, (math.floor(index / COLUMNS) - rows / 2) * CELL + CELL / 2
    index = index + 1
    return fields
  end
  for number, prototype in ipairs(PROTOTYPES) do
    for _, state in ipairs(STATES) do
      for _, built in ipairs({ "blueprint", "api" }) do
        -- A speaker has no switch to turn off.
        if KINDS[prototype.kind].attribute or state.flag then
          local cell = next_cell({ prototype = number, state = state.key, built = built })
          local ok, err = pcall(set_up, surface, version, cell, prototype, state)
          if not ok then cell.error = message(err) end
          cells[#cells + 1] = cell
        end
      end
    end
  end
  for _, case in ipairs(DECIDERS) do
    local cell = next_cell({ state = case.key })
    local ok, err = pcall(set_up_decider, surface, cell, case)
    if not ok then cell.error = message(err) end
    deciders[#deciders + 1] = cell
  end
end

local function record()
  local inventory = game.create_inventory(1)
  local cases = {}
  for number, prototype in ipairs(PROTOTYPES) do
    local proto = prototypes.entity[prototype.name]
    cases[number] = { name = prototype.name, type = proto and proto.type or nil, kind = prototype.kind, flag = KINDS[prototype.kind].field, readings = {} }
  end
  for _, cell in ipairs(cells) do
    local prototype = PROTOTYPES[cell.prototype]
    local readings = cases[cell.prototype].readings
    if cell.error or not (cell.entity and cell.entity.valid) then
      readings[#readings + 1] = { state = cell.state, built = cell.built, error = cell.error or "the entity is gone" }
    else
      local ok, result = pcall(read, surface, cell, prototype, inventory[1])
      readings[#readings + 1] = ok and result or { state = cell.state, built = cell.built, error = message(result) }
    end
  end
  inventory.destroy()
  local decided = {}
  for index, cell in ipairs(deciders) do
    local ok, result = pcall(function()
      if cell.error then error(cell.error, 0) end
      return read_decider(cell)
    end)
    decided[index] = ok and result or { state = cell.state, error = message(result) }
  end
  helpers.write_file(OUTPUT, helpers.table_to_json({ game_version = helpers.game_version, ticks = READ_TICK, signal = SIGNAL.name, cases = cases, deciders = decided }))
end

script.on_init(function()
  local ok, err = pcall(set_up_all)
  if not ok then helpers.write_file(ERROR_OUTPUT, message(err)) end
  storage.failed = not ok
  storage.ticks = 0
end)

script.on_event(defines.events.on_tick, function()
  if storage.failed then return script.finish_test(false) end
  storage.ticks = storage.ticks + 1
  if storage.ticks < READ_TICK then return end
  local ok, err = pcall(record)
  if not ok then helpers.write_file(ERROR_OUTPUT, message(err)) end
  script.finish_test(ok)
end)
