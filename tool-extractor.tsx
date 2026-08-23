// tool-extractor.tsx — DATA AND LOGIC ONLY. No UI lives here any more.
//
// The standalone extractor screen this file is named after has been retired:
// scanning a spec sheet now lands in the ordinary tool form (AddToolFlow for a
// new tool, ExtractUpdateModal for an existing one), and the extraction call
// itself lives in src/services/extractionService.js.
//
// What remains is the shop's field vocabulary and the ProShop/Fusion column
// mappings that the rest of the app imports through the src/schema/toolSchema.js
// barrel: the tool-type list, the FIELD_VISIBILITY matrix, the ProShop group
// letters and column set, coolant values, and the CSV/row builders.
//
// The filename and .tsx extension are kept only because a large number of
// modules import from this path; renaming it is a mechanical change worth doing
// on its own, not folded into a feature.
import { THROUGH_COOLANT_VALUES, smartDiam, buildDesc } from "./src/utils/toolNaming.js";
import { proShopStatusValue, exportsToProShop } from "./src/utils/toolStatus.js";

const COOLANT_OPTS = [
  ["flood","Flood"],["disabled","Disabled"],["mist","Mist"],
  ["through tool","Through tool"],["air","Air"],
  ["air through tool","Air through tool"],["suction","Suction"],
  ["flood and mist","Flood and mist"],["flood and through tool","Flood and through tool"],
];

const PS_GROUPS = [
  ["A","Square and Bull Endmill"],["B","Ball Endmill"],
  ["C","Taper End Mill"],["D","Drill"],["E","Center Drills"],
  ["F","Ream and Bore"],["G","Insert"],["H","Saws"],
  ["I","Insert Mills"],["J","T-Slot"],["K","Corner Rounding End Mills"],
  ["L","Chamfer Tool"],["M","Special Tooling"],
  ["N","Solid - Threading, Grooving, Threadmill"],["O","Spot Drill"],
  ["P","Broach"],["Q","Arbour"],["R","Taps"],["S","CMM Styli"],
  ["T","Insert Tool Hardware"],["TA","I.D. Threaders"],
  ["TB","O.D. Threaders"],["TC","Indexable Drills"],
  ["TD","Boring Bars"],["TE","Back Boring Bars"],
  ["TF","External Turning Holders"],["TG","Knurling Tool Holders"],
  ["TH","O.D. Groovers"],["TI","I.D. Groovers"],
  ["TJ","Face Groovers"],["TK","Part Off Tools"],
  ["TL","Boring Bar Inserts"],["TM","I.D. Threading Inserts"],
  ["TN","O.D. Threading Inserts"],["TO","External Turning Inserts"],
  ["TP","O.D. Grooving Inserts"],["TQ","I.D. Grooving Inserts"],
  ["TR","Part Off Inserts"],["TS","Face Grooving Inserts"],
  ["TT","Drill Inserts"],["TU","Knurling Inserts"],
];
const AUTO_GROUP = {
  "flat end mill":"A","bull nose end mill":"A","rough end mill":"A","circle segment lens":"A",
  "ball end mill":"B","tapered mill":"C","drill":"D","center drill":"E",
  "reamer":"F","counter bore":"F","face mill":"I","slot/key cutter":"J","radius mill":"K",
  "chamfer mill":"L","counter sink":"L","form mill":"M","lollipop mill":"M","dovetail":"M",
  "circle segment barrel":"M","circle segment oval":"M","circle segment taper":"M",
  "thread mill":"N","spot drill":"O","tap":"R",
  "boring head":"TD","boring bar":"TD","turning general":"TF",
  "probe":"S",
};
// Reverse of AUTO_GROUP — ProShop "Tool Group" letter → our tool_type, used to
// classify a brand-new tool created from a ProShop import row. Several letters
// cover more than one of our types (e.g. A = square AND bull nose end mill);
// `hints` (description text, corner radius) disambiguate the same way a
// person reading the ProShop row would. Returns null for groups with no
// corresponding tool type (inserts, saws, holders, etc.) — the caller falls
// back to a default.
//
// NOTE: "S" (CMM Styli / probe) is deliberately NOT mapped here even though
// AUTO_GROUP now maps 'probe' -> 'S' for export. A probe is a real, minimally-
// supported tool type (see fusionConvert.js), but it always arrives already
// loaded from the Fusion library — it's never meant to be freshly minted from
// a bare ProShop row. Leaving this case unmapped keeps that path closed: an
// unmatched 'S' row falls back to the documented "no tool type" behavior
// (flat end mill + no_fusion_link, flagged for manual cleanup) exactly like
// the other inserts/saws/holders letters, rather than silently creating a
// probe tool through a route none of the probe-specific handling covers.
function typeFromProShopGroup(letter, hints = {}) {
  const desc = (hints.description || "").toLowerCase();
  const cornerRadius = parseFloat(hints.cornerRadius) || 0;
  switch ((letter || "").toUpperCase()) {
    case "A": return cornerRadius > 0 ? "bull nose end mill" : "flat end mill";
    case "B": return "ball end mill"; // not used for drill mills
    case "C": return "tapered mill";
    case "D": return "drill";
    case "E": return "center drill";
    case "F": return /bore/.test(desc) ? "counter bore" : "reamer";
    case "I": return "face mill";
    case "J": return "slot/key cutter";
    case "K": return "radius mill";
    case "L": return /sink/.test(desc) ? "counter sink" : "chamfer mill";
    case "M":
      if (/dove/.test(desc)) return "dovetail";
      if (/lolli/.test(desc)) return "lollipop mill";
      if (/barrel/.test(desc)) return "circle segment barrel";
      if (/oval/.test(desc)) return "circle segment oval";
      if (/taper/.test(desc)) return "circle segment taper";
      return "form mill";
    case "N": return "thread mill";
    case "O": return "spot drill";
    case "R": return "tap";
    case "TD": return "boring head";
    case "TF": return "turning general";
    default: return null;
  }
}
const ROUND_SHANK_TYPES = new Set([
  "flat end mill","ball end mill","bull nose end mill","tapered mill","radius mill","form mill","lollipop mill",
  "slot/key cutter","dovetail","thread mill","chamfer mill",
  "circle segment barrel","circle segment lens","circle segment oval","circle segment taper",
  "drill","center drill","spot drill","reamer","counter bore","counter sink","tap",
]);

