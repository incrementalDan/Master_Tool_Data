// Sequence Detail import — match a posted CSV to a ToolDex program, link its
// tools, and report what blocks the upload. Pure (no React, no Drive): the
// dialog drives file → preview → commit around `buildSequenceImport`, exactly
// as ProgramsImportModal drives buildProgramsImport.
//
// ⚠️ NOTHING HERE CORRECTS A CSV VALUE. The CSV is a pass-through of proven job
// data (see sequenceDetail.js) — every stored/printed value is the post's own
// string. Matching against the library only ever ADDS a foreign key or RAISES A
// FLAG; a library value never replaces a CSV value.
//
// Two blocking rules, both deliberate:
//   1. No matching program record → do not store. ToolDex assigns program
//      numbers, so this should be rare and means something is genuinely wrong.
//   2. A ProShop Tool # that resolves to no tool → do not store. A tool list
//      with a hole in it prints labels for an assembly nobody can look up.
// Both block the WHOLE upload — a partially-stored program would print a
// partial set of labels, which is worse than printing none.
import { activeHolders } from '../schema/holderRecord.js';
import { generateId } from '../schema/identity.js';
import { operationByProgramNumber, routingById, partById } from './parts.js';
import {
  parseSequenceCsv, condenseTools, programNumberFromFileName, proShopIdKey, postedToIso,
  bareProShopNumber,
} from './sequenceDetail.js';

// ── Tool lookup ──────────────────────────────────────────────────────────────
// Keyed by the normalized ProShop id — which for an insert tool is the
// unordered set of its two halves, so Fusion's arbitrary order/spacing
// (`I-224 / G-223` vs `G223/I224`) still resolves.
//
// LEGACY IDS COUNT. `legacy_ids[]` holds the shop's own retired numbers from an
// ID-scheme renumber; a CSV posted before that renumber names the old number
// for a tool that is very much still in the library. Blocking there would be
// the app failing on a change the app itself made. The current id always wins
// when both resolve — legacy is a fallback, never an override.
export function buildToolIndex(tools) {
  const current = new Map();
  const legacy = new Map();
  // Bare-number indexes for the LOOSE match (bulk import of old files only).
  // ⚠️ A number claimed by two different tools is recorded as AMBIGUOUS and
  // matches nothing. ProShop's counter is shop-wide so this shouldn't happen,
  // but a loose match that guesses between two real tools would attach a program
  // to the wrong one — silently, and in bulk.
  const byNumber = new Map();
  const byNumberLegacy = new Map();
  const ambiguous = new Set();

  const addNumber = (map, num, tool) => {
    if (!num) return;
    const held = map.get(num);
    if (held && held.id !== tool.id) { ambiguous.add(num); return; }
    if (!held) map.set(num, tool);
  };

  for (const t of tools || []) {
    const key = proShopIdKey(t.tool_id);
    if (key && !current.has(key)) current.set(key, t);
    addNumber(byNumber, bareProShopNumber(t.tool_id), t);
    for (const old of t.legacy_ids || []) {
      const lk = proShopIdKey(old);
      if (lk && !legacy.has(lk)) legacy.set(lk, t);
      addNumber(byNumberLegacy, bareProShopNumber(old), t);
    }
  }
  return { current, legacy, byNumber, byNumberLegacy, ambiguous };
}

// `loose` widens the match to the bare NUMBER, ignoring the letter prefix — for
// the bulk import of old posted files, where a number was often mis-typed or
// pre-dates a re-lettering. Deliberately OFF for a deliberate upload: there, a
// miss means something is wrong and the person is right there to fix it.
export function findToolByProShopId(index, raw, { loose = false } = {}) {
  const key = proShopIdKey(raw);
  if (!key) return { tool: null, via: null };
  if (index.current.has(key)) return { tool: index.current.get(key), via: 'tool_id' };
  if (index.legacy.has(key)) return { tool: index.legacy.get(key), via: 'legacy_id' };
  if (!loose) return { tool: null, via: null };

  const num = bareProShopNumber(raw);
  if (!num || index.ambiguous?.has(num)) return { tool: null, via: null };
  if (index.byNumber?.has(num)) return { tool: index.byNumber.get(num), via: 'number' };
  if (index.byNumberLegacy?.has(num)) return { tool: index.byNumberLegacy.get(num), via: 'legacy_number' };
  return { tool: null, via: null };
}

