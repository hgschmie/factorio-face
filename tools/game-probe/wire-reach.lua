-- Scenario run headless by tools/game-probe/wire-reach.mjs via `factorio --test-scenario`. It asks the game for every placement
-- of an entity B around an entity A whether a red circuit wire from A reaches B, and writes the answers to
-- script-output/face-wire-reach.json. B's top-left tile goes from -RANGE to RANGE on both axes around the top-left tile of A;
-- a case with a longer reach has a range of its own. A case the game cannot set up (a prototype of a module that is not
-- enabled, an entity it does not leave where it was put) is written with its error instead of its rows.

local RANGE = 14
-- For a reach beyond that: the 18 tiles of a substation, the 32 of a big pole, and the 30 of the agricultural tower, whose
-- 3 x 3 footprint reaches B's top-left tile 33 tiles away.
local LONG_RANGE = 36
local d = defines.direction
local id = defines.wire_connector_id
local COMBINATORS = { ["arithmetic-combinator"] = true, ["decider-combinator"] = true, ["selector-combinator"] = true }
local FACING = { [d.north] = "north", [d.east] = "east", [d.south] = "south", [d.west] = "west" }

-- An entity to place: its tile footprint as it stands, and for a combinator its direction and the connector the wire goes to.
local function spec(name, direction, side)
  local proto = prototypes.entity[name]
  if not proto then error("no prototype " .. name .. " with the enabled modules") end
  local upright = direction == nil or direction == d.north or direction == d.south
  -- A pole has one reach for every kind of wire; so has whatever else has no reach for circuit wires alone (the power switch, if the game says so).
  local circuit = proto.get_max_circuit_wire_distance()
  local reach = (proto.type == "electric-pole" or circuit == 0) and proto.get_max_wire_distance() or circuit
  return {
    name = name, direction = direction, side = side, reach = reach,
    width = upright and proto.tile_width or proto.tile_height, height = upright and proto.tile_height or proto.tile_width,
  }
end

local function connector(entity, side)
  if COMBINATORS[entity.type] then return entity.get_wire_connector(side == "out" and id.combinator_output_red or id.combinator_input_red, true) end
  return entity.get_wire_connector(id.circuit_red, true)
end

-- Places an entity with its top-left tile on (tx, ty). The game must leave it there: a footprint that is not the entity's would be snapped.
local function place(surface, what, tx, ty)
  local center = { x = tx + what.width / 2, y = ty + what.height / 2 }
  local entity = surface.create_entity({ name = what.name, position = center, direction = what.direction, force = "player" })
  if not entity then error(string.format("cannot place %s on tile (%d, %d)", what.name, tx, ty)) end
  if entity.position.x ~= center.x or entity.position.y ~= center.y then
    error(string.format("%s asked for (%g, %g) stands at (%g, %g): not %d x %d tiles", what.name, center.x, center.y, entity.position.x, entity.position.y, what.width, what.height))
  end
  return entity
end

-- Places A near (0, 0) and returns it with its top-left tile. The game may move an entity that belongs on the rail grid (a train
-- stop, a rail signal) by whole tiles; B is then placed around where A stands. Anything else than whole tiles is not A's footprint.
local function place_first(surface, what)
  local entity = surface.create_entity({ name = what.name, position = { x = what.width / 2, y = what.height / 2 }, direction = what.direction, force = "player" })
  if not entity then error("cannot place " .. what.name) end
  local tx, ty = entity.position.x - what.width / 2, entity.position.y - what.height / 2
  if tx ~= math.floor(tx) or ty ~= math.floor(ty) then
    error(string.format("%s stands at (%g, %g): not %d x %d tiles", what.name, entity.position.x, entity.position.y, what.width, what.height))
  end
  return entity, tx, ty
end

local function describe(what)
  return { name = what.name, width = what.width, height = what.height, facing = what.direction and FACING[what.direction] or nil, connector = what.side, reach = what.reach }
end