function toOutputUnit(inVal, unit) {
  const v = parseFloat(inVal);
  if (!v && v !== 0) return inVal;
  if (unit === "millimeters") return String(parseFloat((v * 25.4).toFixed(5)));
  return String(v);
}
function calcThreadPitch(s){
  if(!s) return "";
  const metric=s.match(/[Mm]\d*\s*[xX×]\s*(\d+(?:\.\d+)?)/);
  if(metric) return String(parseFloat((parseFloat(metric[1])/25.4).toFixed(7)));
  const inch=s.match(/-(\d+)/);
  if(inch) return String(parseFloat((1/parseInt(inch[1])).toFixed(7)));
  return "";
}
function calcTPI(s){
  if(!s) return "";
  const m=s.match(/-(\d+)/);
  return m?m[1]:"";
}

// The "Threads Per Inch" cell. A thread mill publishes the RANGE it can cut
// (tpi_min/tpi_max, e.g. "11-32"); everything else gets the single TPI implied
// by its thread designation. A range with only one end filled emits that end
// alone rather than a half-written "11-".
function tpiCell(f){
  const lo=String(f.tpiMin??"").trim(), hi=String(f.tpiMax??"").trim();
  if(lo&&hi) return lo===hi?lo:`${lo}-${hi}`;
  if(lo||hi) return lo||hi;
  return calcTPI(f.pitch)||"";
}

// Build Adion/ProShop product link from psToolId
// e.g. 'F-225' → 'https://americanprecisionworks.adionsystems.com/procnc/tools/F/F-225$'
function buildAdionUrl(psToolId){
  if(!psToolId) return "";
  const prefix=psToolId.split("-")[0]||""; if(!prefix) return "";
  return `https://americanprecisionworks.adionsystems.com/procnc/tools/${prefix}/${psToolId}$`;
}
// Extract prefix letter(s) from psToolId (everything before first '-')

const FT = {
  "flat end mill":"flat end mill","ball end mill":"ball end mill","bull nose end mill":"bull nose end mill","rough end mill":"flat end mill",
  "tapered mill":"tapered mill","radius mill":"radius mill","form mill":"form mill","lollipop mill":"lollipop mill",
  "slot/key cutter":"slot mill","dovetail":"dovetail mill","thread mill":"thread mill","face mill":"face mill","chamfer mill":"chamfer mill",
  "circle segment barrel":"circle segment barrel","circle segment lens":"circle segment lens","circle segment oval":"circle segment oval","circle segment taper":"circle segment taper",
  "drill":"drill","center drill":"center drill","spot drill":"spot drill","reamer":"reamer","counter bore":"counter bore","counter sink":"counter sink",
  // "tap left hand" is not a confirmed Fusion type string (absent from FUSION_SCHEMA.md
  // and the sample library — only "tap right hand" appears). Until confirmed in live
  // Fusion, every tap writes "tap right hand" regardless of cuttingDirection — the
  // safer choice vs. risking an unrecognized type string corrupting the tool on load.
  "tap":"tap right hand","boring head":"boring bar","boring bar":"boring bar","turning general":"turning general",
};