// ── Holder lookup (OPTIONAL enrichment) ──────────────────────────────────────
// Holder matching is not critical yet: the CSV's holder string is what gets
// stored and printed either way. A match only adds a pointer for later phases;
// a miss shows a small indicator. It is deliberately an exact (normalized)
// description match — a fuzzy guess here would attach the wrong holder record
// to a proven assembly, and real holder matching (taper, collet, gauge length,
// extension) is its own later phase.
const holderKey = (s) => String(s ?? '').trim().toUpperCase().replace(/\s+/g, ' ');

export function buildHolderIndex(holderRecords) {
  const map = new Map();
  for (const h of activeHolders(holderRecords)) {
    const k = holderKey(h.description);
    if (k && !map.has(k)) map.set(k, h);
  }
  return map;
}

// ── Location ─────────────────────────────────────────────────────────────────
// Compared on the BIN NUMBER only: the CSV writes "LC-244" or a bare "244"
// depending on the post, and the app composes its own prefix. A disagreement is
// FLAGGED, never resolved — the CSV wins as the stored value, and what to do
// about the difference is a later phase.
const binOf = (s) => {
  const digits = String(s ?? '').replace(/\D/g, '');
  return digits || null;
};

// ⚠️ LOCATION IS THE ONE DELIBERATE EXCEPTION TO "THE CSV WINS".
//
// Everywhere else the CSV is fact, because it's what the machine will actually
// do and a wrong value is a crash. Location isn't like that: the CSV's LC comes
// from Fusion's vendor field, which the app writes lazily (a tool's Fusion copy
// only catches up on its next individual save), so a posted file routinely
// carries a location the shop has since changed. ToolDex OWNS location — it has
// the Location System, the bins and the ProShop import behind it — so the app's
// value is the more current one, and it's the one that belongs on the label the
// operator uses to go find the tool.
//
// This changes DISPLAY and PRINT only. The CSV's own value is still stored
// verbatim on the row, and the raw file is never edited.
export function resolveRowLocation(row, toolsById) {
  const csv = String(row?.lc ?? '').trim();
  const tool = row?.tool_ref ? toolsById?.get?.(row.tool_ref) : null;
  const app = String(tool?.location ?? '').trim();
  // No linked tool, or the app doesn't know where this one lives (an insert
  // tool keeps its location on its components) — the CSV is all there is.
  if (!app) return { value: csv, source: 'csv', csv, app: '' };
  return { value: app, source: 'app', csv, app };
}

export function locationConflict(csvLc, tool) {
  const csvBin = binOf(csvLc);
  const appBin = binOf(tool?.location);
  if (!csvBin || !appBin) return null;       // nothing to disagree about
  if (csvBin === appBin) return null;
  return { csv: String(csvLc).trim(), app: String(tool.location).trim() };
}

