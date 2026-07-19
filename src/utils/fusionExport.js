import { internalToFusionTool, buildHolderObject } from '../schema/toolSchema.js';
import { convertLength } from './units.js';

// ─── JSON export (file downloads and library writes) ────────────────────────

// Sync expressions.holder_description / holder_vendor to f.holder — Fusion
// displays the holder's name/vendor from these expressions, not from
// holder.description/holder.vendor, so a stale expression (carried over from
// the holder this tool first had) shows the wrong holder identity even though
// our holder object is correct. Fusion omits each key when the holder has no
// value for it (not every holder has a vendor) — mirror that, don't write ''.
// Mirrors the same sync in splitToFusionInstances (toolSchema.js).
function syncHolderExpressions(f) {
  f.expressions = { ...(f.expressions || {}) };
  if (f.holder?.description) f.expressions.holder_description = `'${f.holder.description}'`;
  else delete f.expressions.holder_description;
  if (f.holder?.vendor) f.expressions.holder_vendor = `'${f.holder.vendor}'`;
  else delete f.expressions.holder_vendor;
}

// Render one logical tool as a single Fusion entry for the given assembly. The
// emitted entry carries the assembly's instance guid + holder + OOH and the
// tool's tracking ID (in the comment), so a pasted-back tool regroups correctly.
function toFusionFormat(tool, holders = [], assembly = null) {
  const tracking_id = tool.tracking_id || tool.id;
  const instanceGuid = assembly?.instance_guid || tool._instancesRaw?.[0]?.guid || tool.id;
  const raw = (tool._instancesRaw || []).find(r => r.guid === instanceGuid) || tool._fusionRaw || undefined;
  const f = internalToFusionTool({ ...tool, id: instanceGuid, tracking_id, _fusionRaw: raw });
  delete f._fusionRaw;

  if (assembly) {
    const holder = holders.find(h => h.guid === assembly.holder_guid);
    if (holder) {
      f.holder = buildHolderObject(holder);
      syncHolderExpressions(f);
    }
    if (assembly.ooh != null && !isNaN(Number(assembly.ooh))) {
      const isMetric = tool.unit === 'millimeters';
      // OOH is stored in the tool's own unit; geometry.LB is in that unit too —
      // written raw, no conversion.
      const lb = Number(assembly.ooh);
      f.geometry = { ...(f.geometry || {}), LB: lb };   // OOH source of truth
      // Fusion re-derives LB from tool_bodyLength on load — keep them in sync.
      f.expressions = { ...(f.expressions || {}), tool_bodyLength: `${lb} ${isMetric ? 'mm' : 'in'}` };
      // assemblyGaugeLength = holder gauge length + OOH, in the tool's unit. It
      // lives at geometry.assemblyGaugeLength (camelCase) — Fusion has NO
      // root-level `assembly-gauge-length` field (see FUSION_SCHEMA.md §1a). The
      // holder gauge is in the HOLDER's unit, so convert it into the tool's unit.
      if (f.holder && typeof f.holder.gaugeLength === 'number') {
        const gaugeNative = convertLength(f.holder.gaugeLength, f.holder.unit, tool.unit);
        f.geometry.assemblyGaugeLength = gaugeNative + lb;
      }
    }
  } else if (tool.selected_holder_guid && holders.length > 0) {
    const holder = holders.find(h => h.guid === tool.selected_holder_guid);
    if (holder) {
      f.holder = buildHolderObject(holder);
      syncHolderExpressions(f);
    }
  }

  return f;
}

