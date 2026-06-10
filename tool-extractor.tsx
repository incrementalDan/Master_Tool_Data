import { useState, useRef, useCallback, useEffect } from "react";
import { THROUGH_COOLANT_VALUES, smartDiam, buildDesc } from "./src/utils/toolNaming.js";

// ─── THEME ────────────────────────────────────────────────────────────────────
const BLUE   = "#4a8fff";
const ORANGE = "#d97830";
const T = {
  pageBg:  "#1a1a1a", cardBg: "#242424", cardBg2: "#2c2c2c",
  border:  "#383838", borderFocus: BLUE,
  text:    "#e0e0e0", sub: "#666", label: "#999",
  ph:      "#3a3a3a",
  green:   "#45b36b", greenDim: "#1a3326",
  amber:   "#d4922a", amberDim: "#2a1e08",
  red:     "#d94f4f", redDim:   "#280d0d",
  inputBg: "#181818", mono: "#b8b8b8",
};

// ─── MANUFACTURER / APPROVED BRAND LIST ──────────────────────────────────────
const MANUFACTURER_LIST = [
  // Tool manufacturers — from MSC approved brand list + existing suppliers
  "Accupro","Cleveland","Emuge","HAIMER","Harvey Tool","Helical Solutions",
  "Hertel","Ingersoll Cutting Tools","Internal Tool","Iscar","Kennametal",
  "Keo","LMT","M.A. Ford","Melin Tool","Micro 100","Mitsubishi","OSG",
  "RobbJack","SGS","Sandvik Coromant","Seco","Titan USA","Tungaloy",
  "Value Collection","Widia","YG-1","Guhring",
  // Additional house brands / specialty
  "Fraisa USA","Haas Automation","Lakeshore Carbide","Liberty Tool Co",
].sort();

// ─── VENDOR / DISTRIBUTOR LIST ────────────────────────────────────────────────
const VENDOR_LIST = [
  "Adion Systems","ALMCO","B&B Dynamic Machining","Boedeker Plastics, Inc.",
  "Butler Bros Supply Division","Camden Tool Inc","Castle Metals","CMW Tech",
  "Copper and Brass Sales","Evans Heat Treating","Finishing Innovations LLC",
  "Hadco Metal Trading","Hard Chrome Specialists, Inc.",
  "Hillock Anodizing","Industraplate","Jones Kinden","K&L Plating Company",
  "Laser Source","Liberty Manufacturing",
  "McMaster-Carr","Metropolitan Flag & Banner Co","MSC Industrial","NexGenSolutions",
  "Online Metals","Orange Vise Company LLC","Pierson Workholding","Precision Finishing",
  "PTSolutions","SK Industrial","Vibrant Finish LLC","Yamazen Inc","Yarde Metals",
];

const COOLANT_OPTS = [
  ["flood","Flood"],["disabled","Disabled"],["mist","Mist"],
  ["through tool","Through tool"],["air","Air"],
  ["air through tool","Air through tool"],["suction","Suction"],
  ["flood and mist","Flood and mist"],["flood and through tool","Flood and through tool"],
];

const PS_GROUPS = [
  ["A","Square and Bull Endmill"],["B","Ball Endmill and Drill Mill"],
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
};
const ROUND_SHANK_TYPES = new Set([
  "flat end mill","ball end mill","bull nose end mill","tapered mill","radius mill","form mill","lollipop mill",
  "slot/key cutter","dovetail","thread mill","chamfer mill",
  "circle segment barrel","circle segment lens","circle segment oval","circle segment taper",
  "drill","center drill","spot drill","reamer","counter bore","counter sink","tap",
]);
const FLUTE_TYPE_OPTS = ["","Roughing","Semi-Finishing","Finishing","Yes","No"];

function parseFieldVal(raw) {
  if (!raw && raw !== 0) return "";
  const s = String(raw).trim();
  const mmMatch = s.match(/^([0-9.]+)\s*mm$/i);
  if (mmMatch) return String(parseFloat((parseFloat(mmMatch[1]) / 25.4).toFixed(6)));
  return s;
}
function mmLabel(inVal) {
  const v = parseFloat(inVal);
  if (!v) return "";
  return `[${parseFloat((v * 25.4).toFixed(4))}mm]`;
}
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

// Build Adion/ProShop product link from psToolId
// e.g. 'F-225' → 'https://americanprecisionworks.adionsystems.com/procnc/tools/F/F-225$'
function buildAdionUrl(psToolId){
  if(!psToolId) return "";
  const prefix=psToolId.split("-")[0]||""; if(!prefix) return "";
  return `https://americanprecisionworks.adionsystems.com/procnc/tools/${prefix}/${psToolId}$`;
}
// Extract prefix letter(s) from psToolId (everything before first '-')
function psToolPrefix(psToolId){ return psToolId?(psToolId.split("-")[0]||""):"" }

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
  const desc=buildDesc(f,false),pre=f.presetName||desc,edp=f.edpNumber||"",url=f.productLink||"";
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
  const tipTypes=new Set(["drill","center drill","spot drill","counter sink","chamfer mill"]);
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
  ["description",f=>buildDesc(f,false)],["cutDiameter",f=>f.diameter||""],["lengthOfCut",f=>f.loc||""],
  ["overallLength",f=>f.oal||""],["no. of flutes",f=>f.flutes||""],["shankDiameter",f=>f.shankDia||f.diameter||""],
  ["bodyDiameter",f=>f.shankDia||f.diameter||""],["cornerRadius",f=>f.cornerRadius||""],["tipAngle",f=>f.tipAngle||""],
  ["helixAngle",f=>f.helixAngle||""],["coating",f=>f.coating||""],["toolMaterial",f=>f.material||""],
  ["recommendedWorkpieceMaterial",f=>(f.workpieceMats&&f.workpieceMats.length?f.workpieceMats.join(", "):f.workpieceMat||"")],
  ["centerCutting",f=>f.centerCutting?"true":"false"],["throughCoolant",f=>THROUGH_COOLANT_VALUES.has(f.coolant||"")?"true":"false"],
  ["roundShank",f=>ROUND_SHANK_TYPES.has(f.toolType)?"true":"false"],["toolGroupLetter",f=>f.grouping||AUTO_GROUP[f.toolType]||"M"],
  ["pitch",f=>f.pitch||""],["fluteType",f=>f.fluteType||""],["lengthBelowShankDiameter",f=>f.ooh?String(parseFloat(f.ooh)):""],
  ["tapClass",f=>f.tapClass||""],["threadsPerInch",f=>calcTPI(f.pitch)||""],["thread",f=>f.pitch||""],
  ["threadType",f=>f.toolType!=="tap"?"":f.tapSubType==="form"?"Form":"Cut"],
  ["fullProfile",f=>f.fullProfile?"true":""],["stubJobber",f=>f.stubJobber||""],["backsideCapable",f=>f.backsideCapable?"true":""],
  ["doubleEnded",f=>f.doubleEnded?"true":""],["cuttingDirection",f=>f.cuttingDirection||"Right Hand"],
  ["taperAngle",f=>f.taperAngle||""],["minThreadPitch",f=>f.minThreadPitch||""],["maxThreadPitch",f=>f.maxThreadPitch||""],
  ["tipToFirstFullThread",f=>f.tipToFirstFullThread||""],
];

function buildBrandRows(f){
  const mfr=f.approvedBrand||"",vendor=f.vendor||"",mfrEdp=f.edpNumber||"",venEdp=f.vendorStockNum||"",cost=f.cost||"";
  if(!vendor||vendor===mfr) return [{approvedBrand:mfr||vendor,edp:mfrEdp||venEdp,cost,vendor}];
  const rows=[];
  if(mfr||mfrEdp) rows.push({approvedBrand:mfr,edp:mfrEdp,cost:"",vendor:""});
  rows.push({approvedBrand:vendor,edp:venEdp,cost,vendor});
  return rows;
}
function csvCell(v){const s=String(v===null||v===undefined?"":v);return(s.includes(",")||s.includes('"')||s.includes("\n"))?`"${s.replace(/"/g,'""')}"`:s;}
function buildProShopCSV(f){
  const brandRows=buildBrandRows(f),b1=brandRows[0]||{},b2=brandRows[1]||{};
  const hdr=[...PS_MAIN_COLS.map(([h])=>h),"approvedBrand","EDP#","cost","vendor",...(brandRows.length>1?["approvedBrand_2","EDP#_2","cost_2","vendor_2"]:[])].map(csvCell).join(",");
  const row=[...PS_MAIN_COLS.map(([,fn])=>fn(f)),b1.approvedBrand||"",b1.edp||"",b1.cost||"",b1.vendor||"",...(brandRows.length>1?[b2.approvedBrand||"",b2.edp||"",b2.cost||"",b2.vendor||""]:[])].map(csvCell).join(",");
  return hdr+"\n"+row;
}