const FUSION_HDR=`"Tool Index (tool_index)"\t"Preset Name (preset_name)"\t"Type (tool_type)"\t"Description (tool_description)"\t"Diameter (tool_diameter)"\t"Number (tool_number)"\t"Unit (tool_unit)"\t"Holder Description (holder_description)"\t"Holder Product ID (holder_productId)"\t"Holder Product Link (holder_productLink)"\t"Holder Vendor (holder_vendor)"\t"Abrasive Flow Rate (tool_abrasiveFlowRate)"\t"Size (tool_adaptiveItemSize)"\t"Orientation (tool_angle)"\t"Tool Assembly Gauge Length (tool_assemblyGaugeLength)"\t"Assist Gas (tool_assistGas)"\t"Axial Distance (tool_axialDistance)"\t"Bead Width (tool_beadWidth)"\t"Tool Block Size (tool_block_adaptiveItemSize)"\t"Tool Block Comment (tool_block_comment)"\t"Tool Block Description (tool_block_description)"\t"Tool Block Half Index (tool_block_isHalfIndex)"\t"Tool Block Live (tool_block_live)"\t"Tool Block Connection Type (tool_block_machineSideConnectionType)"\t"Tool Block Maximum RPM (tool_block_maximumRotationalSpeed)"\t"Tool Block Attachment points (tool_block_numberOfAttachmentPoints)"\t"Tool Block Number of Tools (tool_block_numberOfTools)"\t"Tool Block Orientation (tool_block_orientationType)"\t"Tool Block Product ID (tool_block_productId)"\t"Tool Block Product Link (tool_block_productLink)"\t"Tool Block Station Number (tool_block_stationNumber)"\t"Tool Block Vendor (tool_block_vendor)"\t"Body Length (tool_bodyLength)"\t"Break Control (tool_breakControl)"\t"Chamfer Angle (tool_chamferAngle)"\t"Chamfer Width (tool_chamferWidth)"\t"Clamping (tool_clamping)"\t"Clockwise Spindle Rotation (tool_clockwise)"\t"Comment (tool_comment)"\t"Compensation (tool_compensation)"\t"Compensation Offset (tool_compensationOffset)"\t"Coolant (tool_coolant)"\t"Coolant Support (tool_coolantSupport)"\t"Corner Radius (tool_cornerRadius)"\t"Cross Section (tool_crossSection)"\t"Cut Height (tool_cutHeight)"\t"Cut Power (tool_cutPower)"\t"Cutting Width (tool_cuttingWidth)"\t"Auxiliary Gas Flow Rate (tool_depositingAuxiliaryGasFlowRate)"\t"Carrier Gas Flow Rate (tool_depositingCarrierGasFlowRate)"\t"Current (tool_depositingCurrent)"\t"Power (tool_depositingPower)"\t"Shield Gas Flow Rate (tool_depositingShieldGasFlowRate)"\t"Voltage (tool_depositingVoltage)"\t"Depth of Cut (tool_depthOfCut)"\t"Diameter Offset (tool_diameterOffset)"\t"End Angle (tool_endAngle)"\t"End Cutting (tool_endCutting)"\t"Cutting Feedrate (tool_feedCutting)"\t"Cutting Feed per Revolution (tool_feedCuttingRel)"\t"Depositing Feedrate (tool_feedDepositing)"\t"Lead-In Feedrate (tool_feedEntry)"\t"Lead-In Feed per Revolution (tool_feedEntryRel)"\t"Lead-Out Feedrate (tool_feedExit)"\t"Lead-Out Feed per Revolution (tool_feedExitRel)"\t"Plunge Feed per Revolution (tool_feedPerRevolution)"\t"Feed per Tooth (tool_feedPerTooth)"\t"Plunge Feedrate (tool_feedPlunge)"\t"Link Feedrate (tool_feedProbeLink)"\t"Measure Feedrate (tool_feedProbeMeasure)"\t"Ramp Feedrate (tool_feedRamp)"\t"Retract Feedrate (tool_feedRetract)"\t"Retract Feed per Revolution (tool_feedRetractPerRevolution)"\t"Transition Feedrate (tool_feedTransition)"\t"Wire Feedrate (tool_feedWire)"\t"Flute Length (tool_fluteLength)"\t"Use Opposite Edge (tool_grooveCompOppositeEdge)"\t"Groove Width (tool_grooveWidth)"\t"Hand (tool_hand)"\t"Head Clearance (tool_headClearance)"\t"Head Length (tool_headLength)"\t"Tool Holder Gauge Length (tool_holderGaugeLength)"\t"Head Length (tool_holderHeadLength)"\t"Overall Length (tool_holderOverallLength)"\t"Style (tool_holderType)"\t"Angle (tool_insertAngle)"\t"Insert size (tool_insertSize)"\t"Size specified by (tool_insertSizeSpecificationMode)"\t"Shape (tool_insertType)"\t"Width (tool_insertWidth)"\t"Internal Thread (tool_internalThread)"\t"Half Index (tool_isHalfIndex)"\t"Kerf Width (tool_kerfWidth)"\t"Layer Thickness (tool_layerThickness)"\t"Leading Angle (tool_leadingAngle)"\t"Trailing edge length (tool_lengthNonCuttingEdge)"\t"Length Offset (tool_lengthOffset)"\t"Live Tool (tool_live)"\t"Lower Radius (tool_lowerRadius)"\t"Quality Control (tool_machineQualityControl)"\t"Connection Type (tool_machineSideConnectionType)"\t"Manual Tool Change (tool_manualToolChange)"\t"Material (tool_material)"\t"Maximum Diameter (tool_maximumCuttingDiameter)"\t"Maximum RPM (tool_maximumRotationalSpeed)"\t"Maximum Thread Pitch (tool_maximumThreadPitch)"\t"Minimum Thread Pitch (tool_minimumThreadPitch)"\t"Nozzle Diameter (tool_nozzleDiameter)"\t"Attachment points (tool_numberOfAttachmentPoints)"\t"Number of Flutes (tool_numberOfFlutes)"\t"Number of Teeth (tool_numberOfTeeth)"\t"Number of Tools (tool_numberOfTools)"\t"Orientation (tool_orientationType)"\t"Overall Length (tool_overallLength)"\t"Pierce Height (tool_pierceHeight)"\t"Pierce Power (tool_piercePower)"\t"Pierce Time (tool_pierceTime)"\t"Powder Flow Rate (tool_powderFlowRate)"\t"Filter by Type (tool_presetMaterialCategory)"\t"Maximum hardness (tool_presetMaterialMaximumHardness)"\t"Minimum hardness (tool_presetMaterialMinimumHardness)"\t"Filter by Search (tool_presetMaterialQuery)"\t"Filter by hardness (tool_presetMaterialUseHardness)"\t"Preset Program Number (tool_presetProgram)"\t"Pressure (tool_pressure)"\t"Product ID (tool_productId)"\t"Product Link (tool_productLink)"\t"Profile Radius (tool_profileRadius)"\t"Ramp Angle (tool_rampAngle)"\t"Ramp Spindle Speed (tool_rampSpindleSpeed)"\t"Relief Angle (tool_reliefAngle)"\t"Round Shank (tool_roundShank)"\t"Flip (tool_shaftAxisAngle)"\t"Shaft Diameter (tool_shaftDiameter)"\t"Shank Height (tool_shankHeight)"\t"Shank Width (tool_shankWidth)"\t"Shoulder Diameter (tool_shoulderDiameter)"\t"Shoulder Length (tool_shoulderLength)"\t"Side Angle (tool_sideAngle)"\t"Side Cutting (tool_sideCutting)"\t"Spindle Speed (tool_spindleSpeed)"\t"Stand-off Distance (tool_standoffDistance)"\t"Station Number (tool_stationNumber)"\t"Stepdown (tool_stepdown)"\t"Stepover (tool_stepover)"\t"Surface Speed (tool_surfaceSpeed)"\t"Taper Angle (tool_taperAngle)"\t"Tapered Type (tool_taperedType)"\t"Thickness (tool_thickness)"\t"Thread Pitch (tool_threadPitch)"\t"Thread Profile Angle (tool_threadProfileAngle)"\t"Thread Tip Radius (tool_threadTipRadius)"\t"Thread Tip Type (tool_threadTipType)"\t"Thread Tip Width (tool_threadTipWidth)"\t"Tip Angle (tool_tipAngle)"\t"Tip Diameter (tool_tipDiameter)"\t"Tip Length (tool_tipLength)"\t"Tip Offset (tool_tipOffset)"\t"Tolerance (tool_tolerance)"\t"Trailing Angle (tool_trailingAngle)"\t"Turret (tool_turret)"\t"Upper Radius (tool_upperRadius)"\t"Use Constant Surface Speed (tool_useConstantSurfaceSpeed)"\t"Use Feed per Revolution (tool_useFeedPerRevolution)"\t"Vendor (tool_vendor)"\t"Use Depth of Cut (use_tool_depthOfCut)"\t"Use Preset Program Number (use_tool_presetProgram)"\t"Use Stepdown (use_tool_stepdown)"\t"Use Stepover (use_tool_stepover)"\t"Shaft Segments (shaft_segments)"\t"Holder Segments (holder_segments)"\t"Tool Library Version (tool_library_version)"\t"CSV_TOOLS_VERSION_1"`;