local function grid(surface, a, b, range)
  local first, ax, ay = place_first(surface, a)
  local from = connector(first, a.side)
  local rows = {}
  for ty = -range, range do
    local row = {}
    for tx = -range, range do
      local second = place(surface, b, ax + tx, ay + ty)
      local to = connector(second, b.side)
      local reaches = from.can_wire_reach(to)
      local connects = from.connect_to(to, true)
      -- "?": the two ways of asking disagree; the tool refuses such a recording.
      row[#row + 1] = reaches ~= connects and "?" or (connects and "1" or "0")
      second.destroy()
    end
    rows[#rows + 1] = table.concat(row)
  end
  first.destroy()
  return rows
end

-- One case. `a` and `b` are the arguments of `spec`, so that a prototype the game does not have fails this case alone.
local function probe(surface, label, a, b, range)
  range = range or RANGE
  local ok, result = pcall(function()
    local first, second = spec(table.unpack(a)), spec(table.unpack(b))
    return { label = label, a = describe(first), b = describe(second), range = range, rows = grid(surface, first, second, range) }
  end)
  if ok then return result end
  for _, entity in pairs(surface.find_entities()) do entity.destroy() end
  return { label = label, error = tostring(result) }
end

local function run()
  local surface = game.create_surface("face-wire-reach")
  surface.request_to_generate_chunks({ 0, 0 }, 3)
  surface.force_generate_chunk_requests()
  local constant, lamp, speaker = { "constant-combinator" }, { "small-lamp" }, { "programmable-speaker" }
  local small, medium, big, substation = { "small-electric-pole" }, { "medium-electric-pole" }, { "big-electric-pole" }, { "substation" }
  local switch, tower = { "power-switch" }, { "agricultural-tower" }
  local function decider(direction, side) return { "decider-combinator", direction, side } end
  local cases = {
    probe(surface, "constant - constant", constant, constant),
    probe(surface, "constant - lamp", constant, lamp),
    probe(surface, "constant - decider north input", constant, decider(d.north, "in")),
    probe(surface, "constant - decider north output", constant, decider(d.north, "out")),
    probe(surface, "constant - decider south input", constant, decider(d.south, "in")),
    probe(surface, "constant - decider east input", constant, decider(d.east, "in")),
    probe(surface, "constant - decider west output", constant, decider(d.west, "out")),
    probe(surface, "decider north input - decider north input", decider(d.north, "in"), decider(d.north, "in")),
    probe(surface, "decider east output - decider north input", decider(d.east, "out"), decider(d.north, "in")),
    probe(surface, "constant - arithmetic east output", constant, { "arithmetic-combinator", d.east, "out" }),
    probe(surface, "selector south output - lamp", { "selector-combinator", d.south, "out" }, lamp),
    probe(surface, "arithmetic west input - selector north output", { "arithmetic-combinator", d.west, "in" }, { "selector-combinator", d.north, "out" }),
    probe(surface, "constant - small pole", constant, small),
    probe(surface, "constant - medium pole", constant, medium),
    probe(surface, "constant - big pole", constant, big),
    probe(surface, "constant - steel chest", constant, { "steel-chest" }),
    -- Added with the poles and the speaker of the editor; not in the recording of 2.1.24 yet (rerun `make probe-wire-reach`).
    -- Pole to pole, where neither end has the 9 tiles of the other entities: the smaller of two reaches, and a reach above 9.
    probe(surface, "constant - substation", constant, substation),
    probe(surface, "constant - speaker", constant, speaker),
    probe(surface, "speaker - small pole", speaker, small),
    probe(surface, "small pole - small pole", small, small),
    probe(surface, "small pole - big pole", small, big),
    probe(surface, "medium pole - substation", medium, substation),
    probe(surface, "substation - substation", substation, substation, LONG_RANGE),
    probe(surface, "big pole - substation", big, substation, LONG_RANGE),
    probe(surface, "big pole - big pole", big, big, LONG_RANGE),
    -- Added with the entity table (docs/factorio-audit.md 13): does the distance between the tile footprints also decide for the
    -- shapes and reaches of the other wired entities? The odd one is A, which the game may move onto the rail grid; B is a constant
    -- combinator or a pole. Tile size against collision box: the train stop is 2 x 2 tiles around a box of one, the offshore pump
    -- one tile under a box of 1.2 x 1.35 that lies north of its center, the railgun turret 3 x 5 with a box of 2.82 x 4.
    probe(surface, "train stop - constant", { "train-stop" }, constant),
    probe(surface, "train stop east - constant", { "train-stop", d.east }, constant),
    probe(surface, "offshore pump - constant", { "offshore-pump" }, constant),
    probe(surface, "offshore pump east - constant", { "offshore-pump", d.east }, constant),
    probe(surface, "railgun turret - constant", { "railgun-turret" }, constant),
    probe(surface, "rail signal - constant", { "rail-signal" }, constant),
    probe(surface, "rail chain signal - constant", { "rail-chain-signal" }, constant),
    -- The larger and the oblong footprints.
    probe(surface, "assembling machine 2 - constant", { "assembling-machine-2" }, constant),
    probe(surface, "oil refinery - constant", { "oil-refinery" }, constant),
    probe(surface, "boiler north - constant", { "boiler", d.north }, constant),
    probe(surface, "boiler east - constant", { "boiler", d.east }, constant),
    probe(surface, "pump east - constant", { "pump", d.east }, constant),
    probe(surface, "splitter north - constant", { "splitter", d.north }, constant),
    probe(surface, "recycler east - constant", { "recycler", d.east }, constant),
    probe(surface, "rocket silo - constant", { "rocket-silo" }, constant),
    -- The two reaches that are neither a pole's nor 9: the power switch (10) and the agricultural tower (30).
    probe(surface, "power switch - constant", switch, constant),
    probe(surface, "power switch - power switch", switch, switch),
    probe(surface, "power switch - big pole", switch, big),
    probe(surface, "agricultural tower - constant", tower, constant),
    probe(surface, "agricultural tower - agricultural tower", tower, tower, LONG_RANGE),
    probe(surface, "agricultural tower - big pole", tower, big, LONG_RANGE),
  }
  helpers.write_file("face-wire-reach.json", helpers.table_to_json({ game_version = helpers.game_version, range = RANGE, cases = cases }))
end

script.on_init(function()
  local ok, err = pcall(run)
  if not ok then helpers.write_file("face-wire-reach-error.txt", tostring(err)) end
  storage.passed = ok
end)

script.on_event(defines.events.on_tick, function() script.finish_test(storage.passed == true) end)