const BLANK={
  toolType:"flat end mill",diameter:"",loc:"",oal:"",flutes:"",shankDia:"",cornerRadius:"0",material:"carbide",
  coating:"",workpieceMats:[],tipAngle:"",pitch:"",edpNumber:"",productLink:"",presetName:"",toolNumber:"",
  coolant:"flood",helixAngle:"",centerCutting:false,fluteType:"",grouping:"",approvedBrand:"",vendor:"",
  cost:"",vendorStockNum:"",tapClass:"",pointType:"",shoulderLen:"",ooh:"",taperAngle:"",
  minThreadPitch:"",maxThreadPitch:"",fullProfile:false,stubJobber:"",backsideCapable:false,doubleEnded:false,
  cuttingDirection:"Right Hand",tipDiameter:"",lowerRadius:"",upperRadius:"",profileRadius:"",axialDistance:"",
  psToolId:"",    // ProShop Tool # → Fusion tool_productId (col 126)
  location:"",    // e.g. LC-140 → Fusion tool_vendor (col 165)
  tapSubType:"cut",isSTI:false,tpiMin:"",tpiMax:"",threadProfileAngle:"",tipToFirstFullThread:"",
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
  cornerRadius:[0,0,1,1,1,0,0,0,1,1,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0],tipAngle:[0,0,0,0,0,0,0,1,1,0,0,0,0,0,0,0,1,1,1,0,0,1,0,0,0],
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
  maxThreadPitch:[0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0],pointType:[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,1,0,0,1,1,0,0],
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

const VENDOR_LIST_STR=VENDOR_LIST.join(", ");
const MANUFACTURER_LIST_STR=MANUFACTURER_LIST.join(", ");
function buildSYS(){
  return `You are a machining expert. Extract tool data from product pages, spec sheets, or text. Return ONLY valid JSON — no markdown, no extra text:
{"toolType":"flat end mill|ball end mill|bull nose end mill|tapered mill|radius mill|form mill|lollipop mill|slot/key cutter|dovetail|thread mill|face mill|chamfer mill|circle segment barrel|circle segment lens|circle segment oval|circle segment taper|drill|center drill|spot drill|reamer|counter bore|counter sink|tap|boring head|turning general","diameter":"cutting diameter decimal inches","loc":"flute/cutting length decimal inches","oal":"overall length decimal inches","flutes":"integer string","shankDia":"shank diameter decimal inches","cornerRadius":"0 for square, half-dia for ball, actual CR for bull nose","material":"carbide|hss|cobalt|ceramic","coating":"Normalize: Uncoated/Bright → UC. Otherwise copy verbatim. Empty if not stated.","workpieceMats":"Array ISO codes N=Al,M=SS,P=Steel,S=HTA,K=CI primary first","tipAngle":"included angle degrees for drills/chamfers/spot — else empty","helixAngle":"helix degrees if visible","pitch":"thread size x pitch (e.g. 1/4-20 or M6x1.0) for taps/thread mills — else empty","productLink":"url if visible","edpNumber":"Mfr# — NOT distributor stock#","approvedBrand":"manufacturer of the tool. Match to: ${MANUFACTURER_LIST_STR}. If the brand is not in the list but clearly a tool manufacturer, still return it exactly as shown on the page.","vendorStockNum":"distributor catalog#. Empty if not found.","vendor":"seller. Match: ${VENDOR_LIST_STR}. Empty if not confident.","coolant":"flood|disabled|mist|through tool|air|air through tool|suction|flood and mist|flood and through tool — default flood. If tool is described as through-coolant or through-spindle coolant, return \"flood and through tool\".","centerCutting":true,"fluteType":"Roughing|Semi-Finishing|Finishing|Yes|No or empty","tapClass":"Tolerance class, e.g. H3/6H or D2-D6. Empty if not tap.","tapSubType":"cut|form — tap sub-type from description/markings. Empty if not tap.","isSTI":"true if the tap is an STI/Helicoil thread insert tap, else false. Only relevant for taps.","threadUnit":"inch|metric — infer from the thread designation format (M-prefix or mm pitch = metric). Empty if not tap or thread mill.","pointType":"Bottoming|Modified Bottoming|Plug|Taper|Spiral Point|Spiral Flute|Forming. Empty if not tap.","shoulderLen":"shoulder length >= LOC decimal inches. Empty if unsure.","ooh":"Leave empty — user sets manually.","cost":"The best actual purchase price for this specific tool. Follow these rules in order:
  1. HAAS TOOLS ONLY: Use the Winner's Circle price if shown — ignore all other prices.
  2. DISCOUNTED PRICE: If a sale price, your price, web price, or discounted price is shown alongside a list/regular price, use the discounted one.
  3. PACK PRICING: If the item is only sold in a multi-pack (e.g. pkg of 10, box of 5), use the total pack price — not the per-unit breakdown price.
  4. SINGLE-TOOL PRICE: If multiple different tools are listed on the same page (e.g. a size chart or related products), only use the price for the specific tool being described — not the cheapest one on the page.
  5. FALLBACK: If only one price is shown with no pack or discount context, use it.
  Return as a decimal string (e.g. \"28.28\"). Empty if no price found.","sourceUnits":"in|mm","taperAngle":"taper/lead angle degrees","minThreadPitch":"thread mill TPN decimal inches","maxThreadPitch":"thread mill TPX decimal inches","tpiMin":"thread mill minimum TPI (threads per inch) capability — integer string. Empty if not thread mill.","tpiMax":"thread mill maximum TPI capability — integer string. Empty if not thread mill.","threadProfileAngle":"thread mill thread profile included angle in degrees (e.g. 60 for unified, 55 for Whitworth). Empty if not thread mill or unknown.","fullProfile":false,"stubJobber":"Stub or Jobber if specified","backsideCapable":false,"doubleEnded":false,"cuttingDirection":"Right Hand or Left Hand","notes":"brief note"}
Rules: Convert metric to inches. Ball cornerRadius=dia/2. Drills tipAngle=full included angle (135 not 67.5). Return ONLY JSON.`;
}

function tryCopy(text,taRef,setLbl,done,reset){
  const fb=()=>{if(taRef?.current){taRef.current.value=text;taRef.current.focus();taRef.current.select();try{document.execCommand("copy");setLbl(done);}catch{setLbl("Select all & Ctrl+C");}setTimeout(()=>setLbl(reset),3000);}};
  if(navigator.clipboard?.writeText){navigator.clipboard.writeText(text).then(()=>{setLbl(done);setTimeout(()=>setLbl(reset),2500);}).catch(fb);}else{fb();}
}
function downloadCSV(content,filename){
  const blob=new Blob([content],{type:"text/csv;charset=utf-8;"});
  const url=URL.createObjectURL(blob),a=document.createElement("a");
  a.href=url;a.download=filename;document.body.appendChild(a);a.click();document.body.removeChild(a);URL.revokeObjectURL(url);
}

const Icon={
  screenshot:()=><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="1" y="3" width="14" height="10" rx="1.5"/><circle cx="8" cy="8" r="2.5"/><path d="M5.5 3L6.5 1.5H9.5L10.5 3"/></svg>,
  text:()=><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2 4h12M2 7h8M2 10h10M2 13h6"/></svg>,
  copy:()=><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="5" y="5" width="9" height="9" rx="1"/><path d="M5 5V3a1 1 0 00-1-1H3a1 1 0 00-1 1v8a1 1 0 001 1h2"/></svg>,
  download:()=><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M8 2v8M5 7l3 3 3-3"/><path d="M2 12h12v2H2z"/></svg>,
  extract:()=><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="8" r="6"/><path d="M8 5v3l2 2"/></svg>,
  clear:()=><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 3l10 10M13 3L3 13"/></svg>,
};

const PILL_STYLES={
  fusion:{background:`${BLUE}22`,border:`1px solid ${BLUE}66`,color:BLUE,borderRadius:4,padding:"1px 7px",fontSize:10,fontWeight:500,display:"inline-flex",alignItems:"center",letterSpacing:"0.03em",whiteSpace:"nowrap"},
  proshop:{background:`${ORANGE}22`,border:`1px solid ${ORANGE}66`,color:ORANGE,borderRadius:4,padding:"1px 7px",fontSize:10,fontWeight:500,display:"inline-flex",alignItems:"center",letterSpacing:"0.03em",whiteSpace:"nowrap"},
};
function Pill({type,children}){
  if(type==="both") return(
    <span style={{display:"inline-flex",borderRadius:4,overflow:"hidden",fontSize:10,fontWeight:500,letterSpacing:"0.03em"}}>
      <span style={{background:`${BLUE}28`,color:BLUE,padding:"1px 6px",borderTop:`1px solid ${BLUE}66`,borderBottom:`1px solid ${BLUE}66`,borderLeft:`1px solid ${BLUE}66`}}>F</span>
      <span style={{background:`${ORANGE}1a`,color:"#999",padding:"1px 7px",borderTop:`1px solid ${ORANGE}55`,borderBottom:`1px solid ${ORANGE}55`,borderRight:`1px solid ${ORANGE}55`}}>{children}</span>
      <span style={{background:`${ORANGE}28`,color:ORANGE,padding:"1px 6px",borderTop:`1px solid ${ORANGE}66`,borderBottom:`1px solid ${ORANGE}66`,borderRight:`1px solid ${ORANGE}66`}}>P</span>
    </span>
  );
  return <span style={PILL_STYLES[type]}>{children}</span>;
}
function FL({type,label}){
  if(type==="both") return(
    <div style={{display:"flex",overflow:"hidden",borderRadius:"4px 4px 0 0",border:`1px solid ${T.border}`,borderBottom:"none"}}>
      <span style={{background:`${BLUE}22`,color:BLUE,padding:"2px 6px",fontSize:9,fontWeight:700,borderRight:`1px solid ${T.border}`,whiteSpace:"nowrap"}}>F</span>
      <span style={{flex:1,color:T.label,padding:"2px 6px",fontSize:10,background:T.cardBg2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{label}</span>
      <span style={{background:`${ORANGE}22`,color:ORANGE,padding:"2px 6px",fontSize:9,fontWeight:700,borderLeft:`1px solid ${T.border}`,whiteSpace:"nowrap"}}>P</span>
    </div>
  );
  const isFusion=type==="fusion",col=isFusion?BLUE:ORANGE,bg=isFusion?`${BLUE}1a`:`${ORANGE}1a`,bdr=isFusion?`${BLUE}55`:`${ORANGE}55`;
  return <div style={{background:bg,border:`1px solid ${bdr}`,borderBottom:"none",borderRadius:"4px 4px 0 0",padding:"2px 7px",fontSize:10,fontWeight:500,color:col,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{label}</div>;
}
function GroupDiv({label}){
  return <div style={{display:"flex",alignItems:"center",gap:8,margin:"10px 0 6px"}}>
    <span style={{fontSize:9,color:T.sub,textTransform:"uppercase",letterSpacing:"0.1em",whiteSpace:"nowrap"}}>{label}</span>
    <div style={{flex:1,height:1,background:T.border}}/>
  </div>;
}
function Toggle({value,onChange,label}){
  return <div style={{display:"flex",alignItems:"center",gap:6,cursor:"pointer",height:27}} onClick={()=>onChange(!value)}>
    <div style={{width:30,height:16,borderRadius:8,background:value?T.green:T.border,position:"relative",transition:"background 0.15s",flexShrink:0}}>
      <div style={{width:12,height:12,borderRadius:6,background:"#fff",position:"absolute",top:2,left:value?16:2,transition:"left 0.15s"}}/>
    </div>
    <span style={{fontSize:12,color:value?T.green:T.sub}}>{label}</span>
  </div>;
}
function Chip({label,value,color}){
  return <span style={{fontSize:10,color:T.sub,background:T.cardBg2,border:`1px solid ${T.border}`,borderRadius:3,padding:"1px 5px",whiteSpace:"nowrap"}}>{label}: <span style={{color:color||T.label,fontWeight:500}}>{value}</span></span>;
}
function DimInput({fieldKey,value,onChange,placeholder,hi,inputWasMm}){
  const [raw,setRaw]=useState(value);
  useEffect(()=>{setRaw(value);},[value]);
  const commit=(v)=>{const parsed=parseFieldVal(v);setRaw(parsed);onChange(parsed);};
  const mm=inputWasMm&&value?mmLabel(value):"";
  return <div style={{position:"relative"}}>
    <input style={{width:"100%",borderRadius:"0 0 4px 4px",padding:"5px 7px",fontSize:12,color:T.text,background:T.inputBg,boxSizing:"border-box",outline:"none",height:27,border:`1px solid ${hi?"#45b36b":T.border}`,paddingRight:mm?"56px":"7px"}}
      value={raw} placeholder={placeholder} onChange={e=>setRaw(e.target.value)} onBlur={e=>commit(e.target.value)}/>
    {mm&&<span style={{position:"absolute",right:6,top:"50%",transform:"translateY(-50%)",fontSize:10,color:"#6b7280",pointerEvents:"none",whiteSpace:"nowrap"}}>{mm}</span>}
  </div>;
}
function UnitToggle({value,onChange}){
  const isIn=value==="inches";
  return <div style={{display:"flex",alignItems:"center",gap:6,flexShrink:0}}>
    <span style={{fontSize:10,color:isIn?T.text:T.sub,fontWeight:isIn?600:400}}>in</span>
    <div onClick={()=>onChange(isIn?"millimeters":"inches")} style={{width:36,height:20,borderRadius:10,background:isIn?"#3a3a3a":"#4a8fff",position:"relative",cursor:"pointer",transition:"background 0.2s",border:`1px solid ${isIn?T.border:"#4a8fff"}`}}>
      <div style={{width:16,height:16,borderRadius:8,background:"#fff",position:"absolute",top:1,left:isIn?1:17,transition:"left 0.2s",boxShadow:"0 1px 3px rgba(0,0,0,0.4)"}}/>
    </div>
    <span style={{fontSize:10,color:!isIn?T.text:T.sub,fontWeight:!isIn?600:400}}>mm</span>
  </div>;
}

const base={width:"100%",padding:"5px 7px",fontSize:12,color:T.text,background:T.inputBg,boxSizing:"border-box",outline:"none",height:27};
const inp=(hi)=>({...base,border:`1px solid ${hi?T.green:T.border}`,borderRadius:"0 0 4px 4px"});
const sel=(hi,warn)=>({...base,border:`1px solid ${warn?T.amber:hi?T.green:T.border}`,borderRadius:"0 0 4px 4px"});

export {
  TT, TL, BLANK, FIELD_VISIBILITY, _FV_KEYS,
  MA, CO, WM, MANUFACTURER_LIST, VENDOR_LIST,
  PS_GROUPS, AUTO_GROUP, PS_MAIN_COLS,
  COOLANT_OPTS, THROUGH_COOLANT_VALUES, ROUND_SHANK_TYPES,
  buildFusionRow, buildProShopCSV, buildDesc, buildBrandRows, buildAdionUrl,
  getVisibleFields, downloadCSV, smartDiam,
};

export default function App({ onExtract } = {}){
  const[inputMode,setInputMode]=useState("file");
  const[fileType,setFileType]=useState(null);
  const[imgB64,setImgB64]=useState(null);
  const[imgType,setImgType]=useState("image/png");
  const[imgPrev,setImgPrev]=useState(null);
  const[pdfB64,setPdfB64]=useState(null);
  const[pdfName,setPdfName]=useState("");
  const[txt,setTxt]=useState("");
  const[F,setF]=useState({...BLANK});
  const[loading,setLoading]=useState(false);
  const[err,setErr]=useState("");
  const[notes,setNotes]=useState("");
  const[exd,setExd]=useState(false);
  const[drag,setDrag]=useState(false);
  const[groupOverride,setGroupOverride]=useState(false);
  const[outputUnit,setOutputUnit]=useState("inches");
  const[inputWasMm,setInputWasMm]=useState(false);
  const[fusLbl,setFusLbl]=useState("Copy for Fusion");
  const[psLbl,setPsLbl]=useState("Export to ProShop");
  const fileRef=useRef(),taRef=useRef();
  const[recentTools,setRecentTools]=useState([]);

  // Load recent tools from persistent storage on mount
  useEffect(()=>{
    const load=async()=>{
      try{
        const res=await window.storage.get("recentTools");
        if(res&&res.value){
          const parsed=JSON.parse(res.value);
          if(Array.isArray(parsed)&&parsed.length>0) setRecentTools(parsed);
        }
      }catch(e){
        // window.storage not available — session-only mode, no problem
      }
    };
    load();
  },[]);

  // Persist to storage — completely separate from state, never blocks render
  const persistRecent=(updated)=>{
    try{
      if(window.storage&&typeof window.storage.set==="function"){
        window.storage.set("recentTools",JSON.stringify(updated)).catch(()=>{});
      }
    }catch{}
  };

  // Save a tool to recent cache (max 10, newest first)
  const saveToRecent=(toolData,thumbB64)=>{
    const entry={
      id:Date.now(),
      ts:new Date().toLocaleDateString(),
      thumb:thumbB64||null,
      data:{...toolData},
    };
    // State update is synchronous and never touches storage
    setRecentTools(prev=>{
      const updated=[entry,...prev].slice(0,10);
      // Fire-and-forget persistence after state updates
      setTimeout(()=>persistRecent(updated),0);
      return updated;
    });
  };

  const removeRecent=(id)=>{
    setRecentTools(prev=>{
      const updated=prev.filter(r=>r.id!==id);
      setTimeout(()=>persistRecent(updated),0);
      return updated;
    });
  };

  const loadRecent=(entry)=>{
    setF({...BLANK,...entry.data});
    setExd(true);
    setGroupOverride(!!entry.data.grouping);
    setInputWasMm(false);
    if(entry.thumb){setImgPrev(entry.thumb);setFileType("image");}
    else{setImgPrev(null);}
  };
  const sf=(k,v)=>setF(p=>({...p,[k]:v}));
  const hi=(k)=>!!(exd&&F[k]!==undefined&&F[k]!==""&&F[k]!==false&&F[k]!=="0");
  const effGroup=groupOverride?F.grouping:(AUTO_GROUP[F.toolType]||"M");
  const Feff={...F,grouping:effGroup};

  const handleFile=useCallback((file)=>{
    if(!file) return;
    if(file.type==="application/pdf"){setFileType("pdf");setPdfName(file.name);const r=new FileReader();r.onload=e=>setPdfB64(e.target.result.split(",")[1]);r.readAsDataURL(file);}
    else if(file.type.startsWith("image/")){setFileType("image");setImgType(file.type||"image/png");const r=new FileReader();r.onload=e=>{setImgB64(e.target.result.split(",")[1]);setImgPrev(e.target.result);};r.readAsDataURL(file);}
  },[]);

  useEffect(()=>{
    const h=e=>{if(inputMode!=="file") return;const items=e.clipboardData?.items;if(!items) return;for(const i of items){if(i.type.startsWith("image/")||i.type==="application/pdf"){handleFile(i.getAsFile());break;}}};
    window.addEventListener("paste",h);return()=>window.removeEventListener("paste",h);
  },[inputMode,handleFile]);

  const go=async()=>{
    setLoading(true);setErr("");setNotes("");
    try{
      let messages;
      if(inputMode==="file"&&fileType==="image"&&imgB64) messages=[{role:"user",content:[{type:"image",source:{type:"base64",media_type:imgType,data:imgB64}},{type:"text",text:"Extract all tool data including price/cost if shown anywhere on this product page."}]}];
      else if(inputMode==="file"&&fileType==="pdf"&&pdfB64) messages=[{role:"user",content:[{type:"document",source:{type:"base64",media_type:"application/pdf",data:pdfB64}},{type:"text",text:"Extract all tool data including price/cost if shown anywhere."}]}];
      else messages=[{role:"user",content:"Extract tool data including price/cost:\n\n"+txt}];
      const r=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:1024,system:buildSYS(),messages})});
      if(!r.ok){const t=await r.text();throw new Error(`API ${r.status}: ${t.slice(0,200)}`);}
      const d=await r.json();
      const t=(d.content||[]).map(b=>b.text||"").join("").replace(/```json|```/g,"").trim();
      const p=JSON.parse(t);
      const validCoolants=COOLANT_OPTS.map(([v])=>v);
      setF(prev=>({...prev,
        toolType:TT.includes(p.toolType)?p.toolType:prev.toolType,
        diameter:p.diameter||"",loc:p.loc||"",oal:p.oal||"",flutes:p.flutes||"",
        shankDia:p.shankDia||"",cornerRadius:p.cornerRadius??"0",
        material:MA.includes(p.material)?p.material:"carbide",coating:p.coating||"",
        workpieceMats:Array.isArray(p.workpieceMats)?p.workpieceMats.filter(x=>WM.includes(x)):(WM.includes(p.workpieceMat)?[p.workpieceMat]:[]),
        tipAngle:p.tipAngle||"",helixAngle:p.helixAngle||"",pitch:p.pitch||"",productLink:p.productLink||"",
        edpNumber:p.edpNumber||"",
        approvedBrand:p.approvedBrand||"",  // allow any manufacturer, not just list
        vendor:VENDOR_LIST.includes(p.vendor)?p.vendor:"",
        vendorStockNum:p.vendorStockNum||"",
        coolant:(()=>{
          const raw=p.coolant||"";
          if(!raw||!validCoolants.includes(raw)) return "flood";
          // If tool is through-coolant capable, use flood and through tool; otherwise flood
          if(raw==="through tool"||raw==="air through tool") return "flood and through tool";
          return raw;
        })(),
        centerCutting:!!p.centerCutting,fluteType:p.fluteType||"",cost:p.cost||"",
        tapClass:p.tapClass||"",pointType:p.pointType||"",shoulderLen:p.shoulderLen||"",ooh:p.ooh||"",
        taperAngle:p.taperAngle||"",minThreadPitch:p.minThreadPitch||"",maxThreadPitch:p.maxThreadPitch||"",
        tapSubType:["cut","form"].includes(p.tapSubType)?p.tapSubType:"cut",isSTI:!!p.isSTI,
        tpiMin:p.tpiMin||"",tpiMax:p.tpiMax||"",threadProfileAngle:p.threadProfileAngle||"",
        fullProfile:!!p.fullProfile,stubJobber:p.stubJobber||"",backsideCapable:!!p.backsideCapable,
        doubleEnded:!!p.doubleEnded,cuttingDirection:p.cuttingDirection||"Right Hand",
      }));
      if(p.notes)setNotes(p.notes);
      setInputWasMm(p.sourceUnits==="mm");
      setExd(true);
      // Save snapshot to recent — capture current state after setF
      // We use a microtask so setF has flushed
      const snapData={
        toolType:TT.includes(p.toolType)?p.toolType:"flat end mill",
        diameter:p.diameter||"",loc:p.loc||"",oal:p.oal||"",flutes:p.flutes||"",
        shankDia:p.shankDia||"",cornerRadius:p.cornerRadius??"0",
        material:MA.includes(p.material)?p.material:"carbide",coating:p.coating||"",
        workpieceMats:Array.isArray(p.workpieceMats)?p.workpieceMats.filter(x=>WM.includes(x)):[],
        tipAngle:p.tipAngle||"",pitch:p.pitch||"",edpNumber:p.edpNumber||"",
        approvedBrand:p.approvedBrand||"",vendor:VENDOR_LIST.includes(p.vendor)?p.vendor:"",
        vendorStockNum:p.vendorStockNum||"",cost:p.cost||"",productLink:p.productLink||"",
        coolant:"flood",tapClass:p.tapClass||"",pointType:p.pointType||"",
        shoulderLen:p.shoulderLen||"",ooh:p.ooh||"",taperAngle:p.taperAngle||"",
        minThreadPitch:p.minThreadPitch||"",maxThreadPitch:p.maxThreadPitch||"",
        tapSubType:["cut","form"].includes(p.tapSubType)?p.tapSubType:"cut",isSTI:!!p.isSTI,
        tpiMin:p.tpiMin||"",tpiMax:p.tpiMax||"",threadProfileAngle:p.threadProfileAngle||"",
        fullProfile:!!p.fullProfile,stubJobber:p.stubJobber||"",
        backsideCapable:!!p.backsideCapable,doubleEnded:!!p.doubleEnded,
        cuttingDirection:p.cuttingDirection||"Right Hand",
        helixAngle:p.helixAngle||"",fluteType:p.fluteType||"",
        grouping:"",presetName:"",toolNumber:"",psToolId:"",location:"",
        tipDiameter:"",lowerRadius:"",upperRadius:"",profileRadius:"",axialDistance:"",
      };
      // Store thumbnail only for images under 400KB (base64)
      const thumb=(fileType==="image"&&imgB64&&imgB64.length<400000)?imgPrev:null;
      saveToRecent(snapData,thumb);
    }catch(e){setErr(e.message||"Extraction failed");}
    setLoading(false);
  };

  const ok=(inputMode==="file"&&!!(fileType==="image"?imgB64:pdfB64))||(inputMode==="text"&&txt.trim().length>10);
  const handleCopyFusion=()=>tryCopy(FUSION_HDR+"\n"+buildFusionRow(Feff,outputUnit),taRef,setFusLbl,"✓ Copied","Copy for Fusion");
  const handleExportPS=()=>{const slug=buildDesc(Feff).replace(/[^a-zA-Z0-9_-]/g,"_").slice(0,40)||"tool";downloadCSV(buildProShopCSV(Feff),`ProShop_${slug}.csv`);setPsLbl("✓ Downloaded");setTimeout(()=>setPsLbl("Export to ProShop"),2500);};
  const clear=()=>{setF({...BLANK});setImgB64(null);setImgPrev(null);setPdfB64(null);setPdfName("");setTxt("");setFileType(null);setExd(false);setErr("");setNotes("");setGroupOverride(false);setInputWasMm(false);};

  const cardStyle={background:T.cardBg,border:`1px solid ${T.border}`,borderRadius:7,padding:10};
  const G={display:"grid",gridTemplateColumns:"repeat(12,1fr)",gap:5,alignItems:"start"};
  const C=(n)=>({gridColumn:`span ${n}`});
  const _vf=getVisibleFields(F.toolType);
  const visMap=new Map(_vf.map(({key,optional})=>[key,optional]));
  const isVis=key=>visMap.has(key);
  const isOpt=key=>visMap.get(key)===true;
  const hasDim=["diameter","loc","oal","shankDia","shoulderLen","ooh","cornerRadius","tipAngle","taperAngle","tipDiameter","lowerRadius","upperRadius","profileRadius","axialDistance"].some(isVis);
  const hasMat=["material","coating","workpieceMats","coolant"].some(isVis);
  const hasCut=["flutes","helixAngle","fluteType","centerCutting","stubJobber","cuttingDirection","backsideCapable","doubleEnded"].some(isVis);
  const hasThread=["pitch","tapClass","pointType","minThreadPitch","maxThreadPitch","fullProfile","tpiMin","tpiMax","threadProfileAngle"].some(isVis);
  const hasPurch=["edpNumber","approvedBrand","vendor","vendorStockNum","cost","productLink"].some(isVis);

  return(
    <div style={{fontFamily:"-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",background:T.pageBg,minHeight:"100vh",padding:"10px 8px",color:T.text}}>
      <div style={{maxWidth:700,margin:"0 auto"}}>
        {/* HEADER */}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
          <div>
            <h1 style={{fontSize:14,fontWeight:600,color:T.text,margin:0}}>Tool Extractor</h1>
            <div style={{display:"flex",gap:6,marginTop:3}}>
              <Pill type="fusion">Fusion 360</Pill><Pill type="proshop">ProShop ERP</Pill><Pill type="both">Both</Pill>
            </div>
          </div>
          {exd&&<span style={{fontSize:10,color:T.green,background:T.greenDim,padding:"2px 7px",borderRadius:3,border:`1px solid ${T.green}44`}}>AI extracted</span>}
        </div>

        {/* RECENT TOOLS */}
        {recentTools.length>0&&(
          <div style={{marginBottom:6}}>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
              <span style={{fontSize:9,color:T.sub,textTransform:"uppercase",letterSpacing:"0.1em"}}>Recent</span>
              <div style={{flex:1,height:1,background:T.border}}/>
            </div>
            <div style={{display:"flex",gap:5,overflowX:"auto",paddingBottom:3}}>
              {recentTools.map(entry=>{
                const d=entry.data;
                const desc=buildDesc(d,false)||"—";
                const mfr=d.approvedBrand||"";
                const vendor=d.vendor&&d.vendor!==d.approvedBrand?d.vendor:"";
                const typeLabel=TL[d.toolType]||d.toolType||"";
                return(
                  <div key={entry.id}
                    style={{flexShrink:0,width:150,background:T.cardBg,border:`1px solid ${T.border}`,borderRadius:6,
                      padding:"6px 8px",cursor:"pointer",position:"relative",transition:"border-color 0.15s"}}
                    onClick={()=>loadRecent(entry)}
                    onMouseEnter={e=>e.currentTarget.style.borderColor=BLUE}
                    onMouseLeave={e=>e.currentTarget.style.borderColor=T.border}>
                    {/* Thumbnail */}
                    {entry.thumb&&<img src={entry.thumb} alt="" style={{width:"100%",height:50,objectFit:"cover",borderRadius:3,marginBottom:4,opacity:0.75}}/>}
                    {!entry.thumb&&<div style={{width:"100%",height:28,background:T.cardBg2,borderRadius:3,marginBottom:4,display:"flex",alignItems:"center",justifyContent:"center"}}>
                      <span style={{fontSize:9,color:T.sub}}>{typeLabel}</span>
                    </div>}
                    {/* Description */}
                    <div style={{fontSize:10,fontFamily:"monospace",color:T.mono,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",marginBottom:2}}>{desc}</div>
                    {/* Manufacturer / vendor */}
                    {mfr&&<div style={{fontSize:9,color:T.sub,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{mfr}{vendor?` · ${vendor}`:""}</div>}
                    {/* Date */}
                    <div style={{fontSize:9,color:T.sub,marginTop:2}}>{entry.ts}</div>
                    {/* Remove */}
                    <button onClick={e=>{e.stopPropagation();removeRecent(entry.id);}}
                      style={{position:"absolute",top:4,right:4,background:"transparent",border:"none",color:T.sub,cursor:"pointer",fontSize:11,lineHeight:1,padding:2}}
                      title="Remove">✕</button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* INPUT CARD */}
        <div style={{...cardStyle,marginBottom:6}}>
          <div style={{display:"flex",alignItems:"stretch",gap:8}}>
            <div style={{display:"flex",flexDirection:"column",gap:3,flexShrink:0}}>
              {[["file",<Icon.screenshot/>,"File"],["text",<Icon.text/>,"Text"]].map(([m,icon,label])=>(
                <button key={m} onClick={()=>setInputMode(m)} style={{display:"flex",alignItems:"center",gap:6,padding:"5px 10px",borderRadius:4,border:`1px solid ${inputMode===m?BLUE:T.border}`,cursor:"pointer",fontSize:12,background:inputMode===m?`${BLUE}22`:"transparent",color:inputMode===m?BLUE:T.sub,whiteSpace:"nowrap"}}>
                  {icon} {label}
                </button>
              ))}
            </div>
            <div style={{flex:1}}>
              {inputMode==="file"&&(
                <div onDragOver={e=>{e.preventDefault();setDrag(true);}} onDragLeave={()=>setDrag(false)}
                  onDrop={e=>{e.preventDefault();setDrag(false);handleFile(e.dataTransfer.files[0]);}}
                  onClick={()=>fileRef.current?.click()}
                  style={{border:`1.5px dashed ${drag?BLUE:T.border}`,borderRadius:5,padding:10,textAlign:"center",cursor:"pointer",background:T.inputBg,height:"100%",minHeight:80,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:4}}>
                  {fileType==="image"&&imgPrev?(<><img src={imgPrev} alt="" style={{maxHeight:90,maxWidth:"100%",borderRadius:3,opacity:.85}}/><span style={{fontSize:10,color:T.sub}}>Click or Ctrl+V to replace</span></>)
                    :fileType==="pdf"?(<><span style={{fontSize:12,color:T.text}}>{pdfName}</span><span style={{fontSize:10,color:T.sub}}>Click to replace</span></>)
                    :(<span style={{fontSize:11,color:T.sub,textAlign:"center"}}><span style={{color:BLUE,fontWeight:500}}>Ctrl+V</span> to paste · click to upload · drag & drop<br/><span style={{fontSize:10,display:"block",marginTop:2}}>Auto-detects screenshot or PDF</span></span>)}
                  <input ref={fileRef} type="file" accept="image/*,application/pdf" style={{display:"none"}} onChange={e=>handleFile(e.target.files[0])}/>
                </div>
              )}
              {inputMode==="text"&&(<textarea value={txt} onChange={e=>setTxt(e.target.value)} placeholder="Paste product page text — specs, dimensions, part numbers, price..." style={{...base,height:"100%",minHeight:80,resize:"vertical",fontFamily:"inherit",border:`1px solid ${T.border}`}}/>)}
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:3,flexShrink:0}}>
              <button onClick={go} disabled={!ok||loading} style={{display:"flex",alignItems:"center",gap:6,padding:"7px 12px",background:ok&&!loading?BLUE:"#2a2a2a",color:ok&&!loading?"#fff":T.sub,border:"none",borderRadius:4,fontSize:12,fontWeight:500,cursor:ok&&!loading?"pointer":"default"}}>
                {loading?<span style={{width:14,height:14,border:"2px solid rgba(255,255,255,0.3)",borderTopColor:"#fff",borderRadius:"50%",display:"inline-block",animation:"spin 0.7s linear infinite"}}/>:<Icon.extract/>}
                {loading?"Extracting…":"Extract"}
              </button>
              <button onClick={clear} style={{display:"flex",alignItems:"center",gap:6,padding:"6px 10px",background:"transparent",color:T.red,border:`1px solid ${T.red}55`,borderRadius:4,fontSize:12,cursor:"pointer"}}><Icon.clear/> Clear</button>
            </div>
          </div>
          {err&&<div style={{marginTop:6,fontSize:11,color:T.red,background:T.redDim,border:`1px solid ${T.red}44`,borderRadius:4,padding:"4px 8px"}}>{err}</div>}
          {notes&&<div style={{marginTop:6,fontSize:11,color:T.amber,background:T.amberDim,border:`1px solid ${T.amber}44`,borderRadius:4,padding:"4px 8px"}}>Note: {notes}</div>}
        </div>

        {/* DESC BAR */}
        <div style={{background:T.cardBg2,border:`1px solid ${T.border}`,borderRadius:5,padding:"5px 10px",marginBottom:6,display:"flex",alignItems:"center",gap:8}}>
          <span style={{fontSize:10,color:T.sub,textTransform:"uppercase",letterSpacing:"0.05em",whiteSpace:"nowrap"}}>Desc</span>
          <span style={{fontFamily:"monospace",fontSize:12,fontWeight:600,color:T.mono,flex:1,wordBreak:"break-all"}}>{buildDesc(F,inputWasMm)||"—"}</span>
          <div style={{display:"flex",alignItems:"center",gap:6,flexShrink:0,borderLeft:`1px solid ${T.border}`,paddingLeft:8}}>
            <span style={{fontSize:10,color:T.sub,whiteSpace:"nowrap"}}>Output</span>
            <UnitToggle value={outputUnit} onChange={setOutputUnit}/>
          </div>
        </div>

        {/* FORM */}
        <div style={cardStyle}>
          <GroupDiv label="Classification"/>
          <div style={G}>
            <div style={C(6)}>
              <FL type="fusion" label="Fusion Tool Type"/>
              <select style={sel(false)} value={F.toolType} onChange={e=>sf("toolType",e.target.value)}>
                {TT.map(t=><option key={t} value={t} style={{background:T.inputBg}}>{TL[t]}</option>)}
              </select>
            </div>
            <div style={C(6)}>
              <FL type="proshop" label={`ProShop Group${groupOverride?" (manual)":""}`}/>
              <select style={sel(false,groupOverride)} value={effGroup} onChange={e=>{sf("grouping",e.target.value);setGroupOverride(true);}}>
                {PS_GROUPS.map(([v,l])=><option key={v} value={v} style={{background:T.inputBg}}>{v} — {l}</option>)}
              </select>
              {groupOverride&&<span style={{fontSize:10,color:T.amber,cursor:"pointer",marginTop:2,display:"inline-block"}} onClick={()=>{setGroupOverride(false);sf("grouping","");}}>↩ Reset to auto ({AUTO_GROUP[F.toolType]||"M"})</span>}
            </div>
          </div>

          {hasDim&&<GroupDiv label="Dimensions"/>}
          <div style={G}>
            {isVis("diameter")&&<div style={{...C(4),opacity:isOpt("diameter")?0.55:1}}><FL type="both" label="Diameter (in)"/><DimInput fieldKey="diameter" value={F.diameter} onChange={v=>sf("diameter",v)} placeholder="0.375" hi={hi("diameter")} inputWasMm={inputWasMm}/></div>}
            {isVis("loc")&&<div style={{...C(4),opacity:isOpt("loc")?0.55:1}}><FL type="both" label="LOC (in)"/><DimInput fieldKey="loc" value={F.loc} onChange={v=>sf("loc",v)} placeholder="1.5" hi={hi("loc")} inputWasMm={inputWasMm}/></div>}
            {isVis("oal")&&<div style={{...C(4),opacity:isOpt("oal")?0.55:1}}><FL type="both" label="OAL (in)"/><DimInput fieldKey="oal" value={F.oal} onChange={v=>sf("oal",v)} placeholder="3.5" hi={hi("oal")} inputWasMm={inputWasMm}/></div>}
            {isVis("shankDia")&&<div style={{...C(4),opacity:isOpt("shankDia")?0.55:1}}><FL type="both" label="Shank Ø (in)"/><DimInput fieldKey="shankDia" value={F.shankDia} onChange={v=>sf("shankDia",v)} placeholder="0.375" hi={hi("shankDia")} inputWasMm={inputWasMm}/></div>}
            {isVis("cornerRadius")&&<div style={{...C(4),opacity:isOpt("cornerRadius")?0.55:1}}><FL type="both" label="Corner Radius"/><DimInput fieldKey="cornerRadius" value={F.cornerRadius} onChange={v=>sf("cornerRadius",v)} placeholder="0" hi={hi("cornerRadius")} inputWasMm={inputWasMm}/></div>}
            {isVis("tipAngle")&&<div style={{...C(4),opacity:isOpt("tipAngle")?0.55:1}}><FL type="both" label="Tip / Point Angle (°)"/><DimInput fieldKey="tipAngle" value={F.tipAngle} onChange={v=>sf("tipAngle",v)} placeholder="135" hi={hi("tipAngle")} inputWasMm={inputWasMm}/></div>}
            {isVis("taperAngle")&&<div style={{...C(4),opacity:isOpt("taperAngle")?0.55:1}}><FL type="both" label="Taper / Lead Angle (°)"/><DimInput fieldKey="taperAngle" value={F.taperAngle} onChange={v=>sf("taperAngle",v)} placeholder="3" hi={hi("taperAngle")} inputWasMm={inputWasMm}/></div>}
            {isVis("tipDiameter")&&<div style={{...C(4),opacity:isOpt("tipDiameter")?0.55:1}}><FL type="fusion" label="Tip Diameter (in)"/><DimInput fieldKey="tipDiameter" value={F.tipDiameter} onChange={v=>sf("tipDiameter",v)} placeholder="0" hi={hi("tipDiameter")} inputWasMm={inputWasMm}/></div>}
            {isVis("lowerRadius")&&<div style={{...C(4),opacity:isOpt("lowerRadius")?0.55:1}}><FL type="fusion" label="Lower Radius (in)"/><DimInput fieldKey="lowerRadius" value={F.lowerRadius} onChange={v=>sf("lowerRadius",v)} placeholder="0" hi={hi("lowerRadius")} inputWasMm={inputWasMm}/></div>}
            {isVis("upperRadius")&&<div style={{...C(4),opacity:isOpt("upperRadius")?0.55:1}}><FL type="fusion" label="Upper Radius (in)"/><DimInput fieldKey="upperRadius" value={F.upperRadius} onChange={v=>sf("upperRadius",v)} placeholder="0" hi={hi("upperRadius")} inputWasMm={inputWasMm}/></div>}
            {isVis("profileRadius")&&<div style={{...C(4),opacity:isOpt("profileRadius")?0.55:1}}><FL type="fusion" label="Profile Radius (in)"/><DimInput fieldKey="profileRadius" value={F.profileRadius} onChange={v=>sf("profileRadius",v)} placeholder="0" hi={hi("profileRadius")} inputWasMm={inputWasMm}/></div>}
            {isVis("axialDistance")&&<div style={{...C(4),opacity:isOpt("axialDistance")?0.55:1}}><FL type="fusion" label="Axial Distance (in)"/><DimInput fieldKey="axialDistance" value={F.axialDistance} onChange={v=>sf("axialDistance",v)} placeholder="0" hi={hi("axialDistance")} inputWasMm={inputWasMm}/></div>}
            {isVis("shoulderLen")&&<div style={{...C(4),opacity:isOpt("shoulderLen")?0.55:1}}>
              <FL type="fusion" label="Shoulder Length (in)"/>
              <DimInput fieldKey="shoulderLen" value={F.shoulderLen} onChange={v=>sf("shoulderLen",v)} placeholder={F.loc?"≥ "+F.loc+" (= LOC)":"= LOC"} hi={hi("shoulderLen")} inputWasMm={inputWasMm}/>
              {(()=>{const sl=parseFloat(F.shoulderLen),loc=parseFloat(F.loc);return sl&&loc&&sl<loc?<div style={{fontSize:10,color:T.red,marginTop:2}}>Must be ≥ LOC ({F.loc})</div>:null;})()}
            </div>}
            {isVis("ooh")&&<div style={{...C(4),opacity:isOpt("ooh")?0.55:1}}>
              <FL type="both" label="OOH / Len Below Holder (in)"/>
              <DimInput fieldKey="ooh" value={F.ooh} onChange={v=>sf("ooh",v)}
                placeholder={(()=>{const sl=parseFloat(F.shoulderLen),loc=parseFloat(F.loc);const sh=(sl&&sl>=loc)?sl:loc;return sh?"≥ "+sh+" (= Shoulder)":"= Shoulder";})()}
                hi={hi("ooh")} inputWasMm={inputWasMm}/>
              {(()=>{const sl=parseFloat(F.shoulderLen),loc=parseFloat(F.loc);const shoulder=(sl&&sl>=loc)?sl:loc;const ooh=parseFloat(F.ooh);return ooh&&shoulder&&ooh<shoulder?<div style={{fontSize:10,color:T.red,marginTop:2}}>Must be ≥ Shoulder</div>:null;})()}
            </div>}
          </div>

          {hasMat&&<GroupDiv label="Material & Coating"/>}
          <div style={G}>
            {isVis("material")&&<div style={{...C(3),opacity:isOpt("material")?0.55:1}}>
              <FL type="both" label="Tool Material"/>
              <select style={sel(false)} value={F.material} onChange={e=>sf("material",e.target.value)}>
                {MA.map(m=><option key={m} value={m} style={{background:T.inputBg}}>{m.charAt(0).toUpperCase()+m.slice(1)}</option>)}
              </select>
            </div>}
            {isVis("coating")&&<div style={{...C(3),opacity:isOpt("coating")?0.55:1}}>
              <FL type="both" label="Coating"/>
              <input style={inp(hi("coating"))} list="coating-opts" value={F.coating} onChange={e=>sf("coating",e.target.value)} placeholder="e.g. AlTiN, TiN, UC"/>
              <datalist id="coating-opts">{CO.filter(c=>c).map(c=><option key={c} value={c}/>)}</datalist>
            </div>}
            {isVis("workpieceMats")&&<div style={{...C(3),opacity:isOpt("workpieceMats")?0.55:1}}>
              <FL type="both" label="Workpiece Mat"/>
              <div style={{border:`1px solid ${(F.workpieceMats&&F.workpieceMats.length)?T.green:T.border}`,borderRadius:"0 0 4px 4px",background:T.inputBg,padding:"3px 6px",minHeight:27,display:"flex",flexWrap:"wrap",gap:"3px 6px",alignItems:"center"}}>
                {WM.filter(w=>w).map(w=>{
                  const active=(F.workpieceMats||[]).includes(w),isPrimary=active&&(F.workpieceMats||[])[0]===w;
                  return <span key={w} onClick={()=>{const cur=F.workpieceMats||[];sf("workpieceMats",active?cur.filter(x=>x!==w):[...cur,w]);}}
                    style={{cursor:"pointer",fontSize:11,fontWeight:500,padding:"1px 6px",borderRadius:3,background:isPrimary?BLUE:active?`${BLUE}44`:`${T.border}55`,color:active?"#fff":T.sub,userSelect:"none",border:`1px solid ${active?BLUE:T.border}`}}>
                    {w}{isPrimary&&<span style={{fontSize:9,marginLeft:3,opacity:0.8}}>★</span>}
                  </span>;
                })}
                {(!F.workpieceMats||!F.workpieceMats.length)&&<span style={{fontSize:10,color:T.ph}}>tap to select</span>}
              </div>
              {F.workpieceMats&&F.workpieceMats.length>1&&<div style={{fontSize:10,color:T.sub,marginTop:2}}>★ primary · others = secondary</div>}
            </div>}
            {isVis("coolant")&&<div style={{...C(3),opacity:isOpt("coolant")?0.55:1}}>
              <FL type="both" label="Coolant"/>
              <select style={sel(hi("coolant"))} value={F.coolant} onChange={e=>sf("coolant",e.target.value)}>
                {COOLANT_OPTS.map(([v,l])=><option key={v} value={v} style={{background:T.inputBg}}>{l}</option>)}
              </select>
            </div>}
          </div>

          {hasCut&&<GroupDiv label="Cutting Geometry"/>}
          <div style={G}>
            {isVis("flutes")&&<div style={{...C(3),opacity:isOpt("flutes")?0.55:1}}><FL type="both" label="# Flutes"/><input style={inp(hi("flutes"))} value={F.flutes} onChange={e=>sf("flutes",e.target.value)} placeholder="3"/></div>}
            {isVis("helixAngle")&&<div style={{...C(3),opacity:isOpt("helixAngle")?0.55:1}}><FL type="proshop" label="Helix Angle (°)"/><input style={inp(hi("helixAngle"))} value={F.helixAngle} onChange={e=>sf("helixAngle",e.target.value)} placeholder="30"/></div>}
            {isVis("fluteType")&&<div style={{...C(3),opacity:isOpt("fluteType")?0.55:1}}>
              <FL type="proshop" label="Flute Type"/>
              <select style={sel(hi("fluteType"))} value={FLUTE_TYPE_OPTS.includes(F.fluteType)?F.fluteType:""} onChange={e=>sf("fluteType",e.target.value)}>
                {FLUTE_TYPE_OPTS.map(o=><option key={o} value={o} style={{background:T.inputBg}}>{o||"—"}</option>)}
              </select>
              {F.fluteType&&!FLUTE_TYPE_OPTS.includes(F.fluteType)&&<div style={{fontSize:10,color:T.amber,marginTop:2}}>AI: "{F.fluteType}"</div>}
            </div>}
            {isVis("centerCutting")&&<div style={{...C(3),opacity:isOpt("centerCutting")?0.55:1}}>
              <FL type="proshop" label="Center Cutting"/>
              <div style={{height:27,display:"flex",alignItems:"center",border:`1px solid ${T.border}`,borderRadius:"0 0 4px 4px",padding:"0 7px",background:T.inputBg}}>
                <Toggle value={F.centerCutting} onChange={v=>sf("centerCutting",v)} label={F.centerCutting?"Y":"N"}/>
              </div>
            </div>}
            {isVis("stubJobber")&&<div style={{...C(3),opacity:isOpt("stubJobber")?0.55:1}}>
              <FL type="proshop" label="Length Class"/>
              <select style={sel(hi("stubJobber"))} value={F.stubJobber} onChange={e=>sf("stubJobber",e.target.value)}>
                {["","Stub","Jobber"].map(o=><option key={o} value={o} style={{background:T.inputBg}}>{o||"—"}</option>)}
              </select>
            </div>}
            {isVis("cuttingDirection")&&<div style={{...C(3),opacity:isOpt("cuttingDirection")?0.55:1}}>
              <FL type="proshop" label="Cutting Direction"/>
              <select style={sel(hi("cuttingDirection"))} value={F.cuttingDirection} onChange={e=>sf("cuttingDirection",e.target.value)}>
                {["Right Hand","Left Hand"].map(o=><option key={o} value={o} style={{background:T.inputBg}}>{o}</option>)}
              </select>
            </div>}
            {isVis("backsideCapable")&&<div style={{...C(3),opacity:isOpt("backsideCapable")?0.55:1}}>
              <FL type="proshop" label="Backside Capable"/>
              <div style={{height:27,display:"flex",alignItems:"center",border:`1px solid ${T.border}`,borderRadius:"0 0 4px 4px",padding:"0 7px",background:T.inputBg}}>
                <Toggle value={F.backsideCapable} onChange={v=>sf("backsideCapable",v)} label={F.backsideCapable?"Y":"N"}/>
              </div>
            </div>}
            {isVis("doubleEnded")&&<div style={{...C(3),opacity:isOpt("doubleEnded")?0.55:1}}>
              <FL type="proshop" label="Double Ended"/>
              <div style={{height:27,display:"flex",alignItems:"center",border:`1px solid ${T.border}`,borderRadius:"0 0 4px 4px",padding:"0 7px",background:T.inputBg}}>
                <Toggle value={F.doubleEnded} onChange={v=>sf("doubleEnded",v)} label={F.doubleEnded?"Y":"N"}/>
              </div>
            </div>}
          </div>

          {hasThread&&<GroupDiv label="Thread & Tap"/>}
          <div style={G}>
            {isVis("pitch")&&<div style={{...C(4),opacity:isOpt("pitch")?0.55:1}}><FL type="both" label="Pitch / Thread Size"/><input style={inp(hi("pitch"))} value={F.pitch} onChange={e=>sf("pitch",e.target.value)} placeholder="5/16-24"/></div>}
            {isVis("tapClass")&&<div style={{...C(4),opacity:isOpt("tapClass")?0.55:1}}><FL type="proshop" label="Tap Class (H# / D#)"/><input style={inp(hi("tapClass"))} value={F.tapClass} onChange={e=>sf("tapClass",e.target.value)} placeholder="H5"/></div>}
            {isVis("pointType")&&<div style={{...C(4),opacity:isOpt("pointType")?0.55:1}}>
              <FL type="proshop" label="Point Type"/>
              <select style={sel(hi("pointType"))} value={F.pointType} onChange={e=>sf("pointType",e.target.value)}>
                {["","Bottoming","Modified Bottoming","Plug","Taper","Spiral Point","Spiral Flute","Forming"].map(o=><option key={o} value={o} style={{background:T.inputBg}}>{o||"—"}</option>)}
              </select>
            </div>}
            {isVis("minThreadPitch")&&<div style={{...C(4),opacity:isOpt("minThreadPitch")?0.55:1}}><FL type="both" label="Min Thread Pitch (in)"/><input style={inp(hi("minThreadPitch"))} value={F.minThreadPitch} onChange={e=>sf("minThreadPitch",e.target.value)} placeholder="0.0313"/></div>}
            {isVis("maxThreadPitch")&&<div style={{...C(4),opacity:isOpt("maxThreadPitch")?0.55:1}}><FL type="both" label="Max Thread Pitch (in)"/><input style={inp(hi("maxThreadPitch"))} value={F.maxThreadPitch} onChange={e=>sf("maxThreadPitch",e.target.value)} placeholder="0.125"/></div>}
            {isVis("tpiMin")&&<div style={{...C(4),opacity:isOpt("tpiMin")?0.55:1}}><FL type="proshop" label="TPI Min"/><input style={inp(hi("tpiMin"))} value={F.tpiMin} onChange={e=>sf("tpiMin",e.target.value)} placeholder="10"/></div>}
            {isVis("tpiMax")&&<div style={{...C(4),opacity:isOpt("tpiMax")?0.55:1}}><FL type="proshop" label="TPI Max"/><input style={inp(hi("tpiMax"))} value={F.tpiMax} onChange={e=>sf("tpiMax",e.target.value)} placeholder="32"/></div>}
            {isVis("threadProfileAngle")&&<div style={{...C(4),opacity:isOpt("threadProfileAngle")?0.55:1}}><FL type="fusion" label="Thread Profile Angle (°)"/><input style={inp(hi("threadProfileAngle"))} value={F.threadProfileAngle} onChange={e=>sf("threadProfileAngle",e.target.value)} placeholder="60"/></div>}
            {isVis("fullProfile")&&<div style={{...C(4),opacity:isOpt("fullProfile")?0.55:1}}>
              <FL type="proshop" label="Full Profile"/>
              <div style={{height:27,display:"flex",alignItems:"center",border:`1px solid ${T.border}`,borderRadius:"0 0 4px 4px",padding:"0 7px",background:T.inputBg}}>
                <Toggle value={F.fullProfile} onChange={v=>sf("fullProfile",v)} label={F.fullProfile?"Y":"N"}/>
              </div>
            </div>}
          </div>

          {hasPurch&&<GroupDiv label="Purchasing & Identity"/>}
          <div style={G}>
            {isVis("edpNumber")&&<div style={{...C(4),opacity:isOpt("edpNumber")?0.55:1}}><FL type="both" label="EDP# / Mfr #"/><input style={inp(hi("edpNumber"))} value={F.edpNumber} onChange={e=>sf("edpNumber",e.target.value)} placeholder="e.g. VGM3-0025"/></div>}
            {isVis("approvedBrand")&&<div style={{...C(4),opacity:isOpt("approvedBrand")?0.55:1}}>
              <FL type="proshop" label="Manufacturer / Brand"/>
              <input style={inp(hi("approvedBrand"))} list="mfr-list" value={F.approvedBrand}
                onChange={e=>sf("approvedBrand",e.target.value)} placeholder="e.g. OSG, Helical Solutions"/>
              <datalist id="mfr-list">{MANUFACTURER_LIST.map(v=><option key={v} value={v}/>)}</datalist>
            </div>}
            {isVis("vendor")&&<div style={{...C(4),opacity:isOpt("vendor")?0.55:1}}>
              <FL type="proshop" label="Vendor / Distributor"/>
              <input style={inp(hi("vendor"))} list="vendor-list" value={F.vendor}
                onChange={e=>sf("vendor",e.target.value)} placeholder="e.g. MSC Industrial"/>
              <datalist id="vendor-list">{VENDOR_LIST.map(v=><option key={v} value={v}/>)}</datalist>
            </div>}
            {isVis("vendorStockNum")&&<div style={{...C(4),opacity:isOpt("vendorStockNum")?0.55:1}}><FL type="proshop" label="Vendor Stock #"/><input style={inp(hi("vendorStockNum"))} value={F.vendorStockNum} onChange={e=>sf("vendorStockNum",e.target.value)} placeholder="e.g. 48667943"/></div>}
            {isVis("cost")&&<div style={{...C(4),opacity:isOpt("cost")?0.55:1}}><FL type="proshop" label="Cost / Price ($)"/><input style={inp(hi("cost"))} value={F.cost} onChange={e=>sf("cost",e.target.value)} placeholder="48.99" type="number" step="0.01" min="0"/></div>}
            {isVis("productLink")&&<div style={{...C(4),opacity:isOpt("productLink")?0.55:1}}><FL type="fusion" label="Product Link"/><input style={inp(hi("productLink"))} value={F.productLink} onChange={e=>sf("productLink",e.target.value)} placeholder="https://..."/></div>}
          </div>

          {(isVis("presetName")||isVis("toolNumber")||isVis("psToolId")||isVis("location"))&&<GroupDiv label="Fusion Only"/>}
          <div style={G}>
            {isVis("presetName")&&<div style={{...C(3),opacity:isOpt("presetName")?0.55:1}}><FL type="fusion" label="Preset Name"/><input style={inp(false)} value={F.presetName} onChange={e=>sf("presetName",e.target.value)} placeholder="e.g. AL"/></div>}
            {isVis("toolNumber")&&<div style={{...C(3),opacity:isOpt("toolNumber")?0.55:1}}><FL type="fusion" label="Tool # / Pocket"/><input style={inp(false)} value={F.toolNumber} onChange={e=>sf("toolNumber",e.target.value)} placeholder="e.g. 10"/></div>}
            {isVis("psToolId")&&<div style={{...C(3),opacity:isOpt("psToolId")?0.55:1}}>
              <FL type="fusion" label="ProShop Tool # (→ productId)"/>
              <input style={inp(hi("psToolId"))} value={F.psToolId} onChange={e=>sf("psToolId",e.target.value)} placeholder="e.g. A-217"/>
              {F.psToolId&&(()=>{
                const prefix=psToolPrefix(F.psToolId);
                const mismatch=prefix&&effGroup&&prefix.toUpperCase()!==effGroup.toUpperCase();
                const url=buildAdionUrl(F.psToolId);
                return <>
                  {mismatch&&<div style={{fontSize:10,color:T.amber,marginTop:2}}>⚠ Prefix "{prefix}" ≠ group "{effGroup}" — will still export</div>}
                  {url&&<div style={{fontSize:9,color:T.sub,marginTop:2,wordBreak:"break-all"}}>{url}</div>}
                </>;
              })()}
            </div>}
            {isVis("location")&&<div style={{...C(3),opacity:isOpt("location")?0.55:1}}>
              <FL type="fusion" label="Location (→ vendor)"/>
              <input style={inp(hi("location"))} value={F.location} onChange={e=>sf("location",e.target.value)} placeholder="e.g. LC-140"/>
            </div>}
          </div>

          {/* AUTO */}
          <div style={{display:"flex",flexWrap:"wrap",gap:4,marginTop:10,paddingTop:8,borderTop:`1px solid ${T.border}`}}>
            <span style={{fontSize:10,color:T.sub,marginRight:2}}>Auto:</span>
            <Chip label="Through Coolant" value={THROUGH_COOLANT_VALUES.has(F.coolant)?"true":"false"} color={THROUGH_COOLANT_VALUES.has(F.coolant)?T.green:undefined}/>
            <Chip label="Round Shank" value={ROUND_SHANK_TYPES.has(F.toolType)?"true":"false"}/>
            <Chip label="Body Dia" value={F.shankDia||"—"}/>
            <Chip label="Brand rows" value={(!F.vendor||F.vendor===F.approvedBrand)?"1":"2"} color={F.vendor&&F.vendor!==F.approvedBrand?T.amber:undefined}/>
            {F.pitch&&<Chip label="TPI" value={calcTPI(F.pitch)||"—"}/>}
          </div>

          {/* EXPORT */}
          <div style={{display:"flex",gap:6,marginTop:12,paddingTop:10,borderTop:`1px solid ${T.border}`}}>
            <button onClick={handleCopyFusion} style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",gap:7,padding:"9px 0",background:BLUE,color:"#fff",border:"none",borderRadius:5,fontSize:13,fontWeight:600,cursor:"pointer"}}>
              <Icon.copy/> {fusLbl}
            </button>
            <button onClick={handleExportPS} style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",gap:7,padding:"9px 0",background:ORANGE,color:"#fff",border:"none",borderRadius:5,fontSize:13,fontWeight:600,cursor:"pointer"}}>
              <Icon.download/> {psLbl}
            </button>
          </div>
          {onExtract&&<button onClick={()=>onExtract({...F})} style={{width:"100%",marginTop:8,padding:"9px 0",background:"#45b36b",color:"#fff",border:"none",borderRadius:5,fontSize:13,fontWeight:600,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:7}}>
            ＋ Add to Library
          </button>}
        </div>
      </div>
      <textarea ref={taRef} readOnly defaultValue="" style={{position:"fixed",left:"-9999px",top:0,opacity:0,height:1}}/>
      <style>{`
        @keyframes spin{to{transform:rotate(360deg)}}
        *{box-sizing:border-box;}
        input::placeholder{color:${T.ph};font-size:11px;}
        textarea::placeholder{color:${T.ph};}
        select option{background:#242424;color:#e0e0e0;}
        input:focus,textarea:focus,select:focus{border-color:${BLUE}!important;outline:none;}
        input[type=number]::-webkit-inner-spin-button{opacity:0.3;}
        ::-webkit-scrollbar{width:5px;}
        ::-webkit-scrollbar-track{background:${T.pageBg};}
        ::-webkit-scrollbar-thumb{background:${T.border};border-radius:3px;}
      `}</style>
    </div>
  );
}