function buildFusionRow(f, outputUnit='inches'){
  const d=parseFloat(f.diameter)||"",loc=parseFloat(f.loc)||"",oal=parseFloat(f.oal)||"";
  const shk=parseFloat(f.shankDia)||(d||""),fl=parseInt(f.flutes)||"",mat=f.material||"carbide";
  const pn=f.toolNumber?parseFloat(f.toolNumber):"",ft=FT[f.toolType]||f.toolType||"";
  const desc=f.description||buildDesc(f),pre=f.presetName||desc,edp=f.edpNumber||"",url=f.productLink||"";
  const coolant=f.coolant||"flood";
  const isTap=f.toolType==="tap";
  const cr=parseFloat(f.cornerRadius)||0;
  const E='""',str=x=>`"${String(x===null||x===undefined?"":x).replace(/"/g,'""')}"`;
  const num=x=>(x===""||x===null||x===undefined)?E:String(x),bol=x=>String(x);
  const row=new Array(172).fill(E),S=(p,v)=>{row[p-1]=v;};
  S(1,num(1));S(2,str(pre));S(3,str(ft));S(4,str(desc));S(5,num(toOutputUnit(d,outputUnit)));
  S(6,num(pn));S(7,str(outputUnit));S(34,bol(false));
  if(!isTap) S(38,bol(true));
  S(41,num(pn));S(42,str(coolant));S(43,str("no"));
  if(f.toolType==="bull nose end mill"&&cr>0) S(44,num(toOutputUnit(cr,outputUnit)));
  S(56,num(pn));S(76,num(toOutputUnit(loc,outputUnit)));S(97,num(pn));S(98,bol(true));S(102,bol(false));S(103,str(mat));
  S(110,num(fl));S(114,num(toOutputUnit(oal,outputUnit)));S(119,str("all"));S(123,bol(false));
  S(126,str(f.psToolId||edp));  // ProShop Tool # → productId; falls back to EDP# if blank
  // Col 127: use auto-generated Adion URL when psToolId is set, else manual productLink
  const fusionUrl = f.psToolId ? buildAdionUrl(f.psToolId) : url;
  S(127,str(fusionUrl));S(129,num(2));S(134,num(toOutputUnit(shk,outputUnit)));
  if(f.location) S(165,str(f.location));  // Location (LC-###) → tool_vendor
  if(!isTap) S(137,num(toOutputUnit(d,outputUnit)));
  const locVal=parseFloat(f.loc)||0,slVal=parseFloat(f.shoulderLen)||0;
  const shoulderOut=(slVal&&slVal>=locVal)?slVal:locVal;
  if(shoulderOut) S(138,num(toOutputUnit(shoulderOut,outputUnit)));
  const oohVal=parseFloat(f.ooh)||0,oohOut=(oohVal&&oohVal>=shoulderOut)?oohVal:shoulderOut;
  if(oohOut) S(33,num(toOutputUnit(oohOut,outputUnit)));
  const taperTypes=new Set(["tapered mill","face mill","chamfer mill","dovetail","circle segment taper"]);
  if(taperTypes.has(f.toolType)&&f.taperAngle) S(147,num(parseFloat(f.taperAngle)));
  const tipTypes=new Set(["drill","center drill","spot drill","counter sink"]);
  if(tipTypes.has(f.toolType)&&f.tipAngle) S(155,num(parseFloat(f.tipAngle)));
  const tipDiaTypes=new Set(["chamfer mill","dovetail","spot drill","thread mill","center drill","counter sink"]);
  if(tipDiaTypes.has(f.toolType)&&f.tipDiameter) S(156,num(parseFloat(f.tipDiameter)));
  const lrTypes=new Set(["circle segment barrel","circle segment lens","circle segment oval","circle segment taper"]);
  if(lrTypes.has(f.toolType)&&f.lowerRadius) S(99,num(parseFloat(f.lowerRadius)));
  const urTypes=new Set(["face mill","circle segment barrel","circle segment taper"]);
  if(urTypes.has(f.toolType)&&f.upperRadius) S(162,num(parseFloat(f.upperRadius)));
  const prTypes=new Set(["circle segment barrel","circle segment oval","circle segment taper"]);
  if(prTypes.has(f.toolType)&&f.profileRadius) S(128,num(parseFloat(f.profileRadius)));
  if(f.toolType==="circle segment barrel"&&f.axialDistance) S(17,num(parseFloat(f.axialDistance)));
  if(f.toolType==="thread mill"){
    if(f.maxThreadPitch) S(106,num(parseFloat(f.maxThreadPitch)));
    if(f.minThreadPitch) S(107,num(parseFloat(f.minThreadPitch)));
    if(f.threadProfileAngle) S(151,num(parseFloat(f.threadProfileAngle)));
  }
  const tp=calcThreadPitch(f.pitch);
  if(tp) S(150,num(tp));
  S(161,num(0));S(168,bol(false));S(169,bol(false));S(172,num(36));
  return row.join("\t");
}

