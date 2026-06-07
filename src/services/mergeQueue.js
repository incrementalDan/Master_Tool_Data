import { fusionToolToInternal, generateId, readOohFromFusion } from '../schema/toolSchema.js';
import { parsePresetName } from '../utils/presetNaming.js';
import { matchTool } from './duplicateDetector.js';

let _qid = 0;
function qid() { return `q-${++_qid}-${Math.random().toString(36).slice(2, 5)}`; }

// Queue entry shape:
// {
//   id: string,
//   incomingTool: internal tool object,
//   status: 'pending' | 'matched' | 'new' | 'committed' | 'skipped',
//   matchedMasterTool: null | master tool object,
//   matchConfidence: null | 'exact' | 'fuzzy' | 'none',
//   matchMethod: null | 'product-id' | 'guid' | 'fuzzy' | 'manual' | 'none',
//   fuzzyCandidates: [],   // top fuzzy candidates for MatchStep
//   selectedFields: Set,   // filled at DiffStep
//   revisionNote: '',      // filled at CommitStep
//   isNewTool: false,
// }

// ─── Fusion CSV (TSV) parser ─────────────────────────────────────────────────
// Fusion's right-click → Copy produces tab-separated CSV, not JSON.

function isFusionCsv(raw) {
  const first = raw.slice(0, 500);
  return first.includes('\t') && first.includes('(tool_');
}

// Quote-aware TSV splitter. Handles "value" quoting and "" escaping.
function splitTsvLine(line) {
  const result = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') { inQuotes = false; }
      else { field += c; }
    } else {
      if (c === '"') { inQuotes = true; }
      else if (c === '\t') { result.push(field); field = ''; }
      else { field += c; }
    }
  }
  result.push(field);
  return result;
}

function csvNum(v) {
  if (v == null || v === '') return null;
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}
function csvBool(v) { return v === 'true' || v === '1'; }
function csvStr(v) { return (v ?? '').trim(); }

// Map Fusion CSV type strings → our internal type names (same as JSON type map).
const CSV_TYPE_MAP = {
  'flat end mill': 'flat end mill',
  'ball end mill': 'ball end mill',
  'bull nose end mill': 'bull nose end mill',
  'tapered mill': 'tapered mill',
  'radius mill': 'radius mill',
  'form mill': 'form mill',
  'lollipop mill': 'lollipop mill',
  'slot mill': 'slot/key cutter',
  'dovetail mill': 'dovetail',
  'thread mill': 'thread mill',
  'face mill': 'face mill',
  'chamfer mill': 'chamfer mill',
  'circle segment barrel': 'circle segment barrel',
  'circle segment lens': 'circle segment lens',
  'circle segment oval': 'circle segment oval',
  'circle segment taper': 'circle segment taper',
  'drill': 'drill',
  'center drill': 'center drill',
  'spot drill': 'spot drill',
  'reamer': 'reamer',
  'counter bore': 'counter bore',
  'counter sink': 'counter sink',
  'tap right hand': 'tap form',
  'boring bar': 'boring head',
  'turning general': 'turning general',
};

function csvRowToPreset(r) {
  const name = csvStr(r.preset_name) || 'Default preset';
  return {
    guid: generateId(),
    name,
    operation_type: parsePresetName(name)?.opType ?? null,
    material: {
      category: csvStr(r.tool_presetMaterialCategory) || 'all',
      query: csvStr(r.tool_presetMaterialQuery) || '',
      'use-hardness': csvBool(r.tool_presetMaterialUseHardness),
    },
    n:              csvNum(r.tool_spindleSpeed) ?? 0,
    v_c:            csvNum(r.tool_surfaceSpeed) ?? 0,
    n_ramp:         csvNum(r.tool_rampSpindleSpeed) ?? 0,
    'ramp-spindle-speed': 'n',
    v_f:            csvNum(r.tool_feedCutting) ?? 0,
    f_z:            csvNum(r.tool_feedPerTooth) ?? 0,
    v_f_leadIn:     csvNum(r.tool_feedEntry) ?? 0,
    v_f_leadOut:    csvNum(r.tool_feedExit) ?? 0,
    v_f_transition: csvNum(r.tool_feedTransition) ?? 0,
    v_f_ramp:       csvNum(r.tool_feedRamp) ?? 0,
    'ramp-angle':   csvNum(r.tool_rampAngle) ?? 2,
    v_f_plunge:     csvNum(r.tool_feedPlunge) ?? 0,
    f_n:            csvNum(r.tool_feedPerRevolution) ?? 0,
    v_f_retract:    0,
    'tool-coolant': csvStr(r.tool_coolant) || 'flood',
    'use-stepdown': csvBool(r.use_tool_stepdown),
    'use-stepover': csvBool(r.use_tool_stepover),
    stepdown: csvNum(r.tool_stepdown) ?? null,
    stepover: csvNum(r.tool_stepover) ?? null,
  };
}