// ── Build ────────────────────────────────────────────────────────────────────
// Returns { blockers[], detail, flags, program, part, parsed }.
// `blockers` non-empty ⇒ nothing may be stored.
export function buildSequenceImport({
  csvText,
  fileName,
  partsFile = {},
  tools = [],
  holderRecords = [],
  existingDetails = [],
  uploadedBy = '',
  // ── Bulk-pass options. Both OFF for a deliberate upload. ──
  // ⚠️ `allowUnmatchedTools` is the ONE blocker that is a policy choice rather
  // than a structural limit. A deliberate upload of a current posted file stays
  // strict — a Tool # resolving to nothing means something is wrong and the
  // person is right there. A run over years of old files must not throw away a
  // whole program because one number was mis-typed years ago, so the row is
  // stored with `tool_ref: null` and flagged instead.
  allowUnmatchedTools = false,
  looseToolMatch = false,
} = {}) {
  const blockers = [];
  const parsed = parseSequenceCsv(csvText);

  // ── The program: matched on the FILENAME, never the row-0 header ──
  // A program IS an operation — the number lives on the operation record (an OP
  // has at most one program), so this resolves straight to the step it belongs
  // to, and its routing and part come off that.
  const programNumber = programNumberFromFileName(fileName);
  const program = programNumber == null ? null : operationByProgramNumber(partsFile, programNumber);

  if (programNumber == null) {
    blockers.push({
      type: 'filename',
      message: `Can't read a program number from "${fileName}". The file must be named for its program, e.g. O1218.csv.`,
    });
  } else if (!program) {
    blockers.push({
      type: 'no_program',
      message: `No program O${programNumber} in ToolDex. Add the program first — ToolDex is what assigns program numbers.`,
    });
  }

  if (parsed.missingColumns.length > 0) {
    blockers.push({
      type: 'columns',
      message: `This doesn't look like a Sequence Detail export — missing column${parsed.missingColumns.length !== 1 ? 's' : ''}: ${parsed.missingColumns.join(', ')}.`,
    });
  }

  const routing = program ? routingById(partsFile, program.routing_id) : null;
  const part = routing ? partById(partsFile, routing.part_id) : null;

  // ── Tools ──
  const toolIndex = buildToolIndex(tools);
  const holderIndex = buildHolderIndex(holderRecords);
  const condensed = condenseTools(parsed.rows);

  const lcConflicts = [];
  const unmatchedHolders = [];
  const legacyMatches = [];
  const looseMatches = [];
  const missingTools = [];

  const toolRows = condensed.map(row => {
    const { tool, via } = findToolByProShopId(toolIndex, row.tool_id, { loose: looseToolMatch });
    if (!tool) missingTools.push({ t: row.t, tool_id: row.tool_id, description: row.description });
    else if (via === 'legacy_id' || via === 'legacy_number') legacyMatches.push({ t: row.t, tool_id: row.tool_id, current: tool.tool_id });
    else if (via === 'number') looseMatches.push({ t: row.t, tool_id: row.tool_id, current: tool.tool_id });

    const holder = holderIndex.get(holderKey(row.holder)) || null;
    if (row.holder && !holder) unmatchedHolders.push({ t: row.t, holder: row.holder });

    const lc = tool ? locationConflict(row.lc, tool) : null;
    if (lc) lcConflicts.push({ t: row.t, tool_id: row.tool_id, ...lc });

    return {
      // Every value below is the CSV's own string — see the pass-through rule.
      t: row.t,
      t_num: row.t_num,
      tool_id: row.tool_id,
      description: row.description,
      cut_dia: row.cut_dia,
      tip: row.tip,
      holder: row.holder,
      ooh: row.ooh,
      lc: row.lc,
      rta: row.rta,
      seqs: row.seqs,
      // …and everything below is a LINK, never a value.
      tool_ref: tool ? tool.id : null,
      matched_via: via,
      holder_id: holder ? holder.id : null,
    };
  });

  if (toolRows.length === 0 && blockers.length === 0) {
    blockers.push({ type: 'empty', message: 'No tool rows found in this file.' });
  }

  if (missingTools.length > 0 && !allowUnmatchedTools) {
    blockers.push({
      type: 'no_tool',
      message: `${missingTools.length} ProShop Tool #${missingTools.length !== 1 ? 's are' : ' is'} not in the tool library. Add ${missingTools.length !== 1 ? 'them' : 'it'} first — the sequence detail can't be stored with a tool it can't look up.`,
      rows: missingTools,
    });
  }

  // ── Version ──
  // The POSTED stamp is the version key: it's set by post logic and appears in
  // both the CSV and the G-code, so it's what pairs them. Re-uploading the same
  // stamp is the SAME version — no new archive copy, nothing to change.
  const prior = program ? existingDetails.find(d => d.operation_id === program.id) || null : null;
  const sameVersion = !!(prior && parsed.posted && prior.posted === parsed.posted);

  const detail = program ? {
    id: prior?.id || generateId(),
    // The operation the program belongs to — the durable link. The number is
    // cached alongside it for display and for the Drive folder name.
    operation_id: program.id,
    program_number: Number(program.program_number),
    file_name: String(fileName || ''),
    posted: parsed.posted,
    posted_at: postedToIso(parsed.posted),
    uploaded_at: new Date().toISOString(),
    uploaded_by: uploadedBy || '',
    raw_file_id: prior?.raw_file_id || null,       // filled by the Drive upload
    // Proven means "this ran on the machine and did not crash". Uploading a CSV
    // never implies that, so a NEW version always lands unproven — a person sets
    // it deliberately, later. Re-uploading the same version keeps its state.
    proven: sameVersion ? !!prior.proven : false,
    proven_at: sameVersion ? (prior.proven_at || null) : null,
    proven_by: sameVersion ? (prior.proven_by || '') : '',
    header_raw: parsed.headerRaw,
    fixture_raw: parsed.fixtureRaw,
    row_count: parsed.rows.length,
    tools: toolRows,
  } : null;

  return {
    blockers,
    detail,
    program,
    routing,
    part,
    parsed,
    prior,
    sameVersion,
    flags: {
      lc: lcConflicts,
      holders: unmatchedHolders,
      legacy: legacyMatches,
      // Matched on the bare number with the letter prefix ignored — a real
      // match, but a looser one than an exact id, so it is reported.
      loose: looseMatches,
      // Stored with `tool_ref: null`. Only ever non-blocking in the bulk pass;
      // these rows are the worklist of ProShop numbers to go correct, and they
      // contribute nothing to Where Used until they are.
      unmatched: missingTools,
    },
  };
}