const PS_MAIN_COLS=[
  ["toolNumber",f=>f.psToolId||""],
  // A tool has exactly ONE description — the stored one. buildDesc() is only a
  // GENERATOR (specs → a suggested name) for the extractor/Add flow, where nothing
  // is stored yet; it must never override a real tool's description on export.
  ["description",f=>f.description||buildDesc(f)],["cutDiameter",f=>f.diameter||""],["lengthOfCut",f=>f.loc||""],
  ["overallLength",f=>f.oal||""],["No. of Flutes",f=>f.flutes||""],// Blank when unknown — never the cutting diameter. See toolToExtractor.
  ["shankDiameter",f=>f.shankDia||""],
  ["bodyDiameter",f=>f.shankDia||""],["cornerRadius",f=>f.cornerRadius||""],["tipAngle",f=>f.tipAngle||""],
  ["helixAngle",f=>f.helixAngle||""],["coating",f=>f.coating||""],["toolMaterial",f=>f.material||""],
  ["recommendedWorkpieceMaterial",f=>(f.workpieceMats&&f.workpieceMats.length?f.workpieceMats.join(", "):f.workpieceMat||"")],
  // ⚠️ ProShop's boolean-ish columns are NOT one format. Measured across the
  // shop's real export: the Boolean-TYPED attributes (Through Coolant, Custom
  // Grind, Full Profile, Backside Capable, Round Shank) hold "true"/"false",
  // while Center Cut and Double Ended are UNTYPED and hold "Y"/"N" (97/60 and
  // 6/123 rows; "true" never appears in Double Ended at all). Write each column
  // the way ProShop stores it. Import reads them all through psBool, which is
  // tolerant either way.
  ["centerCutting",f=>f.centerCutting?"Y":"N"],["throughCoolant",f=>THROUGH_COOLANT_VALUES.has(f.coolant||"")?"true":"false"],
  ["customgrindtool",f=>f.customGrind?"true":"false"],
  ["roundShank",f=>ROUND_SHANK_TYPES.has(f.toolType)?"true":"false"],["toolGroupLetter",f=>f.grouping||AUTO_GROUP[f.toolType]||"M"],
  ["pitch",f=>f.pitch||""],["fluteType",f=>f.fluteType||""],["lengthBelowShankDiameter",f=>f.minOoh?String(parseFloat(f.minOoh)):""],
  // ⚠️ ProShop's "Threads Per Inch" holds a RANGE for a thread mill ("11-32" on
  // N-78, matching its own description "11 to 32 TPI") — that is the tool's TPI
  // CAPABILITY, which the app stores as tpi_min/tpi_max. For a tap it is the one
  // TPI of the thread it cuts, derived from the pitch designation.
  ["tapClass",f=>f.tapClass||""],["threadsPerInch",f=>tpiCell(f)],["thread",f=>f.pitch||""],
  ["threadType",f=>f.toolType!=="tap"?"":f.tapSubType==="form"?"Form":f.tapSubType==="cut"?"Cut":""],
  // A blank cell means "nobody answered"; these are plain booleans in the app,
  // so an explicit false is the honest value — and it is what ProShop's own
  // export writes (309/310 of its rows).
  ["fullProfile",f=>f.fullProfile?"true":"false"],["stubJobber",f=>f.stubJobber||""],["backsideCapable",f=>f.backsideCapable?"true":"false"],
  ["doubleEnded",f=>f.doubleEnded?"Y":"N"],["cuttingDirection",f=>f.cuttingDirection||"Right Hand"],
  ["taper",f=>f.taperAngle||""],["tipDiameter",f=>f.tipDiameter||""],
  ["tipTo1stFullThread",f=>f.tipToFirstFullThread||""],
  // Location (cabinet) + tap Point Type — added so both round-trip through the
  // app's own ProShop export (imported back via proShopHeaders alias map). API
  // ids per ProShop: `location`, `pointType`.
  ["location",f=>f.location||""],
  ["pointType",f=>f.pointType||""],
  // Lifecycle. Active / Archived — a BETA tool never reaches here, its whole row
  // is omitted (see buildProShopRows).
  ["status",f=>proShopStatusValue({tool_status:f.status})||""],
];

