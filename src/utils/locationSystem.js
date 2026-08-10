// Location System — pure helpers for the configurable physical-location model
// stored in shop_settings.json under `location_config`.
//
// A shop can define multiple independent location *systems*. Each system is a
// Zone → Station → Drawer → Bin pattern where each upper level is optional and
// the Bin is always present (auto-incrementing or a fixed value). Levels carry
// `options[]` (stable-UUID entries) for number/letter identifiers; a `custom`
// identifier is a fixed prefix (e.g. "LC") with no per-tool choice.
//
// A tool stores only IDs (system + level option ids + bin number) in metadata —
// never the display string. The composed string is derived here on read, and is
// what gets written to Fusion's vendor field + ProShop's Location column.
//
// This module is framework-free (no React) so it can be called from AppContext,
// the ProShop import/export, and the Settings UI alike.

export const LEVEL_KEYS = ['zone', 'station', 'drawer'];

// ─── IDs ─────────────────────────────────────────────────────────────────────
export function genLocId() {
  return (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : `loc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ─── Factories ───────────────────────────────────────────────────────────────
function blankLevel(levelType, identFormat = 'number') {
  return { on: false, levelType, customTypeName: '', identFormat, customIdent: '', options: [] };
}

// A fresh, empty location system (matches the prototype's addSystem shape).
export function newLocationSystem(name = 'New System') {
  return {
    id: genLocId(),
    name,
    normalized: false,
    allowDuplicates: false,
    proShopExport: 'number_only',  // number_only | full | fixed
    fixedExport: '',
    // How this system claims a bare number on ProShop IMPORT (see the
    // "ProShop import matching" section). Mirror of proShopExport.
    proShopImport: newImportRule(),
    acknowledged_gaps: [],         // skipped bins the user has ruled on (NOT reserved)
    delimiters: { zs: '-', sd: '-', db: '-' },
    levels: {
      zone:    blankLevel('Building', 'number'),
      station: blankLevel('Cabinet', 'number'),
      drawer:  blankLevel('Drawer', 'letter'),
      bin:     { fixed: false, start: 1000, fixedVal: '', skip: [] },
    },
  };
}

// A level option entry { id, label, order }.
export function newLevelOption(label, order) {
  return { id: genLocId(), label, order };
}

// ─── Lookups ─────────────────────────────────────────────────────────────────
export function findSystem(systems, id) {
  return (systems || []).find(s => s.id === id) || null;
}
export function levelOptions(system, levelKey) {
  return system?.levels?.[levelKey]?.options || [];
}
export function findOption(system, levelKey, optionId) {
  return levelOptions(system, levelKey).find(o => o.id === optionId) || null;
}
// The display name for a level — what the shop CALLS it ("Drawer", "Cabinet",
// "Shelf"). Purely a label: it never appears in the composed location string,
// which is built from each level's IDENTIFIER instead.
//
// `fallback` is the level's own slot name (Zone / Station / Drawer), used when
// the type is 'custom' but no name was typed. Falling back to the literal
// "Custom" produced a heading in the Assign Location dialog that said nothing.
export function levelTypeName(level, fallback = 'Custom') {
  if (!level) return '';
  return level.levelType === 'custom' ? (level.customTypeName || fallback) : level.levelType;
}

// ─── Composition ─────────────────────────────────────────────────────────────
// Delimiter between two adjacent active levels, keyed by their first letters
// (zs/sd/db). Non-adjacent junctions (a middle level is off) fall back to '-'.
function junctionDelim(delimiters, aKey, bKey) {
  const key = aKey[0] + bKey[0];
  const d = delimiters?.[key];
  return d == null ? '-' : d;
}

// The value of one configured level for a tool's stored location.
function segmentValue(system, levelKey, loc) {
  const level = system.levels[levelKey];
  if (!level || !level.on) return null;
  if (level.identFormat === 'custom') return level.customIdent || '';
  const opt = findOption(system, levelKey, loc?.[`${levelKey}_id`]);
  return opt ? opt.label : '';
}

// Build the composed location string from a tool's structured location + system.
// Order zone → station → drawer → bin, joined by the per-junction delimiters.
// Returns '' when there's nothing to show.
export function composeLocationString(loc, system) {
  if (!loc || !system) return '';
  const L = system.levels;
  const binVal = L.bin?.fixed
    ? (L.bin.fixedVal || '')
    : (loc.bin != null && loc.bin !== '' ? String(loc.bin) : '');
  const segs = [
    L.zone.on    ? { key: 'zone',    val: segmentValue(system, 'zone', loc) }    : null,
    L.station.on ? { key: 'station', val: segmentValue(system, 'station', loc) } : null,
    L.drawer.on  ? { key: 'drawer',  val: segmentValue(system, 'drawer', loc) }  : null,
    { key: 'bin', val: binVal },
  ].filter(Boolean);
  return segs
    .map((s, i) => (s.val ?? '') + (i < segs.length - 1 ? junctionDelim(system.delimiters, s.key, segs[i + 1].key) : ''))
    .join('');
}

// Config-editor preview using placeholder values (1/A for number/letter levels).
export function buildPreview(system) {
  const L = system.levels;
  const seg = (level, num, let_) => {
    if (!level.on) return null;
    if (level.identFormat === 'custom') return level.customIdent || '…';
    if (level.identFormat === 'letter') return let_;
    return num;
  };
  const binNum = L.bin.fixed ? (L.bin.fixedVal || '1000') : String(L.bin.start);
  const segs = [
    L.zone.on    ? { key: 'zone',    val: seg(L.zone, '1', 'A') }    : null,
    L.station.on ? { key: 'station', val: seg(L.station, '1', 'A') } : null,
    L.drawer.on  ? { key: 'drawer',  val: seg(L.drawer, '1', 'A') }  : null,
    { key: 'bin', val: binNum },
  ].filter(Boolean);
  const out = segs
    .map((s, i) => s.val + (i < segs.length - 1 ? junctionDelim(system.delimiters, s.key, segs[i + 1].key) : ''))
    .join('');
  return out || '—';
}

// ─── Duplicate-output detection ──────────────────────────────────────────────
// Two location systems "clash" when they could produce the same user-visible ID.
// This is checked on the composed OUTPUT recipe, not the settings labels: a
// level's *type name* (Drawer / Cabinet / custom type name) never appears in the
// string, so two systems that label their steps differently but emit the same
// segments still clash. Each segment is reduced to what actually shows:
//   • custom level   → its fixed prefix string
//   • number/letter  → the sorted SET of its option labels (the values that appear)
//   • bin            → the fixed value, or "auto#" (any auto numeric bin can overlap)
// Compared two ways: with the junction delimiters (exact-output identity) and
// without them (structural identity — catches "same except the delimiter").
const normTok = (s) => String(s ?? '').trim().toLowerCase();

function activeSegmentKeys(system) {
  const L = system.levels || {};
  const keys = LEVEL_KEYS.filter(k => L[k]?.on);
  keys.push('bin');
  return keys;
}

function segmentToken(system, key) {
  const L = system.levels;
  if (key === 'bin') return L.bin?.fixed ? `fixed:${normTok(L.bin.fixedVal)}` : 'auto#';
  const lvl = L[key];
  if (lvl.identFormat === 'custom') return `const:${normTok(lvl.customIdent)}`;
  const labels = (lvl.options || []).map(o => normTok(o.label)).filter(Boolean).sort();
  return `${lvl.identFormat}:[${labels.join(',')}]`;
}

// Output recipe including the junction delimiters — exact-output identity.
export function systemOutputSignature(system) {
  const keys = activeSegmentKeys(system);
  return keys
    .map((k, i) => `${k}=${segmentToken(system, k)}` + (i < keys.length - 1 ? `<${junctionDelim(system.delimiters, k, keys[i + 1])}>` : ''))
    .join('');
}

// Output recipe ignoring delimiters — structural identity (near-duplicate).
export function systemStructureSignature(system) {
  return activeSegmentKeys(system).map(k => `${k}=${segmentToken(system, k)}`).join('|');
}

// Find systems that clash. Returns Map(systemId -> conflict[]), each conflict
// { type, otherId, otherName }:
//   'output'    — could produce identical visible IDs (same recipe + delimiters)
//   'delimiter' — same recipe, only the delimiter differs (near-duplicate)
//   'name'      — same (case-insensitive) system name
// A non-blocking warning surfaces these in the UI.
export function findSystemConflicts(systems) {
  const list = systems || [];
  const out = new Map();
  const push = (id, c) => { if (!out.has(id)) out.set(id, []); out.get(id).push(c); };
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      const aName = normTok(a.name), bName = normTok(b.name);
      if (aName && aName === bName) {
        push(a.id, { type: 'name', otherId: b.id, otherName: b.name });
        push(b.id, { type: 'name', otherId: a.id, otherName: a.name });
      }
      if (systemOutputSignature(a) === systemOutputSignature(b)) {
        push(a.id, { type: 'output', otherId: b.id, otherName: b.name });
        push(b.id, { type: 'output', otherId: a.id, otherName: a.name });
      } else if (systemStructureSignature(a) === systemStructureSignature(b)) {
        push(a.id, { type: 'delimiter', otherId: b.id, otherName: b.name });
        push(b.id, { type: 'delimiter', otherId: a.id, otherName: a.name });
      }
    }
  }
  return out;
}

// Resolve the composed string for a tool given the whole systems list (looks up
// the tool's system by id). Falls back to '' when unresolvable.
export function resolveLocationString(loc, systems) {
  if (!loc?.system_id) return '';
  const system = findSystem(systems, loc.system_id);
  return system ? composeLocationString(loc, system) : '';
}

// ─── ProShop export mapping ──────────────────────────────────────────────────
// The composed string → the value written to ProShop's Location column.
export function proShopLocationValue(system, composed) {
  if (!system) return composed || '';
  switch (system.proShopExport) {
    case 'number_only': return (composed || '').replace(/[^0-9]/g, '');
    case 'fixed':       return system.fixedExport || '';
    case 'full':
    default:            return composed || '';
  }
}

// ─── Bin numbering ───────────────────────────────────────────────────────────
// Next available bin for an auto-increment system: continues ABOVE the highest
// bin in use (≥ start, not skipped, not used).
//
// ⚠️ It deliberately does NOT fill the lowest hole. A gap in the sequence means
// a bin whose tool hasn't been accounted for yet — very often something IS
// physically sitting in it — so handing that number to the next new tool would
// quietly double-book a drawer. Auto-assignment always moves forward; a hole is
// filled only when a person decides to, by typing the number into the location
// picker (which allows any bin that isn't already taken). That's the whole
// reason a reported gap is not a reservation: skipping it here is what makes it
// safe to leave it assignable there.
// Returns null when there is no meaningful "next" — a system that ALLOWS
// duplicates isn't a sequence, so continuing past the highest value would
// invent a number nobody asked for (a shop parking every tool on one sentinel
// bin would be offered sentinel+1, and a suggestion that's silently wrong is
// worse than none: the picker falls back to the suggestion when the field is
// left blank). Callers must treat null as "no suggestion, make the user pick".
export function nextBin(system, usedBins = new Set()) {
  const bin = system?.levels?.bin;
  if (!bin || bin.fixed) return bin?.fixedVal || '';
  if (system?.allowDuplicates) return null;
  const skip = new Set((bin.skip || []).map(Number));
  const used = usedBins instanceof Set ? usedBins : new Set(usedBins);
  const start = Number(bin.start) || 1;
  // ⚠️ Continue above the highest IN-RANGE bin, not the highest bin outright.
  // An out-of-range outlier (a tool left on a sentinel like 10000 in a cabinet
  // that ends at 253) would otherwise push every new tool to 10001 — worse than
  // the hole-filling this replaced. analyzeBinSequence already knows which bins
  // are outliers; nextBin has to ask it rather than trusting the raw maximum.
  const { outliers } = analyzeBinSequence(system, used);
  const outlierSet = new Set(outliers);
  let maxUsed = null;
  for (const n of used) {
    if (outlierSet.has(n)) continue;
    if (maxUsed == null || n > maxUsed) maxUsed = n;
  }
  let n = (maxUsed != null && maxUsed >= start) ? maxUsed + 1 : start;
  while (skip.has(n) || used.has(n)) n++;
  return n;
}

// Bins already taken within a system across the library (numbers only).
export function usedBinsForSystem(records, systemId) {
  const used = new Set();
  for (const t of records || []) {
    const loc = t.tool_location;
    if (loc?.system_id === systemId && loc.bin != null && loc.bin !== '') {
      const n = Number(loc.bin);
      if (!Number.isNaN(n)) used.add(n);
    }
  }
  return used;
}

// ⚠️ An insert tool's location lives on its COMPONENTS, not on the tool.
// A pairing (a face mill = body + inserts) is not a thing in a drawer — its two
// halves are, each with its own ProShop number and its own bin. So a paired tool
// with its components linked must NOT be counted as "needs a location": it has
// none by design, and reporting it inflates every count on the Location screen
// and makes the whole thing read as broken. A pairing whose components are NOT
// linked yet still counts — nothing is holding its location.
export function holdsOwnLocation(record) {
  const p = record?.pairing;
  if (!p) return true;
  return !(p.holder_component_id || p.insert_component_id);
}

// ─── Records: tools AND components ───────────────────────────────────────────
// ⚠️ Everything below operates on RECORDS, not tools. A component (an insert
// tool's holder body / insert) is a real physical object in a real drawer, so it
// carries the same structured `tool_location`, sits in the same systems, and
// occupies a bin exactly like a tool. It only lives in a different FILE
// (tool_components.json) so it can never reach Fusion — a storage detail, never
// a difference in how locations work. Callers must pass the POOLED list;
// counting only tools reports every component's bin as empty.

// ─── Normalization parsing ───────────────────────────────────────────────────
// Build a lenient regex that matches a free-text location against a system's
// pattern. Inter-segment separators are matched loosely (any run of space / dash
// / dot / slash / pipe / underscore) because legacy strings are inconsistent
// ("LC 84", "LC14", "LC -158"). Returns { regex, levelKeys } or null when the
// system can't be parsed (a number/letter level with no options to match).
function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function buildParseRegex(system) {
  const L = system.levels;
  const parts = [];
  const capturedLevels = [];
  const SEP = '[\\s\\-._/|]*';
  for (const key of LEVEL_KEYS) {
    const level = L[key];
    if (!level.on) continue;
    if (parts.length) parts.push(SEP);
    if (level.identFormat === 'custom') {
      if (!level.customIdent) return null;
      // A custom prefix (e.g. "LC") carries no per-tool data — it's the same for
      // every tool at this level — so accept it as OPTIONAL when parsing. A bare
      // bin number like "140" (how ProShop stores a location) then parses to the
      // same bin as "LC-140". Without this, tools whose location is stored as just
      // the number are missed by normalization (they land in "unmatched", so their
      // bins aren't counted and the next-available bin is wildly wrong).
      parts.push('(?:' + escapeRe(level.customIdent) + ')?');
    } else {
      const opts = level.options || [];
      if (opts.length === 0) return null; // nothing to match this level against
      parts.push('(' + opts.map(o => escapeRe(o.label)).join('|') + ')');
      capturedLevels.push(key);
    }
  }
  // Bin: a fixed value is a literal; auto-increment captures a number.
  if (parts.length) parts.push(SEP);
  if (L.bin.fixed) {
    if (!L.bin.fixedVal) return null;
    parts.push(escapeRe(L.bin.fixedVal));
  } else {
    parts.push('(\\d+)');
    capturedLevels.push('bin');
  }
  return { regex: new RegExp('^\\s*' + parts.join('') + '\\s*$', 'i'), capturedLevels };
}

// Try to parse a single free-text location string against a system.
// On success returns a structured tool_location { system_id, …ids, bin }.
export function parseLocationString(str, system) {
  const text = (str || '').trim();
  if (!text) return null;
  const built = buildParseRegex(system);
  if (!built) return null;
  const m = text.match(built.regex);
  if (!m) return null;
  const loc = {
    system_id: system.id, zone_id: null, station_id: null, drawer_id: null,
    // A fixed-bin system captures nothing — its bin IS the configured value, and
    // normalize must record the same shape the import and picker write.
    bin: system.levels?.bin?.fixed ? normalizeBin(system.levels.bin.fixedVal) : null,
  };
  built.capturedLevels.forEach((key, i) => {
    const captured = m[i + 1];
    if (key === 'bin') {
      loc.bin = normalizeBin(captured);
    } else {
      const opt = levelOptions(system, key).find(o => o.label.toLowerCase() === captured.toLowerCase());
      loc[`${key}_id`] = opt ? opt.id : null;
    }
  });
  return loc;
}

// ─── Analysis (read-only) ────────────────────────────────────────────────────
// Scan the library for tools that could be assigned to `system`. A tool is a
// candidate when it is not already assigned to this system. Returns matched
// (with the parsed structured location), unmatched (had location text but no
// parse), a noLocation count, and the next available bin after the matches.
export function analyzeSystem(records, system, systems = null) {
  const matched = [];
  const unmatched = [];
  let noLocation = 0;
  const used = usedBinsForSystem(records, system.id);
  const list = records || [];

  // ⚠️ Uniqueness is judged over the WHOLE library, exactly as it is on import —
  // a number that many records share is not "unique" just because most of them
  // are already filed away.
  const counts = countLocationNumbers(list.map(r => ({ value: r.location })));
  const cascade = systems && hasConfiguredImportRules(systems);

  for (const tool of list) {
    // An insert pairing's location is held by its components — see holdsOwnLocation.
    if (!holdsOwnLocation(tool)) continue;
    const current = tool.tool_location?.system_id;
    if (current === system.id) continue;   // already in this system
    // ⚠️ A record already filed in ANOTHER system is settled — normalize assigns
    // UNASSIGNED records, it does not re-route assigned ones. Without this, a
    // system with a lenient pattern silently steals them: an "LC" system whose
    // prefix is optional parses a drill-index record's bare "10000" as LC bin
    // 10000, and normalize would have moved all of them out of the system they
    // correctly belong to. Moving between systems is the ProShop import's job
    // (it routes by the per-system rules) or a manual re-assign.
    if (current) continue;
    const text = (tool.location || '').trim();
    if (!text) { noLocation++; continue; }
    const parsed = parseLocationString(text, system);
    if (parsed) {
      // Same question the import answers: which system OWNS this number? When
      // the shop has configured rules, honour them here too — otherwise the most
      // permissive pattern wins by accident rather than by intent.
      if (cascade && parsed.bin != null) {
        const owner = claimSystemForNumber(Number(parsed.bin), systems, counts);
        if (owner && owner.id !== system.id) { unmatched.push({ tool, location: text }); continue; }
      }
      if (parsed.bin != null) used.add(Number(parsed.bin));
      matched.push({ tool, location: parsed, previous: text });
    } else {
      unmatched.push({ tool, location: text });
    }
  }
  const binCfg = system.levels.bin;
  const next = binCfg.fixed ? null : nextBin(system, used);
  return { matched, unmatched, noLocation, nextBin: next };
}

// ─── Library-wide status (across all normalized systems) ─────────────────────
// Derives the union of tools not assigned to any system, split into "has
// unmatched location text" vs "no location at all". Only meaningful once at
// least one system is normalized.
export function libraryLocationStatus(records, systems) {
  const list = records || [];
  // `normalized` marks that the user ran the one-time migration — it does NOT
  // mean "this system has records". A shop whose locations all arrived via the
  // ProShop import never sets it, and gating on it hid the ONE panel that says
  // how many records are actually placed: the library looked unconnected while
  // 235 tools sat correctly in a system.
  const anyPlaced = list.some(r => r.tool_location?.system_id && findSystem(systems, r.tool_location.system_id));
  if (!anyPlaced && !(systems || []).some(s => s.normalized)) return null;
  const assignedTools = [];
  const unassigned = [];
  for (const tool of list) {
    // A paired tool has no location of its own — its components carry it, and
    // listing it as unassigned is a row the user can never clear.
    if (!holdsOwnLocation(tool)) continue;
    const sysId = tool.tool_location?.system_id;
    if (sysId && findSystem(systems, sysId)) assignedTools.push(tool);
    else unassigned.push(tool);
  }
  const withLocation = unassigned.filter(t => (t.location || '').trim());
  const withoutLocation = unassigned.filter(t => !(t.location || '').trim());
  return {
    // The POPULATION this panel is about — records that can hold a location.
    // Counting the excluded pairings here would leave assigned + unassigned
    // failing to add up to the total shown right next to them.
    total: assignedTools.length + unassigned.length,
    assigned: assignedTools.length,
    unassigned: unassigned.length,
    withLocation: withLocation.length,
    withoutLocation: withoutLocation.length,
    unassignedTools: unassigned,
  };
}

// ─── Library-side location issues (derived, never stored) ────────────────────
// The durable worklist: everything about the CURRENT library that isn't a clean
// 100% match. Recomputed on every read like analyzeSystem, so it's always
// reachable, always current, and each row disappears by itself as the tool
// behind it is fixed — there is no report to save or go stale.
//
// Distinct from the import-time exception list (which is about rows in a CSV);
// this is about tools in the library.
export function libraryLocationIssues(records, systems) {
  const list = records || [];
  const out = [];
  for (const sys of systems || []) {
    const rule = systemImportRule(sys);
    const inSystem = list.filter(t => t.tool_location?.system_id === sys.id);

    // Two tools on one bin, in a system that doesn't expect it.
    if (!sys.allowDuplicates && !sys.levels?.bin?.fixed) {
      const byBin = new Map();
      for (const t of inSystem) {
        const n = t.tool_location?.bin;
        if (n == null || n === '') continue;
        const k = Number(n);
        if (Number.isNaN(k)) continue;
        if (!byBin.has(k)) byBin.set(k, []);
        byBin.get(k).push(t);
      }
      for (const [bin, dupes] of byBin) {
        if (dupes.length < 2) continue;
        out.push({
          type: 'duplicate', systemId: sys.id, systemName: sys.name, bin,
          tools: dupes.map(t => ({ id: t.id, tool_id: t.tool_id, description: t.description })),
        });
      }
    }

    // Holes in the occupied range — informational only, and reported as RUNS so
    // a stretch of consecutive empties is one row instead of hundreds.
    if (rule.flagGaps) {
      const usedHere = usedBinsForSystem(list, sys.id);
      const { gaps, outliers } = analyzeBinSequence(sys, usedHere);
      for (const g of gaps) {
        out.push({ type: 'gap', systemId: sys.id, systemName: sys.name, from: g.from, to: g.to, count: g.count });
      }
      // A bin far above the rest is almost always a tool that belongs to another
      // system — the actually-actionable finding hiding behind the phantom gaps.
      for (const bin of outliers) {
        const tools = inSystem.filter(t => Number(t.tool_location?.bin) === bin);
        out.push({
          type: 'outlier', systemId: sys.id, systemName: sys.name, bin,
          tools: tools.map(t => ({ id: t.id, tool_id: t.tool_id, description: t.description })),
        });
      }
    }
  }
  return out;
}

// ⚠️ ONE canonical shape for a stored bin. A fixed-bin system's `fixedVal` is a
// config STRING, so writing it straight through stored "10000" while every
// auto-increment system stored the number 10000 — the same bin in two types,
// from three different write paths (ProShop import, the picker, and normalize,
// which stored null for a fixed bin because the parser never captures one).
// Numeric values are stored as numbers; a non-numeric fixed label (e.g. "SHELF")
// stays a string. Existing string bins compare equal via String(), so adopting
// this changes nothing that is already stored — it just stops the drift.
export function normalizeBin(value) {
  if (value == null || value === '') return null;
  const text = String(value).trim();
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : text;
}

// An empty structured location for a given system (nothing picked yet).
export function emptyLocation(systemId) {
  return { system_id: systemId, zone_id: null, station_id: null, drawer_id: null, bin: null };
}

// Extract the numeric bin from a location value. ProShop stores a location as a
// bare number (no "LC-" prefix); the app's composed string carries the prefix
// (e.g. "LC-1405"). Comparing on the number lets "LC-1405" and "1405" match as
// the same bin. Returns null when there are no digits.
export function locationNumber(value) {
  if (value == null || value === '') return null;
  const digits = String(value).replace(/\D/g, '');
  if (!digits) return null;
  const n = parseInt(digits, 10);
  return isNaN(n) ? null : n;
}

// ─── ProShop import matching (per-system, configurable) ──────────────────────
// ProShop stores a location as a BARE NUMBER with no system prefix, so a number
// alone cannot say which location system it belongs to. Rather than hardcode a
// shop's conventions, each system carries its own `proShopImport` rule and the
// systems are evaluated as a cascade — the config equivalent of the long IF
// statement a shop would otherwise write in Excel.
//
// This is the mirror image of the existing per-system `proShopExport` rule, and
// it drives BOTH the initial bulk import and the location-only re-import.
//
// Modes:
//   'off'        — this system never claims an imported value
//   'any_unique' — claims any number appearing exactly ONCE across the file
//   'triggers'   — claims the specific values listed (e.g. a sentinel number a
//                  shop uses to mean "in the drill index"); pairs with
//                  allowDuplicates, since a sentinel repeats by design
//   'range'      — claims any number within [min, max]
export const IMPORT_MATCH_MODES = ['off', 'any_unique', 'triggers', 'range'];

export function newImportRule() {
  return {
    match: 'off',
    triggers: [],                  // literal numbers this system claims
    range: { min: null, max: null },
    flagGaps: false,               // report skipped numbers in the used range
  };
}

// Read a system's import rule, defaulting for configs saved before this existed
// (additive/optional — nothing to migrate).
export function systemImportRule(system) {
  const r = system?.proShopImport;
  if (!r) return newImportRule();
  return {
    ...newImportRule(),
    ...r,
    triggers: Array.isArray(r.triggers) ? r.triggers.map(Number).filter(n => !Number.isNaN(n)) : [],
    range: { min: r.range?.min ?? null, max: r.range?.max ?? null },
  };
}

// Parse the comma-separated trigger box into numbers (UI helper).
export function parseTriggerList(text) {
  return String(text ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(Number)
    .filter(n => !Number.isNaN(n));
}

// Has the shop configured import matching at all? (Any system with a rule other
// than 'off'.) Drives the legacy fallback in claimSystemForNumber.
export function hasConfiguredImportRules(systems) {
  return (systems || []).some(s => systemImportRule(s).match !== 'off');
}

// Pre-config behaviour: exactly one bin-only system claims everything; anything
// more ambiguous claims nothing (the old proShopStructuredLocation rule).
function legacyClaimSystem(systems) {
  const usable = (systems || []).filter(isBinOnlySystem);
  return usable.length === 1 ? usable[0] : null;
}

// A system whose only per-tool variable is the BIN — every upper level is off or
// a fixed custom prefix. Only then can a bare number fully determine a structured
// location; a system with selectable level options needs a per-tool choice.
export function isBinOnlySystem(system) {
  const L = system?.levels || {};
  const ok = (lv) => !lv || !lv.on || lv.identFormat === 'custom';
  return ok(L.zone) && ok(L.station) && ok(L.drawer);
}

// Which system claims a given imported number.
//
// EXPLICIT TRIGGERS WIN over generic rules, regardless of system order. Pure
// ordered evaluation isn't enough: a sentinel value is only recognizable as one
// because the user TYPED it in, not because of how often it happens to appear.
// If a shop's sentinel showed up just once in a given export, an 'any_unique'
// system earlier in the order would swallow it — so a literal the user entered
// is treated as the stronger statement of intent.
//
// `counts` is a file-wide Map(number -> occurrences); uniqueness must be judged
// across the WHOLE file, never streamed, or the first occurrence of a repeated
// value looks unique and lands in the wrong system.
export function claimSystemForNumber(num, systems, counts) {
  const list = systems || [];
  // No rules configured anywhere → keep the pre-config behaviour: a single
  // bin-only system claims every number. Without this an established shop's
  // import would silently stop assigning locations the moment this feature
  // shipped (the rules default to 'off'), so the config stays purely additive.
  if (!hasConfiguredImportRules(list)) return legacyClaimSystem(list);
  for (const sys of list) {
    const rule = systemImportRule(sys);
    if (rule.match === 'triggers' && rule.triggers.includes(num)) return sys;
  }
  for (const sys of list) {
    const rule = systemImportRule(sys);
    if (rule.match === 'range') {
      const { min, max } = rule.range;
      // An UNBOUNDED range claims nothing. Both boxes empty is a half-finished
      // setting, not "every number" — treating it as a match would silently make
      // this system swallow the whole file (and, being a generic rule, quietly
      // outrank every later system) the moment the mode was selected.
      if (min == null && max == null) continue;
      const okMin = min == null || num >= Number(min);
      const okMax = max == null || num <= Number(max);
      if (okMin && okMax) return sys;
    } else if (rule.match === 'any_unique') {
      if ((counts.get(num) || 0) === 1) return sys;
    }
  }
  return null;
}

// Count each location number across the whole set of incoming rows.
export function countLocationNumbers(rows) {
  const counts = new Map();
  for (const row of rows || []) {
    const n = locationNumber(row?.value);
    if (n == null) continue;
    counts.set(n, (counts.get(n) || 0) + 1);
  }
  return counts;
}

// Gaps in a system's occupied bin range: numbers with no tool, between the first
// and last occupied bin. Excludes reserved (`skip`) and acknowledged gaps.
//
// A gap is INFORMATIONAL, never a reservation — acknowledging one silences the
// report row without making the number unassignable, and the acknowledgement
// clears itself as soon as a tool lands there (see pruneAcknowledgedGaps).
// A run of consecutive empties longer than this means the numbers above it are
// not part of this system's sequence — see analyzeBinSequence.
export const GAP_RUN_LIMIT = 25;

// Split a system's occupied bins into real gaps vs out-of-range outliers.
//
// ⚠️ Naively reporting "every empty number between the lowest and highest bin"
// collapses the moment ONE bin is far above the rest: a single tool sitting on
// 1000 in a cabinet that really ends at 253 invents ~750 phantom gaps, and a
// worklist with 750 rows is wallpaper — the exact failure the checklist warns
// about. It is also untrue: nothing is "skipped" up there, the sequence simply
// stopped.
//
// So a run of more than `maxRun` consecutive empties is read as the END of the
// sequence, not as gaps. Bins at or above it are reported as OUTLIERS instead —
// which is the actually-useful finding, because an outlier is nearly always a
// tool that belongs to a different system (a drill-index sentinel left in the
// cabinet system, say). Gaps below that point are returned grouped into runs,
// so a handful of consecutive holes reads as one row rather than several.
export function analyzeBinSequence(system, usedBins, { maxRun = GAP_RUN_LIMIT } = {}) {
  const empty = { gaps: [], outliers: [] };
  const bin = system?.levels?.bin;
  if (!bin || bin.fixed) return empty;
  const used = usedBins instanceof Set ? usedBins : new Set(usedBins || []);
  if (used.size === 0) return empty;
  const skip = new Set((bin.skip || []).map(Number));
  const ack = new Set((system.acknowledged_gaps || []).map(Number));
  const nums = [...used].sort((a, b) => a - b);

  // Walk the occupied bins; the first oversized hole ends the sequence.
  let cutoff = null;
  for (let i = 1; i < nums.length; i++) {
    if (nums[i] - nums[i - 1] - 1 > maxRun) { cutoff = nums[i]; break; }
  }
  const outliers = cutoff == null ? [] : nums.filter(n => n >= cutoff);
  const top = cutoff == null ? nums[nums.length - 1] : nums[nums.indexOf(cutoff) - 1];

  // Gaps below the cutoff, grouped into consecutive runs.
  const gaps = [];
  let run = null;
  for (let n = nums[0]; n < top; n++) {
    const missing = !used.has(n) && !skip.has(n) && !ack.has(n);
    if (missing) {
      if (run && run.to === n - 1) run.to = n;
      else { run = { from: n, to: n }; gaps.push(run); }
    } else if (!missing) {
      run = null;
    }
  }
  return { gaps: gaps.map(g => ({ ...g, count: g.to - g.from + 1 })), outliers };
}

// Flat list of gap numbers (outliers excluded). Kept for callers that just want
// the numbers; analyzeBinSequence is the richer form.
export function findBinGaps(system, usedBins) {
  const { gaps } = analyzeBinSequence(system, usedBins);
  const out = [];
  for (const g of gaps) for (let n = g.from; n <= g.to; n++) out.push(n);
  return out;
}

// Drop acknowledgements for bins that are now occupied — an acknowledged gap is
// a note about an EMPTY number, so filling it makes the note meaningless. Keeps
// a re-acknowledged gap from lingering after the hole is filled.
export function pruneAcknowledgedGaps(system, usedBins) {
  const ack = (system?.acknowledged_gaps || []).map(Number).filter(n => !Number.isNaN(n));
  if (!ack.length) return system;
  const used = usedBins instanceof Set ? usedBins : new Set(usedBins || []);
  const next = ack.filter(n => !used.has(n));
  if (next.length === ack.length) return system;
  return { ...system, acknowledged_gaps: next };
}

// Route every incoming ProShop location through the cascade.
//
// `rows` = [{ key, value }] — key identifies the row (a ProShop Tool #), value is
// the raw Location cell. Returns the structured assignment for each claimed row
// plus an exception list of everything that wasn't a 100% clean match.
//
// Exception types:
//   'no_value'     — the row has no usable number (blank / non-numeric cell)
//   'unmatched'    — a number no system's rule claimed
//   'duplicate'    — repeated number in a system that does NOT allow duplicates
//   'needs_levels' — claimed by a system a bare number can't fully determine
export function routeProShopLocations(rows, systems) {
  const list = rows || [];
  const counts = countLocationNumbers(list);
  const assignments = [];
  const exceptions = [];
  const bySystem = new Map();
  // Which rows share each number, per system — a duplicate is only a problem
  // within the system that claimed it.
  const claimedByNum = new Map();

  for (const row of list) {
    const num = locationNumber(row?.value);
    if (num == null) {
      exceptions.push({ type: 'no_value', key: row?.key, value: row?.value ?? '' });
      continue;
    }
    const sys = claimSystemForNumber(num, systems, counts);
    if (!sys) {
      exceptions.push({ type: 'unmatched', key: row?.key, value: row?.value, bin: num });
      continue;
    }
    if (!isBinOnlySystem(sys)) {
      exceptions.push({
        type: 'needs_levels', key: row?.key, value: row?.value, bin: num,
        systemId: sys.id, systemName: sys.name,
      });
      continue;
    }
    const binVal = sys.levels?.bin?.fixed ? normalizeBin(sys.levels.bin.fixedVal) : num;
    const location = { system_id: sys.id, zone_id: null, station_id: null, drawer_id: null, bin: binVal };
    const entry = { key: row?.key, bin: num, systemId: sys.id, systemName: sys.name, location };
    assignments.push(entry);
    if (!bySystem.has(sys.id)) bySystem.set(sys.id, { system: sys, rows: [] });
    bySystem.get(sys.id).rows.push(entry);
    const dupKey = `${sys.id}:${num}`;
    if (!claimedByNum.has(dupKey)) claimedByNum.set(dupKey, []);
    claimedByNum.get(dupKey).push(entry);
  }

  // Duplicates — only where the system says they aren't expected.
  for (const [dupKey, entries] of claimedByNum) {
    if (entries.length < 2) continue;
    const sysId = dupKey.slice(0, dupKey.lastIndexOf(':'));
    const sys = findSystem(systems, sysId);
    if (sys?.allowDuplicates) continue;
    exceptions.push({
      type: 'duplicate', bin: entries[0].bin, systemId: sysId, systemName: sys?.name || '',
      keys: entries.map(e => e.key),
    });
  }

  // Per-system summary + gaps.
  const perSystem = [];
  for (const sys of systems || []) {
    const claimed = bySystem.get(sys.id)?.rows || [];
    const rule = systemImportRule(sys);
    const used = new Set(claimed.map(e => e.bin));
    perSystem.push({
      systemId: sys.id,
      systemName: sys.name,
      matched: claimed.length,
      gaps: rule.flagGaps ? findBinGaps(sys, used) : [],
    });
  }

  return { assignments, exceptions, perSystem };
}