function parseFusionCsv(raw) {
  const lines = raw.split('\n').map(l => l.replace(/\r$/, '')).filter(l => l.trim());
  if (lines.length < 2) throw new Error('Fusion CSV has no data rows.');

  // Extract field keys from headers: "Display Name (field_key)" → "field_key"
  const headers = splitTsvLine(lines[0]).map(h => {
    const m = h.match(/\(([^)]+)\)$/);
    return m ? m[1] : h;
  });

  // Parse data rows into key→value maps
  const rows = lines.slice(1).map(line => {
    const vals = splitTsvLine(line);
    const row = {};
    headers.forEach((key, i) => { row[key] = vals[i] ?? ''; });
    return row;
  });

  // Group rows by tool_index — each group is one tool with N preset rows
  const toolMap = new Map();
  rows.forEach(row => {
    const key = row.tool_index ?? '0';
    if (!toolMap.has(key)) toolMap.set(key, []);
    toolMap.get(key).push(row);
  });

  const tools = [];
  for (const [, toolRows] of toolMap) {
    const r = toolRows[0];
    const rawType = csvStr(r.tool_type);
    const toolType = CSV_TYPE_MAP[rawType] || rawType || 'flat end mill';

    const presets = toolRows.map(csvRowToPreset);
    const p0 = presets[0];

    const trackingRaw = csvStr(r.tool_comment);
    const tool = {
      id: null,
      tracking_id: /^FTL-/i.test(trackingRaw) ? trackingRaw : null,
      unit: csvStr(r.tool_unit) || 'inches',
      tool_type: toolType,
      description: csvStr(r.tool_description) || '',
      diameter: csvNum(r.tool_diameter),
      flute_length: csvNum(r.tool_fluteLength),
      overall_length: csvNum(r.tool_overallLength),
      number_of_flutes: r.tool_numberOfFlutes !== '' ? parseInt(r.tool_numberOfFlutes) : null,
      corner_radius: csvNum(r.tool_cornerRadius),
      shank_diameter: csvNum(r.tool_shaftDiameter),
      taper_angle: csvNum(r.tool_taperAngle),
      tip_angle: csvNum(r.tool_tipAngle),
      tip_diameter: csvNum(r.tool_tipDiameter),
      thread_pitch: csvNum(r.tool_threadPitch),
      shoulder_length: csvNum(r.tool_shoulderLength),
      material: csvStr(r.tool_material) || 'carbide',
      proshot_id: csvStr(r.tool_productId) || '',
      product_link: csvStr(r.tool_productLink) || '',
      location: csvStr(r.tool_vendor) || '',
      spindle_speed: p0.n || null,
      cutting_feedrate: p0.v_f || null,
      plunge_feedrate: p0.v_f_plunge || null,
      ramp_feedrate: p0.v_f_ramp || null,
      lead_in_feedrate: p0.v_f_leadIn || null,
      lead_out_feedrate: p0.v_f_leadOut || null,
      feed_per_tooth: p0.f_z || null,
      feed_per_rev: p0.f_n || null,
      cutting_speed: p0.v_c || null,
      presets,
      // Metadata fields default empty
      vendor: '',
      product_id: '',
      coating: '',
      distributor: '',
      distributor_stock_num: '',
      cost: '',
      center_cutting: false,
      // Fusion-native: tool_hand → cutting_direction (anything matching "left" = Left Hand).
      cutting_direction: /left/i.test(csvStr(r.tool_hand)) ? 'Left Hand' : 'Right Hand',
      material_suitability: [],
      tags: [],
      notes: '',
      last_used_job: '',
      preferred_machine: '',
      machine_tool_number: null,
      updated_by: '',
      revision_notes: '',
      merge_history: [],
      assemblies: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      _fusionRaw: null,
      // Transient: assembly context from the job file (used by CommitStep)
      incoming_holder_guid: '',
      // OOH is stored in the tool's own unit; tool_bodyLength is already in that
      // unit, so take it raw (no conversion).
      incoming_ooh: csvNum(r.tool_bodyLength) || null,
      _incomingHolderDesc: csvStr(r.holder_description),
    };
    tools.push(tool);
  }

  if (tools.length === 0) throw new Error('No tools found in the Fusion CSV.');
  return tools;
}