// Each purchasing entry ("Approved Brands" sub-table row in ProShop) becomes one
// CSV row: { approvedBrand (manufacturer), vendor (distributor), edp, cost, leadTime }.
// Built from the normalized `purchasing.{manufacturers,vendors}` — one row per vendor
// (linked to its manufacturer via manufacturer_id), plus one row for any manufacturer
// with no vendors yet (so its EDP# isn't lost). The "EDP#" column is the vendor's own
// catalog number if it has one, else the manufacturer's part number — see CLAUDE.md
// ProShop Field Priority Rules. Falls back to the flat extractor fields (used by the
// AddToolFlow form before `purchasing` is built).
function buildBrandRows(f){
  const manufacturers=f.purchasing?.manufacturers||[];
  const vendors=f.purchasing?.vendors||[];
  if(manufacturers.length||vendors.length){
    const rows=[];
    const usedMfgIds=new Set();
    for(const v of vendors){
      const m=manufacturers.find(m=>m.id===v.manufacturer_id);
      if(m) usedMfgIds.add(m.id);
      rows.push({
        approvedBrand:m?.name||"",
        vendor:v.name||"",
        edp:v.vendor_num||m?.edp||"",
        cost:v.price!=null?String(v.price):"",
        leadTime:"",
      });
    }
    for(const m of manufacturers){
      if(usedMfgIds.has(m.id)) continue;
      rows.push({approvedBrand:m.name||"",vendor:"",edp:m.edp||"",cost:"",leadTime:""});
    }
    return rows;
  }
  const approvedBrand=f.approvedBrand||"",vendor=f.vendor||"",edp=f.vendorStockNum||f.edpNumber||"",cost=f.cost||"";
  if(!approvedBrand&&!vendor&&!edp&&!cost) return [];
  return [{approvedBrand,vendor,edp,cost,leadTime:""}];
}
function csvCell(v){const s=String(v===null||v===undefined?"":v);return(s.includes(",")||s.includes('"')||s.includes("\n"))?`"${s.replace(/"/g,'""')}"`:s;}

// The purchasing / "Approved Brands" sub-table columns, in ProShop's order.
const PURCHASING_COLS=["approvedBrand","vendor","EDP#","cost","leadTime"];