// Merge a built detail into the shared file, replacing any prior record for the
// same program (only the LATEST version's parsed data is stored — older
// versions are read live from their archived raw file).
export function upsertDetail(detailsFile, detail) {
  const list = detailsFile?.details || [];
  const without = list.filter(d => d.operation_id !== detail.operation_id);
  return { ...(detailsFile || {}), version: 1, details: [...without, detail] };
}

export const detailsOf = (file) => file?.details || [];

// ── Re-linking stored rows ───────────────────────────────────────────────────
// ⚠️ THIS IS WHAT MAKES THE "unlinked row" FLAG CLEARABLE. `tool_ref` is
// resolved once, at import, and stored — so correcting a tool's ProShop number
// afterwards does NOT re-link the rows that missed it. And a re-import can't
// fix it either: the file isn't stale, so the bulk pass skips it, and a
// same-version re-stamp keeps the prior record untouched. Without this pass the
// flag would name a problem the user has already fixed, forever.
//
// Metadata-only and Drive-free: it re-resolves ONLY rows that currently have no
// tool, and never overwrites a link that already resolved.
//
// ⚠️ Returns the SAME file reference when nothing changed, so a caller can tell
// whether there is anything to persist without diffing.
export function relinkStoredDetails(detailsFile, tools, { loose = true } = {}) {
  const list = detailsOf(detailsFile);
  if (list.length === 0) return { file: detailsFile, relinked: [] };

  const index = buildToolIndex(tools);
  const relinked = [];
  let changed = false;

  const next = list.map(detail => {
    let touched = false;
    const rows = (detail.tools || []).map(row => {
      if (row.tool_ref) return row;
      const { tool, via } = findToolByProShopId(index, row.tool_id, { loose });
      if (!tool) return row;
      touched = true;
      relinked.push({
        operation_id: detail.operation_id,
        program_number: detail.program_number,
        t: row.t,
        tool_id: row.tool_id,
        matched: tool.tool_id,
      });
      return { ...row, tool_ref: tool.id, matched_via: via };
    });
    if (!touched) return detail;
    changed = true;
    return { ...detail, tools: rows };
  });

  if (!changed) return { file: detailsFile, relinked: [] };
  return { file: { ...(detailsFile || {}), version: 1, details: next }, relinked };
}
