-- Scenario run headless by tools/game-probe/wire-reach.mjs via `factorio --test-scenario`. It asks the game for every placement
-- of an entity B around an entity A whether a red circuit wire from A reaches B, and writes the answers to
-- script-output/face-wire-reach.json. A stands with its top-left tile on (0, 0); B's top-left tile goes from -RANGE to RANGE on
-- both axes.

local RANGE = 14
local d = defines.direction
local id = defines.wire_connector_id
local COMBINATORS = { ["arithmetic-combinator"] = true, ["decider-combinator"] = true, ["selector-combinator"] = true }
local FACING = { [d.north] = "north", [d.east] = "east", [d.south] = "south", [d.west] = "west" }

-- An entity to place: its tile footprint as it stands, and for a combinator its direction and the connector the wire goes to.
local function spec(name, direction, side)
  local proto = prototypes.entity[name]
  local upright = direction == nil or direction == d.north or direction == d.south
  -- A pole has one reach for every kind of wire.
  local reach = proto.type == "electric-pole" and proto.get_max_wire_distance() or proto.get_max_circuit_wire_distance()
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

local function describe(what)
  return { name = what.name, width = what.width, height = what.height, facing = what.direction and FACING[what.direction] or nil, connector = what.side, reach = what.reach }
end

local function probe(surface, label, a, b)
  local first = place(surface, a, 0, 0)
  local from = connector(first, a.side)
  local rows = {}
  for ty = -RANGE, RANGE do
    local row = {}
    for tx = -RANGE, RANGE do
      local second = place(surface, b, tx, ty)
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
  return { label = label, a = describe(a), b = describe(b), rows = rows }
end

local function run()
  local surface = game.create_surface("face-wire-reach")
  surface.request_to_generate_chunks({ 0, 0 }, 3)
  surface.force_generate_chunk_requests()
  local constant = spec("constant-combinator")
  local lamp = spec("small-lamp")
  local small, medium, big, substation = spec("small-electric-pole"), spec("medium-electric-pole"), spec("big-electric-pole"), spec("substation")
  local speaker = spec("programmable-speaker")
  local function decider(direction, side) return spec("decider-combinator", direction, side) end
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
    probe(surface, "constant - arithmetic east output", constant, spec("arithmetic-combinator", d.east, "out")),
    probe(surface, "selector south output - lamp", spec("selector-combinator", d.south, "out"), lamp),
    probe(surface, "arithmetic west input - selector north output", spec("arithmetic-combinator", d.west, "in"), spec("selector-combinator", d.north, "out")),
    probe(surface, "constant - small pole", constant, small),
    probe(surface, "constant - medium pole", constant, medium),
    probe(surface, "constant - big pole", constant, big),
    probe(surface, "constant - steel chest", constant, spec("steel-chest")),
    -- Added with the poles and the speaker of the editor; not in the recording of 2.1.24 yet (rerun `make probe-wire-reach`).
    -- Pole to pole, where neither end has the 9 tiles of the other entities: the smaller of two reaches, and a reach above 9.
    probe(surface, "constant - substation", constant, substation),
    probe(surface, "constant - speaker", constant, speaker),
    probe(surface, "speaker - small pole", speaker, small),
    probe(surface, "small pole - small pole", small, small),
    probe(surface, "small pole - big pole", small, big),
    probe(surface, "medium pole - substation", medium, substation),
    probe(surface, "substation - substation", substation, substation),
    probe(surface, "big pole - substation", big, substation),
    probe(surface, "big pole - big pole", big, big),
  }
  helpers.write_file("face-wire-reach.json", helpers.table_to_json({ game_version = helpers.game_version, range = RANGE, cases = cases }))
end

script.on_init(function()
  local ok, err = pcall(run)
  if not ok then helpers.write_file("face-wire-reach-error.txt", tostring(err)) end
  storage.passed = ok
end)

script.on_event(defines.events.on_tick, function() script.finish_test(storage.passed == true) end)