// ─── Parse incoming content ──────────────────────────────────────────────────

export function parseIncoming(raw) {
  const trimmed = raw.trim();

  // Try JSON first (Ctrl+V from Fusion library panel in some versions)
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    let parsed;
    try { parsed = JSON.parse(trimmed); } catch { throw new Error('Invalid JSON — check that you copied the full content.'); }

    const fusionTools = [];
    if (Array.isArray(parsed?.data)) {
      fusionTools.push(...parsed.data);
    } else if (Array.isArray(parsed)) {
      fusionTools.push(...parsed);
    } else if (parsed && (parsed.guid || parsed.type)) {
      fusionTools.push(parsed);
    } else {
      throw new Error('Unrecognized format. Expected a Fusion tool object, array, or library JSON.');
    }

    if (fusionTools.length === 0) throw new Error('No tools found in the pasted content.');
    // Attach the same transient assembly-context fields parseFusionCsv sets, so
    // CommitStep's assembly detection works for JSON-pasted tools too. OOH comes
    // from geometry.LB (converted to inches by readOohFromFusion), never from
    // assembly-gauge-length (= holder gauge + OOH, not the OOH source).
    return fusionTools.map((ft) => ({
      ...fusionToolToInternal(ft),
      incoming_ooh: readOohFromFusion(ft),
      incoming_holder_guid: ft?.holder?.guid || '',
      _incomingHolderDesc: ft?.holder?.description || '',
    }));
  }

  // Fall back to Fusion CSV/TSV format (right-click → Copy from tool library)
  if (isFusionCsv(trimmed)) {
    return parseFusionCsv(trimmed);
  }

  throw new Error('Unrecognized format. Paste Fusion tool data copied from the tool library (right-click → Copy), or upload a Fusion library JSON file.');
}

export function buildQueue(internalTools, libraryTools) {
  return internalTools.map(tool => {
    const { tool: matched, confidence, method, candidates } = matchTool(tool, libraryTools);

    if (confidence === 'exact') {
      return {
        id: qid(),
        incomingTool: tool,
        status: 'matched',
        matchedMasterTool: matched,
        matchConfidence: 'exact',
        matchMethod: method,
        fuzzyCandidates: [],
        selectedFields: new Set(),
        revisionNote: '',
        isNewTool: false,
      };
    }

    if (confidence === 'fuzzy') {
      return {
        id: qid(),
        incomingTool: tool,
        status: 'pending',   // needs user confirmation via MatchStep
        matchedMasterTool: null,
        matchConfidence: 'fuzzy',
        matchMethod: method,
        fuzzyCandidates: candidates,
        selectedFields: new Set(),
        revisionNote: '',
        isNewTool: false,
      };
    }

    // No match → new tool
    return {
      id: qid(),
      incomingTool: tool,
      status: 'new',
      matchedMasterTool: null,
      matchConfidence: 'none',
      matchMethod: 'none',
      fuzzyCandidates: [],
      selectedFields: new Set(),
      revisionNote: '',
      isNewTool: true,
    };
  });
}

export function queueProgress(queue) {
  const done = queue.filter(e => e.status === 'committed' || e.status === 'skipped').length;
  const committed = queue.filter(e => e.status === 'committed').length;
  const skipped = queue.filter(e => e.status === 'skipped').length;
  return { total: queue.length, done, committed, skipped, remaining: queue.length - done };
}
