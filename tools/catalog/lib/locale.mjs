// Locale sections the game does not dump because they do not belong to prototypes (`--dump-prototype-locale` covers those):
// read from the locale files of the modules themselves. No game process is involved.
import fs from "node:fs";
import path from "node:path";

/** The `key=value` lines of the named `[sections]` of one .cfg file, as { section: { key: value } }. */
export function parseLocale(text, sections) {
  const out = {};
  let current;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const header = /^\[(.+)\]$/.exec(line);
    if (header) current = sections.includes(header[1]) ? (out[header[1]] ??= {}) : undefined;
    // A key may contain "#" (the note "F#3"), so only a line that starts with one is a comment.
    else if (current && line && !line.startsWith(";") && !line.startsWith("#") && line.includes("=")) current[line.slice(0, line.indexOf("="))] = line.slice(line.indexOf("=") + 1);
  }
  return out;
}

/** The named sections as the game shows them with `modules` enabled: core first, then the modules in order, a later one overriding an earlier one. */
export function readLocaleSections(dataDir, modules, sections, language = "en") {
  const out = Object.fromEntries(sections.map((section) => [section, {}]));
  for (const module of ["core", ...modules]) {
    const dir = path.join(dataDir, module, "locale", language);
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir).filter((name) => name.endsWith(".cfg")).sort()) {
      for (const [section, entries] of Object.entries(parseLocale(fs.readFileSync(path.join(dir, file), "utf8"), sections))) Object.assign(out[section], entries);
    }
  }
  return out;
}