function downloadJSON(content, filename) {
  const blob = new Blob([JSON.stringify(content, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function exportSingleTool(tool, holders = [], assembly = null) {
  downloadJSON({ data: [toFusionFormat(tool, holders, assembly)] }, `fusion_tool_${tool.tool_id || tool.id}.json`);
}

export function exportFullLibrary(tools, holders = []) {
  const data = [];
  for (const t of tools) {
    const asms = (t.assemblies && t.assemblies.length > 0) ? t.assemblies : [null];
    for (const a of asms) data.push(toFusionFormat(t, holders, a));
  }
  downloadJSON({ data }, 'fusion_tool_library.json');
}

// ─── TSV clipboard export (paste-compatible with Fusion 360 tool library) ───
// Fusion only accepts its own tab-separated format on paste — JSON is rejected.
// The column layout matches Fusion's right-click Copy output exactly.

const FUSION_TSV_HDR = `"Tool Index (tool_index)"\t"Preset Name (preset_name)"\t"Type (tool_type)"\t"Description (tool_description)"\t"Diameter (tool_diameter)"\t"Number (tool_number)"\t"Unit (tool_unit)"\t"Holder Description (holder_description)"\t"Holder Product ID (holder_productId)"\t"Holder Product Link (holder_productLink)"\t"Holder Vendor (holder_vendor)"\t"Abrasive Flow Rate (tool_abrasiveFlowRate)"\t"Size (tool_adaptiveItemSize)"\t"Orientation (tool_angle)"\t"Tool Assembly Gauge Length (tool_assemblyGaugeLength)"\t"Assist Gas (tool_assistGas)"\t"Axial Distance (tool_axialDistance)"\t"Bead Width (tool_beadWidth)"\t"Tool Block Size (tool_block_adaptiveItemSize)"\t"Tool Block Comment (tool_block_comment)"\t"Tool Block Description (tool_block_description)"\t"Tool Block Half Index (tool_block_isHalfIndex)"\t"Tool Block Live (tool_block_live)"\t"Tool Block Connection Type (tool_block_machineSideConnectionType)"\t"Tool Block Maximum RPM (tool_block_maximumRotationalSpeed)"\t"Tool Block Attachment points (tool_block_numberOfAttachmentPoints)"\t"Tool Block Number of Tools (tool_block_numberOfTools)"\t"Tool Block Orientation (tool_block_orientationType)"\t"Tool Block Product ID (tool_block_productId)"\t"Tool Block Product Link (tool_block_productLink)"\t"Tool Block Station Number (tool_block_stationNumber)"\t"Tool Block Vendor (tool_block_vendor)"\t"Body Length (tool_bodyLength)"\t"Break Control (tool_breakControl)"\t"Chamfer Angle (tool_chamferAngle)"\t"Chamfer Width (tool_chamferWidth)"\t"Clamping (tool_clamping)"\t"Clockwise Spindle Rotation (tool_clockwise)"\t"Comment (tool_comment)"\t"Compensation (tool_compensation)"\t"Compensation Offset (tool_compensationOffset)"\t"Coolant (tool_coolant)"\t"Coolant Support (tool_coolantSupport)"\t"Corner Radius (tool_cornerRadius)"\t"Cross Section (tool_crossSection)"\t"Cut Height (tool_cutHeight)"\t"Cut Power (tool_cutPower)"\t"Cutting Width (tool_cuttingWidth)"\t"Auxiliary Gas Flow Rate (tool_depositingAuxiliaryGasFlowRate)"\t"Carrier Gas Flow Rate (tool_depositingCarrierGasFlowRate)"\t"Current (tool_depositingCurrent)"\t"Power (tool_depositingPower)"\t"Shield Gas Flow Rate (tool_depositingShieldGasFlowRate)"\t"Voltage (tool_depositingVoltage)"\t"Depth of Cut (tool_depthOfCut)"\t"Diameter Offset (tool_diameterOffset)"\t"End Angle (tool_endAngle)"\t"End Cutting (tool_endCutting)"\t"Cutting Feedrate (tool_feedCutting)"\t"Cutting Feed per Revolution (tool_feedCuttingRel)"\t"Depositing Feedrate (tool_feedDepositing)"\t"Lead-In Feedrate (tool_feedEntry)"\t"Lead-In Feed per Revolution (tool_feedEntryRel)"\t"Lead-Out Feedrate (tool_feedExit)"\t"Lead-Out Feed per Revolution (tool_feedExitRel)"\t"Plunge Feed per Revolution (tool_feedPerRevolution)"\t"Feed per Tooth (tool_feedPerTooth)"\t"Plunge Feedrate (tool_feedPlunge)"\t"Link Feedrate (tool_feedProbeLink)"\t"Measure Feedrate (tool_feedProbeMeasure)"\t"Ramp Feedrate (tool_feedRamp)"\t"Retract Feedrate (tool_feedRetract)"\t"Retract Feed per Revolution (tool_feedRetractPerRevolution)"\t"Transition Feedrate (tool_feedTransition)"\t"Wire Feedrate (tool_feedWire)"\t"Flute Length (tool_fluteLength)"\t"Use Opposite Edge (tool_grooveCompOppositeEdge)"\t"Groove Width (tool_grooveWidth)"\t"Hand (tool_hand)"\t"Head Clearance (tool_headClearance)"\t"Head Length (tool_headLength)"\t"Tool Holder Gauge Length (tool_holderGaugeLength)"\t"Head Length (tool_holderHeadLength)"\t"Overall Length (tool_holderOverallLength)"\t"Style (tool_holderType)"\t"Angle (tool_insertAngle)"\t"Insert size (tool_insertSize)"\t"Size specified by (tool_insertSizeSpecificationMode)"\t"Shape (tool_insertType)"\t"Width (tool_insertWidth)"\t"Internal Thread (tool_internalThread)"\t"Half Index (tool_isHalfIndex)"\t"Kerf Width (tool_kerfWidth)"\t"Layer Thickness (tool_layerThickness)"\t"Leading Angle (tool_leadingAngle)"\t"Trailing edge length (tool_lengthNonCuttingEdge)"\t"Length Offset (tool_lengthOffset)"\t"Live Tool (tool_live)"\t"Lower Radius (tool_lowerRadius)"\t"Quality Control (tool_machineQualityControl)"\t"Connection Type (tool_machineSideConnectionType)"\t"Manual Tool Change (tool_manualToolChange)"\t"Material (tool_material)"\t"Maximum Diameter (tool_maximumCuttingDiameter)"\t"Maximum RPM (tool_maximumRotationalSpeed)"\t"Maximum Thread Pitch (tool_maximumThreadPitch)"\t"Minimum Thread Pitch (tool_minimumThreadPitch)"\t"Nozzle Diameter (tool_nozzleDiameter)"\t"Attachment points (tool_numberOfAttachmentPoints)"\t"Number of Flutes (tool_numberOfFlutes)"\t"Number of Teeth (tool_numberOfTeeth)"\t"Number of Tools (tool_numberOfTools)"\t"Orientation (tool_orientationType)"\t"Overall Length (tool_overallLength)"\t"Pierce Height (tool_pierceHeight)"\t"Pierce Power (tool_piercePower)"\t"Pierce Time (tool_pierceTime)"\t"Powder Flow Rate (tool_powderFlowRate)"\t"Filter by Type (tool_presetMaterialCategory)"\t"Maximum hardness (tool_presetMaterialMaximumHardness)"\t"Minimum hardness (tool_presetMaterialMinimumHardness)"\t"Filter by Search (tool_presetMaterialQuery)"\t"Filter by hardness (tool_presetMaterialUseHardness)"\t"Preset Program Number (tool_presetProgram)"\t"Pressure (tool_pressure)"\t"Product ID (tool_productId)"\t"Product Link (tool_productLink)"\t"Profile Radius (tool_profileRadius)"\t"Ramp Angle (tool_rampAngle)"\t"Ramp Spindle Speed (tool_rampSpindleSpeed)"\t"Relief Angle (tool_reliefAngle)"\t"Round Shank (tool_roundShank)"\t"Flip (tool_shaftAxisAngle)"\t"Shaft Diameter (tool_shaftDiameter)"\t"Shank Height (tool_shankHeight)"\t"Shank Width (tool_shankWidth)"\t"Shoulder Diameter (tool_shoulderDiameter)"\t"Shoulder Length (tool_shoulderLength)"\t"Side Angle (tool_sideAngle)"\t"Side Cutting (tool_sideCutting)"\t"Spindle Speed (tool_spindleSpeed)"\t"Stand-off Distance (tool_standoffDistance)"\t"Station Number (tool_stationNumber)"\t"Stepdown (tool_stepdown)"\t"Stepover (tool_stepover)"\t"Surface Speed (tool_surfaceSpeed)"\t"Taper Angle (tool_taperAngle)"\t"Tapered Type (tool_taperedType)"\t"Thickness (tool_thickness)"\t"Thread Pitch (tool_threadPitch)"\t"Thread Profile Angle (tool_threadProfileAngle)"\t"Thread Tip Radius (tool_threadTipRadius)"\t"Thread Tip Type (tool_threadTipType)"\t"Thread Tip Width (tool_threadTipWidth)"\t"Tip Angle (tool_tipAngle)"\t"Tip Diameter (tool_tipDiameter)"\t"Tip Length (tool_tipLength)"\t"Tip Offset (tool_tipOffset)"\t"Tolerance (tool_tolerance)"\t"Trailing Angle (tool_trailingAngle)"\t"Turret (tool_turret)"\t"Upper Radius (tool_upperRadius)"\t"Use Constant Surface Speed (tool_useConstantSurfaceSpeed)"\t"Use Feed per Revolution (tool_useFeedPerRevolution)"\t"Vendor (tool_vendor)"\t"Use Depth of Cut (use_tool_depthOfCut)"\t"Use Preset Program Number (use_tool_presetProgram)"\t"Use Stepdown (use_tool_stepdown)"\t"Use Stepover (use_tool_stepover)"\t"Shaft Segments (shaft_segments)"\t"Holder Segments (holder_segments)"\t"Tool Library Version (tool_library_version)"\t"CSV_TOOLS_VERSION_1"`;

const INTERNAL_TO_FUSION_TYPE = {
  'flat end mill': 'flat end mill',
  'ball end mill': 'ball end mill',
  'bull nose end mill': 'bull nose end mill',
  'tapered mill': 'tapered mill',
  'radius mill': 'radius mill',
  'form mill': 'form mill',
  'lollipop mill': 'lollipop mill',
  'slot/key cutter': 'slot mill',
  'dovetail': 'dovetail mill',
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
  // 'tap left hand' is not a confirmed Fusion type string (see toolSchema.js FT_MAP
  // for the full explanation) — every tap exports as 'tap right hand' for now.
  // TODO: branch on cutting_direction once the left-hand string is confirmed.
  'tap': 'tap right hand',
  'boring head': 'boring bar',
  'turning general': 'turning general',
};

function tsvStr(v) {
  const s = String(v === null || v === undefined ? '' : v);
  return `"${s.replace(/"/g, '""')}"`;
}

function tsvNum(v) {
  if (v === null || v === undefined || v === '') return '""';
  return String(v);
}

function tsvBool(v) {
  return String(Boolean(v));
}

// Length unit conversion factor (Fusion units: 'inches' | 'millimeters').
function unitFactor(fromUnit, toUnit) {
  if (fromUnit === toUnit) return 1;
  if (fromUnit === 'millimeters' && toUnit !== 'millimeters') return 1 / 25.4;
  if (fromUnit !== 'millimeters' && toUnit === 'millimeters') return 25.4;
  return 1;
}

const round6 = (n) => Math.round(n * 1e6) / 1e6;

// Fusion's clipboard format encodes shaft/holder profiles as a semicolon-
// separated list of "H<height> U<upper-diameter> L<lower-diameter>" segments,
// expressed in the tool's unit — NOT as JSON. Pasting JSON into these columns
// makes Fusion silently drop the shaft/holder, so the assembly loses its holder.
function segmentsToFusionTsv(segments, factor = 1) {
  return (segments || [])
    .map(s => `H${((Number(s.height) || 0) * factor).toFixed(6)}`
            + ` U${((Number(s['upper-diameter']) || 0) * factor).toFixed(6)}`
            + ` L${((Number(s['lower-diameter']) || 0) * factor).toFixed(6)}`)
    .join('; ');
}

// Produces one TSV data row per preset. Internal geometry values are already
// in tool.unit — no conversion needed except OOH (always stored in inches).
function toolToTsvRows(tool, holders, assembly, toolIndex) {
  const E = '""';
  const isMetric = tool.unit === 'millimeters';
  const fusionType = INTERNAL_TO_FUSION_TYPE[tool.tool_type] || tool.tool_type || '';
  const isTap = fusionType === 'tap right hand';

  const holderGuid = assembly?.holder_guid || tool.selected_holder_guid;
  let holderDesc = '', holderPid = '', holderPlink = '', holderVendor = '';
  let holderObj = null;
  let holderSegStr = '';
  let holderGaugeConv = null;   // holder gauge length, converted to the tool's unit
  if (holderGuid && holders.length > 0) {
    holderObj = holders.find(hh => hh.guid === holderGuid) || null;
    if (holderObj) {
      holderDesc = holderObj.description || '';
      holderPid = holderObj['product-id'] || '';
      holderPlink = holderObj['product-link'] || '';
      holderVendor = holderObj.vendor || '';
      // The holder library stores lengths in the holder's own unit, which may
      // differ from the tool's. Convert segments + gauge length to the tool's
      // unit so Fusion can reconstruct and place the holder on paste.
      const hf = unitFactor(holderObj.unit, tool.unit || 'inches');
      holderSegStr = segmentsToFusionTsv(holderObj.segments, hf);
      if (typeof holderObj.gaugeLength === 'number') {
        holderGaugeConv = round6(holderObj.gaugeLength * hf);
      }
    }
  }

  // OOH is stored in the tool's own unit; tool_bodyLength is in that unit too — raw.
  let bodyLength = '';
  if (assembly?.ooh > 0) {
    bodyLength = assembly.ooh;
  }

  const toolNum = tool.machine_tool_number != null ? tool.machine_tool_number : '';

  const presets = tool.presets?.length > 0 ? tool.presets : [{
    name: 'Default preset',
    material: { category: 'all', query: '', 'use-hardness': false },
    n: tool.spindle_speed || 0,
    v_c: tool.cutting_speed || 0,
    n_ramp: 0,
    v_f: tool.cutting_feedrate || 0,
    f_z: tool.feed_per_tooth || 0,
    v_f_leadIn: tool.lead_in_feedrate || 0,
    v_f_leadOut: tool.lead_out_feedrate || 0,
    v_f_transition: 0,
    v_f_ramp: tool.ramp_feedrate || 0,
    'ramp-angle': 2,
    v_f_plunge: tool.plunge_feedrate || 0,
    f_n: tool.feed_per_rev || 0,
    'tool-coolant': tool.tsc_capable ? 'flood tool' : 'flood',
    'use-stepdown': false,
    'use-stepover': false,
  }];

  return presets.map(preset => {
    const row = new Array(172).fill(E);
    const S = (pos, v) => { row[pos - 1] = v; };

    S(1,  tsvNum(toolIndex));
    S(2,  tsvStr(preset.name || 'Default preset'));
    S(3,  tsvStr(fusionType));
    S(4,  tsvStr(tool.description));
    S(5,  tsvNum(tool.diameter ?? ''));
    S(6,  tsvNum(toolNum));
    S(7,  tsvStr(tool.unit || 'inches'));
    S(8,  tsvStr(holderDesc));
    S(9,  tsvStr(holderPid));
    S(10, tsvStr(holderPlink));
    S(11, tsvStr(holderVendor));

    if (bodyLength !== '') S(33, tsvNum(bodyLength));

    // Holder + assembly gauge lengths (in the tool's unit). Fusion uses these,
    // alongside the holder segments (col 171), to place the holder on paste.
    // assemblyGaugeLength = holder gauge length + body length (stick-out).
    if (holderGaugeConv != null) {
      S(82, tsvNum(holderGaugeConv));   // tool_holderGaugeLength (not headClearance/headLength)
      const bl = bodyLength !== '' ? Number(bodyLength) : 0;
      S(15, tsvNum(round6(holderGaugeConv + bl)));
    }

    S(34, tsvBool(false));   // break control
    if (!isTap) S(38, tsvBool(true));  // clockwise
    S(39, tsvStr(tool.tracking_id || ''));  // comment = logical-tool tracking ID

    // tool number → compensation/diameter/length offset (Fusion convention)
    if (toolNum !== '') {
      S(41, tsvNum(toolNum));
      S(56, tsvNum(toolNum));
      S(97, tsvNum(toolNum));
    }

    S(42, tsvStr(preset['tool-coolant'] || (tool.tsc_capable ? 'flood tool' : 'flood')));
    S(43, tsvStr('no'));  // coolant support

    if (tool.corner_radius)  S(44, tsvNum(tool.corner_radius));

    if (preset.v_f)            S(59,  tsvNum(preset.v_f));
    if (preset.v_f_leadIn)     S(62,  tsvNum(preset.v_f_leadIn));
    if (preset.v_f_leadOut)    S(64,  tsvNum(preset.v_f_leadOut));
    if (preset.f_n)            S(66,  tsvNum(preset.f_n));
    if (preset.f_z)            S(67,  tsvNum(preset.f_z));
    if (preset.v_f_plunge)     S(68,  tsvNum(preset.v_f_plunge));
    if (preset.v_f_ramp)       S(71,  tsvNum(preset.v_f_ramp));
    if (preset.v_f_transition) S(74,  tsvNum(preset.v_f_transition));

    if (tool.flute_length)  S(76, tsvNum(tool.flute_length));

    S(98, tsvBool(true));   // live (Fusion convention for milling tools)
    S(102, tsvBool(false)); // manual tool change

    S(103, tsvStr(tool.material || 'carbide'));

    const taperTypes = new Set(['tapered mill','face mill','chamfer mill','dovetail','circle segment taper']);
    const tipAngleTypes = new Set(['drill','center drill','spot drill','counter sink']);
    const tipDiaTypes = new Set(['chamfer mill','dovetail','spot drill','thread mill','center drill','counter sink','tap']);
    const lrTypes = new Set(['circle segment barrel','circle segment lens','circle segment oval','circle segment taper']);
    const urTypes = new Set(['face mill','circle segment barrel','circle segment taper']);
    const prTypes = new Set(['circle segment barrel','circle segment oval','circle segment taper']);
    const threadTypes = new Set(['tap right hand','thread mill']);   // Fusion type names

    if (tool.max_thread_pitch) S(106, tsvNum(tool.max_thread_pitch));
    if (tool.min_thread_pitch) S(107, tsvNum(tool.min_thread_pitch));

    if (tool.number_of_flutes) S(110, tsvNum(tool.number_of_flutes));
    if (tool.overall_length)   S(114, tsvNum(tool.overall_length));

    S(119, tsvStr(preset.material?.category || 'all'));
    S(122, tsvStr(preset.material?.query || ''));
    S(123, tsvBool(preset.material?.['use-hardness'] || false));

    S(126, tsvStr(tool.tool_id || ''));
    S(127, tsvStr(tool.product_link || ''));

    if (prTypes.has(fusionType) && tool.profile_radius)
      S(128, tsvNum(tool.profile_radius));

    S(129, tsvNum(preset['ramp-angle'] ?? 2));
    if (preset.n_ramp) S(130, tsvNum(preset.n_ramp));

    if (tool.shank_diameter)   S(134, tsvNum(tool.shank_diameter));
    if (!isTap && tool.diameter) S(137, tsvNum(tool.diameter));  // shoulder diameter
    if (tool.shoulder_length)  S(138, tsvNum(tool.shoulder_length));

    if (preset.n)  S(141, tsvNum(preset.n));
    if (preset.v_c) S(146, tsvNum(preset.v_c));

    if (taperTypes.has(fusionType) && tool.taper_angle) S(147, tsvNum(tool.taper_angle));
    if (tipAngleTypes.has(fusionType) && tool.tip_angle) S(155, tsvNum(tool.tip_angle));
    if (tipDiaTypes.has(fusionType) && tool.tip_diameter) S(156, tsvNum(tool.tip_diameter));
    if (threadTypes.has(fusionType) && tool.thread_pitch) S(150, tsvNum(tool.thread_pitch));

    S(161, tsvNum(0));  // turret

    if (urTypes.has(fusionType) && tool.upper_radius) S(162, tsvNum(tool.upper_radius));
    if (lrTypes.has(fusionType) && tool.lower_radius) S(99,  tsvNum(tool.lower_radius));

    if (tool.location) S(165, tsvStr(tool.location));

    const useStepdown = !!(preset['use-stepdown']) && preset.stepdown != null && Number(preset.stepdown) > 0;
    const useStepover = !!(preset['use-stepover']) && preset.stepover != null && Number(preset.stepover) > 0;
    if (useStepdown) S(144, tsvNum(preset.stepdown));
    if (useStepover) S(145, tsvNum(preset.stepover));
    S(168, tsvBool(useStepdown));
    S(169, tsvBool(useStepover));

    // Col 170: shaft (shank) segments — needed for Fusion to show the shank profile.
    // Use the raw entry for this assembly's instance, falling back to canonical.
    // Raw shaft segments are already in the tool's unit (factor 1).
    const instanceRaw = (tool._instancesRaw || []).find(r => r.guid === assembly?.instance_guid) || tool._fusionRaw;
    const shaftRaw = instanceRaw?.shaft;
    if (shaftRaw) {
      const shaftSegs = Array.isArray(shaftRaw) ? shaftRaw : (shaftRaw.segments ?? shaftRaw);
      S(170, tsvStr(segmentsToFusionTsv(shaftSegs, 1)));
    }

    // Col 171: holder segments — needed for Fusion to reconstruct the holder association.
    if (holderSegStr) S(171, tsvStr(holderSegStr));

    S(172, tsvNum(36));  // tool_library_version

    return row.join('\t');
  });
}

function buildFusionTsv(tools, holders = [], assembly = null) {
  const rows = [FUSION_TSV_HDR];
  let idx = 1;
  tools.forEach((tool) => {
    // Single-tool copy may target one assembly; bulk copy expands every
    // assembly (one Fusion instance each), so all proven setups paste back.
    const asms = assembly
      ? [assembly]
      : ((tool.assemblies && tool.assemblies.length > 0) ? tool.assemblies : [null]);
    asms.forEach(a => { rows.push(...toolToTsvRows(tool, holders, a, idx++)); });
  });
  return rows.join('\n');
}

export async function copyToolToClipboard(tool, holders = [], assembly = null) {
  await navigator.clipboard.writeText(buildFusionTsv([tool], holders, assembly));
}

export async function copyToolsToClipboard(tools, holders = []) {
  await navigator.clipboard.writeText(buildFusionTsv(tools, holders));
}

// ─── Copy a single preset as Fusion-paste JSON ──────────────────────────────
// Fusion's right-click "copy" on ONE preset puts this on the clipboard:
//   { "presets": [ <one preset> ], "toolType": "<fusion type>", "unit": "inches" }
// and it pastes straight back into Fusion's Cutting-data list. Verified against
// a real Fusion clipboard sample (matches ALL MILLING STRATEGIES Preset only.json).
//
// The preset is produced through the REAL internalToFusionTool path so every
// expression-sync invariant (stepdown/stepover triple-sync, coolant, the
// "expressions absent for milling" shape, app-only fields stripped) holds — no
// hand-serialization. The tool's flat speed/feed mirrors are set FROM the copied
// preset so internalToFusionTool's presets[0] sync can't override its values.

// Recursive alphabetical key sort (arrays keep their order) — matches Fusion's
// own key ordering so a copy round-trips byte-for-byte.
function sortKeysDeep(v) {
  if (Array.isArray(v)) return v.map(sortKeysDeep);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = sortKeysDeep(v[k]);
    return out;
  }
  return v;
}

export function presetToFusionClipboardObject(tool, preset) {
  const p = { ...preset };
  const tempTool = {
    ...tool,
    presets: [p],
    // Flat mirrors from the copied preset → presets[0] sync is a no-op.
    spindle_speed: p.n, cutting_speed: p.v_c, cutting_feedrate: p.v_f,
    feed_per_tooth: p.f_z, ramp_feedrate: p.v_f_ramp,
    lead_in_feedrate: p.v_f_leadIn, lead_out_feedrate: p.v_f_leadOut,
    plunge_feedrate: p.v_f_plunge, feed_per_rev: p.f_n,
  };
  const f = internalToFusionTool(tempTool);
  const list = f['start-values']?.presets || [];
  const outPreset = list.find(x => x.guid === p.guid) || list[0];
  return sortKeysDeep({ presets: [outPreset], toolType: f.type, unit: f.unit });
}

export function presetToFusionClipboardJson(tool, preset) {
  return JSON.stringify(presetToFusionClipboardObject(tool, preset));
}

export async function copyPresetToClipboard(tool, preset) {
  await navigator.clipboard.writeText(presetToFusionClipboardJson(tool, preset));
}