// Columns a continuation row LEAVES BLANK. Measured against a real ProShop
// export (see FUSION TOOL Library REF/ProShop Reference Data): a second
// Approved-Brand row repeats the tool's IDENTITY and descriptive attributes and
// omits only its MEASUREMENTS. Anything not listed here therefore repeats.
//
// ⚠️ EVERY ROW CARRIES THE TOOL # — that is the only thing tying a second
// Approved-Brand row back to its tool. Blanking the whole main block (the old
// behaviour) left row 2 with a brand and a price and NOTHING to attach them to:
// ProShop can't group it, and this app's own importer groups by `Tool #`, so
// re-importing our export silently dropped every vendor after the first. A
// second vendor going missing on a round-trip is invisible until someone goes
// looking for the cheaper price.
//
// `cost` is deliberately NOT first-row-only even though the reference export
// happens to carry it once: price is per VENDOR in this app's model, so
// dropping it on continuation rows would lose the second vendor's price.
const PS_FIRST_ROW_ONLY=new Set([
  "cutDiameter","lengthOfCut","overallLength","shankDiameter","bodyDiameter",
  "cornerRadius","tipAngle","helixAngle","taper","tipDiameter",
  "No. of Flutes","lengthBelowShankDiameter","tipTo1stFullThread","threadsPerInch",
]);

// Real ProShop exports use one row per purchasing/Approved-Brand option, all
// sharing the same Tool #. Returns string[][] (data rows only, no header) so the
// single-tool and full-library exports share ONE implementation of the shape.
function buildProShopRows(f){
  // ⚠️ A BETA TOOL IS NOT EXPORTED AT ALL — it is a tool the shop is trying in
  // CAM and may never buy, so it has no place in ProShop's inventory. Emitting
  // it with a blank Status would be worse than useless: blank reads back as
  // ACTIVE on import, so the next ProShop round-trip would quietly promote every
  // beta tool. Returning no rows is the only honest answer.
  if(!exportsToProShop({tool_status:f.status})) return [];
  const brandRows=buildBrandRows(f);
  const firstVals=PS_MAIN_COLS.map(([,fn])=>fn(f));
  const contVals=PS_MAIN_COLS.map(([h,fn])=>PS_FIRST_ROW_ONLY.has(h)?"":fn(f));
  return (brandRows.length?brandRows:[{}]).map((b,i)=>[
    ...(i===0?firstVals:contVals),
    b.approvedBrand||"",b.vendor||"",b.edp||"",b.cost||"",b.leadTime||"",
  ]);
}

function buildProShopCSV(f){
  const hdr=[...PS_MAIN_COLS.map(([h])=>h),...PURCHASING_COLS].map(csvCell).join(",");
  const rows=buildProShopRows(f).map(r=>r.map(csvCell).join(","));
  return [hdr,...rows].join("\n");
}

const BLANK={
  toolType:"flat end mill",diameter:"",loc:"",oal:"",flutes:"",shankDia:"",cornerRadius:"0",material:"carbide",
  coating:"",workpieceMats:[],tipAngle:"",pitch:"",edpNumber:"",productLink:"",presetName:"",toolNumber:"",
  coolant:"flood",helixAngle:"",centerCutting:false,customGrind:false,fluteType:"",fluteDesign:"",grouping:"",approvedBrand:"",vendor:"",
  cost:"",vendorStockNum:"",tapClass:"",pointType:"",shoulderLen:"",ooh:"",minOoh:"",taperAngle:"",
  minThreadPitch:"",maxThreadPitch:"",fullProfile:false,stubJobber:"",backsideCapable:false,doubleEnded:false,
  cuttingDirection:"Right Hand",tipDiameter:"",lowerRadius:"",upperRadius:"",profileRadius:"",axialDistance:"",
  psToolId:"",    // ProShop Tool # → Fusion tool_productId (col 126)
  location:"",    // e.g. LC-140 → Fusion tool_vendor (col 165)
  tapSubType:"",isSTI:false,tpiMin:"",tpiMax:"",threadProfileAngle:"",tipToFirstFullThread:"",
  status:"active",   // lifecycle — see src/utils/toolStatus.js
  purchasing:{manufacturers:[],vendors:[]},  // { manufacturers: [{id,name,edp,edp_url,mfg_num,mfg_num_url,order}], vendors: [{id,manufacturer_id,name,vendor_num,vendor_num_url,price,order}] }
};
const TT=[
  "flat end mill","ball end mill","bull nose end mill","tapered mill","radius mill","form mill","lollipop mill",
  "slot/key cutter","dovetail","thread mill","face mill","chamfer mill",
  "circle segment barrel","circle segment lens","circle segment oval","circle segment taper",
  "drill","center drill","spot drill","reamer","counter bore","counter sink","tap",
  "boring head","turning general",
];
const TL={
  "flat end mill":"Flat End Mill","ball end mill":"Ball End Mill","bull nose end mill":"Bull Nose End Mill","rough end mill":"Rough End Mill",
  "tapered mill":"Tapered Mill","radius mill":"Radius Mill","form mill":"Form Tool","lollipop mill":"Lollipop Mill",
  "slot/key cutter":"Slot / Key Cutter","dovetail":"Dovetail Mill","thread mill":"Thread Mill","face mill":"Face Mill","chamfer mill":"Chamfer / Engrave Mill",
  "circle segment barrel":"Circle Segment Barrel","circle segment lens":"Circle Segment Lens (High Feed)","circle segment oval":"Circle Segment Oval","circle segment taper":"Circle Segment Taper",
  "drill":"Drill","center drill":"Center Drill","spot drill":"Spot Drill","reamer":"Reamer","counter bore":"Counter Bore","counter sink":"Counter Sink",
  "tap":"Tap","boring head":"Boring Bar","boring bar":"Boring Bar","turning general":"Turning (Insert)",
};
const WM=["","N","M","P","S","K"];
const CO=["","UC","AlTiN","TiAlN","TiN","ZrN","DLC"];
const MA=["carbide","hss","cobalt","ceramic"];

