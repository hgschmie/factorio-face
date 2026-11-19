-- Scenario run headless by tools/game-probe/blueprint-book.mjs via `factorio --test-scenario`. The tool puts two lines in front
-- of this file: CASES_JSON, books as [{ label, string }], and IMPORTS_ONLY. The game is asked three things, and the answers go to
-- script-output/face-blueprint-book.json:
--   1. native:  what it exports for books made through the runtime API alone: an empty one, one with a blueprint, an empty
--               slot, a blueprint, a book with a blueprint, an upgrade planner and a deconstruction planner, with label,
--               description, icons and active index, and one with a blueprint that has every field of a blueprint as an item
--               (snapping among them); and where it puts an item that is added to a book.
--   2. imports: what it makes of each book of CASES_JSON: the result of import_stack, the item in every slot of the
--               inventory the book then has, and the string it exports for it.
--   3. limits:  how many slots a book has: MANY blueprints are inserted one by one, and imported in one book written here.
-- The tool runs it twice: with the books written by hand of lib/blueprintBookCases.mjs, and then, IMPORTS_ONLY, with books of
-- the first run that packages/blueprints wrote a blueprint into (lib/blueprintBookEdits.ts), for the second answer alone.
-- A step the game refuses is recorded with its error and the rest goes on.

local OUTPUT = "face-blueprint-book.json"
local ERROR_OUTPUT = "face-blueprint-book-error.txt"
local MAIN = defines.inventory.item_main
local COMBINATOR = { { entity_number = 1, name = "constant-combinator", position = { x = 0.5, y = 0.5 } } }
-- More than an item stack index of 16 bits can name.
local MANY = 70000

-- An error without the line of this file it was raised on, which is not the game's and changes with the file.
local function message(err) return (string.gsub(tostring(err), "^__level__/control.lua:%d+: ", "")) end