// FIELD_VISIBILITY — per-type show/hide matrix (1=required, 0=hidden, "o"=optional).
// Type applicability is now also captured in src/schema/fieldRegistry.js
// (FIELD_REGISTRY[field].appliesToTypes). Keep both in sync when adding fields,
// but add new fields to the registry first.
const _FV_KEYS=["flat end mill","ball end mill","bull nose end mill","tapered mill","radius mill","form mill","face mill","chamfer mill","dovetail","lollipop mill","slot/key cutter","thread mill","circle segment barrel","circle segment lens","circle segment oval","circle segment taper","drill","center drill","spot drill","reamer","counter bore","counter sink","tap","boring head","turning general"];
const FIELD_VISIBILITY={
  toolType:[1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],grouping:[1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
  diameter:[1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],loc:[1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0,0],
  oal:[1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],shankDia:[1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0],
  shoulderLen:[1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0],ooh:[1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0],
  cornerRadius:[0,0,1,1,1,0,0,0,1,1,1,0,0,1,0,0,0,0,0,0,0,0,0,0,0],tipAngle:[0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1,1,1,0,0,1,0,0,0],
  taperAngle:[0,0,0,1,0,0,1,1,1,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0],tipDiameter:[0,0,0,0,0,0,0,1,1,0,0,1,0,0,0,1,0,1,1,0,0,1,1,0,0],
  lowerRadius:[0,0,0,0,0,0,0,0,0,0,0,0,1,1,1,1,0,0,0,0,0,0,0,0,0],upperRadius:[0,0,0,0,0,0,1,0,0,0,0,0,1,0,0,1,0,0,0,0,0,0,0,0,0],
  profileRadius:[0,0,0,0,0,0,0,0,0,0,0,0,1,0,1,1,0,0,0,0,0,0,0,0,0],axialDistance:[0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0],
  material:[1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0],coating:[1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0],
  workpieceMats:[1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,"o",1,1],coolant:[1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
  flutes:[1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0,1],helixAngle:[1,1,1,1,1,1,0,0,0,1,1,1,0,0,0,0,1,0,0,0,0,0,0,0,0],
  fluteType:[1,1,1,1,1,1,0,0,0,1,1,0,0,0,0,0,"o",0,0,0,0,0,0,0,0],centerCutting:[1,1,1,1,0,"o",0,1,0,1,0,0,0,0,0,0,1,1,1,0,0,0,0,0,0],
  cuttingDirection:[1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],backsideCapable:[0,0,0,0,0,1,0,0,1,1,1,1,0,0,0,0,0,0,0,0,0,0,0,1,0],
  doubleEnded:[1,1,1,1,1,0,1,0,0,0,0,0,0,0,0,0,1,1,1,0,0,0,0,0,0],fullProfile:[0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0],
  stubJobber:[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0],pitch:[0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,1,0,0],
  tapClass:[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0],minThreadPitch:[0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0],
  maxThreadPitch:[0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0],pointType:[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0],
  tpiMin:[0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0],tpiMax:[0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0],
  threadProfileAngle:[0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0],isSTI:[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0],
  edpNumber:[1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],approvedBrand:[1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
  vendor:[1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],vendorStockNum:[1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
  cost:[1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],productLink:[1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
  presetName:[1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],toolNumber:[1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
  psToolId:[1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],location:[1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
};
function getVisibleFields(toolType){
  const idx=_FV_KEYS.indexOf(toolType);
  if(idx<0) return Object.keys(FIELD_VISIBILITY).map(key=>({key,optional:false}));
  return Object.entries(FIELD_VISIBILITY).filter(([,v])=>v[idx]!==0&&v[idx]!==false).map(([key,v])=>({key,optional:v[idx]==="o"||v[idx]==="optional"}));
}

function downloadCSV(content,filename){
  const blob=new Blob([content],{type:"text/csv;charset=utf-8;"});
  const url=URL.createObjectURL(blob),a=document.createElement("a");
  a.href=url;a.download=filename;document.body.appendChild(a);a.click();document.body.removeChild(a);URL.revokeObjectURL(url);
}

export {
  TT, TL, BLANK, FIELD_VISIBILITY, _FV_KEYS,
  MA, CO, WM,
  PS_GROUPS, AUTO_GROUP, typeFromProShopGroup, PS_MAIN_COLS,
  COOLANT_OPTS, THROUGH_COOLANT_VALUES, ROUND_SHANK_TYPES,
  buildFusionRow, buildProShopCSV, buildProShopRows, PURCHASING_COLS, buildDesc, buildBrandRows, buildAdionUrl,
  getVisibleFields, downloadCSV, smartDiam,
};