-- Runs a step; what it could not do is added to `errors` as "name: error".
local function try(errors, name, step)
  local ok, result = pcall(step)
  if ok then return result end
  errors[#errors + 1] = name .. ": " .. message(result)
end

local function decode(text) return helpers.json_to_table(helpers.decode_string(string.sub(text, 2))) end

local function inventory_of(stack) return stack.get_inventory(MAIN) end

-- What a stack holds, as the runtime API says it: of a book its size, its active index and its slots that are not empty, each
-- with its number (from 1, as the API counts).
local function contents(stack)
  if not stack.valid_for_read then return { empty = true } end
  local out = { item = stack.name }
  pcall(function() out.label = stack.label end)
  if stack.is_blueprint then
    out.entities = stack.is_blueprint_setup() and stack.get_blueprint_entity_count() or 0
  elseif stack.is_blueprint_book then
    local inventory = inventory_of(stack)
    out.size = #inventory
    out.active_index = stack.active_index
    out.slots = {}
    for slot = 1, #inventory do
      if inventory[slot].valid_for_read then
        local held = contents(inventory[slot])
        held.slot = slot
        out.slots[#out.slots + 1] = held
      end
    end
  end
  return out
end

-- The contents of a stack and the string the game exports for it.
local function state(stack)
  local out = { contents = contents(stack) }
  if stack.valid_for_read then
    local ok, result = pcall(stack.export_stack)
    if ok then out.exported = result else out.error = message(result) end
  end
  return out
end

local function set_up_blueprint(stack, label)
  stack.set_blueprint_entities(COMBINATOR)
  stack.label = label
end

-- Inserts one item into the inventory of a book; says how many the game took, the slot it is in and the size after.
local function insert(inventory, name)
  local before = {}
  for slot = 1, #inventory do before[slot] = inventory[slot].valid_for_read end
  local out = { item = name, inserted = inventory.insert({ name = name, count = 1 }), size = #inventory }
  for slot = 1, #inventory do
    if inventory[slot].valid_for_read and not before[slot] then out.slot = slot end
  end
  return out
end

local function native(scratch)
  local out = { errors = {} }
  local errors = out.errors
  local stack, other = scratch[1], scratch[2]

  stack.set_stack({ name = "blueprint-book" })
  out.empty = state(stack)
  stack.label = "Empty"
  out.empty_labelled = state(stack)

  -- A slot beyond the size of the inventory.
  stack.set_stack({ name = "blueprint-book" })
  out.beyond_size = { size_before = #inventory_of(stack) }
  local ok, err = pcall(function() inventory_of(stack)[5].set_stack({ name = "blueprint" }) end)
  if not ok then out.beyond_size.error = message(err) end
  out.beyond_size.size_after = #inventory_of(stack)

  -- A blueprint nothing was put into.
  stack.set_stack({ name = "blueprint-book" })
  local blank = inventory_of(stack)
  out.blank_blueprint = { inserts = { insert(blank, "blueprint"), insert(blank, "blueprint") } }
  try(errors, "blank_blueprint", function() set_up_blueprint(blank[2], "second") end)
  out.blank_blueprint.state = state(stack)

  -- A blueprint with everything a blueprint has as an item, in a book of its own.
  stack.set_stack({ name = "blueprint-book" })
  local carried = inventory_of(stack)
  carried.insert({ name = "blueprint", count = 1 })
  local kept = carried[1]
  try(errors, "carried: entities", function()
    kept.set_blueprint_entities({
      { entity_number = 1, name = "constant-combinator", position = { x = 0.5, y = 0.5 } },
      { entity_number = 2, name = "small-lamp", position = { x = 2.5, y = 0.5 } },
    })
    kept.label = "kept"
  end)
  try(errors, "carried: description", function() kept.blueprint_description = "What a replacement keeps" end)
  try(errors, "carried: icons", function() kept.preview_icons = { { index = 1, signal = { type = "virtual", name = "signal-K" } }, { index = 4, signal = { type = "item", name = "small-lamp" } } } end)
  try(errors, "carried: label_color", function() kept.label_color = { r = 0, g = 0.5, b = 1, a = 1 } end)
  try(errors, "carried: snap-to-grid", function() kept.blueprint_snap_to_grid = { x = 8, y = 4 } end)
  try(errors, "carried: absolute-snapping", function() kept.blueprint_absolute_snapping = true end)
  try(errors, "carried: position-relative-to-grid", function() kept.blueprint_position_relative_to_grid = { x = 3, y = 1 } end)
  try(errors, "carried: label of the book", function() stack.label = "Carried" end)
  out.carried = state(stack)

  -- The full book: every item is inserted, the first three being blueprints, then the second is taken out again.
  stack.set_stack({ name = "blueprint-book" })
  local inventory = inventory_of(stack)
  local full = { inserts = {}, size_fresh = #inventory }
  out.full = full
  for _, name in ipairs({ "blueprint", "blueprint", "blueprint", "blueprint-book", "upgrade-planner", "deconstruction-planner" }) do full.inserts[#full.inserts + 1] = insert(inventory, name) end
  try(errors, "first blueprint", function() set_up_blueprint(inventory[1], "first") end)
  try(errors, "third blueprint", function() set_up_blueprint(inventory[3], "third") end)
  try(errors, "blueprint description", function() inventory[3].blueprint_description = "The third slot" end)
  try(errors, "blueprint icons", function() inventory[3].preview_icons = { { index = 1, signal = { type = "virtual", name = "signal-C" } } } end)
  try(errors, "inner book", function()
    local inner = inventory_of(inventory[4])
    inner.insert({ name = "blueprint", count = 1 })
    set_up_blueprint(inner[1], "inside")
    inventory[4].label = "inner"
  end)
  try(errors, "upgrade planner", function()
    inventory[5].label = "belts"
    inventory[5].set_mapper(1, "from", { type = "entity", name = "transport-belt" })
    inventory[5].set_mapper(1, "to", { type = "entity", name = "fast-transport-belt" })
  end)
  try(errors, "upgrade planner icons", function() inventory[5].preview_icons = { { index = 1, signal = { type = "item", name = "fast-transport-belt" } } } end)
  try(errors, "upgrade planner description", function() inventory[5].planner_description = "Faster belts" end)
  try(errors, "deconstruction planner", function()
    inventory[6].label = "combinators"
    inventory[6].entity_filters = { { name = "constant-combinator" } }
  end)
  try(errors, "deconstruction planner description", function() inventory[6].planner_description = "Combinators only" end)
  try(errors, "clear second slot", function() inventory[2].clear() end)
  full.size_after_clear = #inventory
  try(errors, "label", function() stack.label = "Probe" end)
  try(errors, "label_color", function() stack.label_color = { r = 1, g = 0.5, b = 0, a = 1 } end)
  try(errors, "description", function() stack.blueprint_description = "A book of the probe" end)
  try(errors, "icons", function() stack.preview_icons = { { index = 1, signal = { type = "virtual", name = "signal-B" } }, { index = 3, signal = { type = "item", name = "constant-combinator" } } } end)
  try(errors, "active_index", function() stack.active_index = 3 end)
  full.state = state(stack)
  local exported = full.state.exported

  -- The items of the book on their own.
  full.items = {}
  for slot = 1, #inventory do
    if inventory[slot].valid_for_read then full.items[#full.items + 1] = { slot = slot, exported = try(errors, "export of slot " .. slot, inventory[slot].export_stack) } end
  end

  -- The game's own string, read by the game.
  if exported then
    other.clear()
    full.reimport = { import_result = other.import_stack(exported) }
    local again = state(other)
    full.reimport.same_string = again.exported == exported
    full.reimport.same_contents = helpers.table_to_json(again.contents) == helpers.table_to_json(full.state.contents)
  end

  -- The active index: on the empty slot, on every kind of item, and beyond the slots.
  full.active = {}
  for _, index in ipairs({ 1, 2, 4, 5, 6, 7, 0 }) do
    local entry = { set = index }
    local set, why = pcall(function() stack.active_index = index end)
    if not set then entry.error = message(why) end
    entry.read = stack.active_index
    local kept = state(stack)
    entry.exported = kept.exported
    full.active[#full.active + 1] = entry
    stack.active_index = 3
  end

  -- Where the game puts what is added to a book that has an empty slot, and to one that has none.
  full.added = { insert(inventory, "blueprint"), insert(inventory, "blueprint") }
  try(errors, "added blueprints", function()
    set_up_blueprint(inventory[full.added[1].slot], "added first")
    set_up_blueprint(inventory[full.added[2].slot], "added second")
  end)
  full.state_after_adding = state(stack)

  -- The last item taken out: does the book shrink?
  try(errors, "clear last slot", function() inventory[#inventory].clear() end)
  full.size_after_clearing_last = #inventory
  return out
end

local function imports(scratch)
  local stack = scratch[1]
  local out = {}
  for index, case in ipairs(helpers.json_to_table(CASES_JSON)) do
    stack.clear()
    local entry = { label = case.label }
    local ok, result = pcall(stack.import_stack, case.string)
    if ok then
      entry.import_result = result
      local now = state(stack)
      entry.contents, entry.exported, entry.error = now.contents, now.exported, now.error
    else
      entry.error = message(result)
    end
    out[index] = entry
  end
  return out
end

local function filled(inventory)
  local count = 0
  for slot = 1, #inventory do
    if inventory[slot].valid_for_read then count = count + 1 end
  end
  return count
end

-- MANY blueprints, inserted one by one until the book takes no more, and in one book written by hand, none with an `index`.
local function limits(scratch)
  local stack = scratch[1]
  stack.set_stack({ name = "blueprint-book" })
  local inventory = inventory_of(stack)
  local inserted = { tried = MANY, inserted = 0 }
  local ok, err = pcall(function()
    for _ = 1, MANY do
      if inventory.insert({ name = "blueprint", count = 1 }) == 0 then break end
      inserted.inserted = inserted.inserted + 1
    end
  end)
  if not ok then inserted.error = message(err) end
  inserted.size, inserted.filled = #inventory, filled(inventory)
  inserted.can_insert = inventory.can_insert({ name = "blueprint", count = 1 })

  local items = {}
  for index = 1, MANY do items[index] = '{"blueprint":{"item":"blueprint","label":"' .. index .. '"}}' end
  local imported = { sent = MANY }
  stack.clear()
  ok, err = pcall(function()
    imported.import_result = stack.import_stack("0" .. helpers.encode_string('{"blueprint_book":{"item":"blueprint-book","blueprints":[' .. table.concat(items, ",") .. "]}}"))
    inventory = inventory_of(stack)
    imported.size, imported.filled = #inventory, filled(inventory)
    imported.first_label, imported.last_label = inventory[1].label, inventory[#inventory].label
    local written = decode(stack.export_stack()).blueprint_book.blueprints
    imported.exported, imported.last_index = #written, written[#written].index
  end)
  if not ok then imported.error = message(err) end
  return { inserted = inserted, imported = imported }
end

local function run()
  local scratch = game.create_inventory(2)
  local record = { game_version = helpers.game_version }
  if not IMPORTS_ONLY then record.native = native(scratch) end
  record.imports = imports(scratch)
  if not IMPORTS_ONLY then record.limits = limits(scratch) end
  scratch.destroy()
  helpers.write_file(OUTPUT, helpers.table_to_json(record))
end

script.on_init(function()
  local ok, err = pcall(run)
  if not ok then helpers.write_file(ERROR_OUTPUT, message(err)) end
  storage.passed = ok
end)

script.on_event(defines.events.on_tick, function() script.finish_test(storage.passed == true) end)
