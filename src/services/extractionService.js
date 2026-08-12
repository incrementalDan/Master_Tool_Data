// extractionService.js
//
// The ONE place a screenshot / PDF / pasted spec sheet becomes tool data.
// Shared by both extraction entry points so they can never drift:
//
//   • AddToolFlow (via tool-extractor.tsx)  → seeds a BRAND-NEW tool
//   • ExtractUpdateModal                    → proposals against an EXISTING tool
//
// ⚠️ `sanitizeExtraction` returns a SPARSE object — only the keys the model
// actually answered. That sparseness IS the update feature: `extractorToTool`
// fills every key with a default (`material: 'carbide'`, `cutting_direction:
// 'Right Hand'`, a regenerated description…), so diffing a converted extraction
// against a real tool would report every field the sheet never mentioned as a
// change, most of them proposing to blank real data. Only keys present here are
// eligible to become proposals.
//
// The ADD path keeps its original "clear what wasn't found" behaviour by
// spreading EXTRACT_RESET (the BLANK values for every extractable key) before
// the sparse result — see `applyExtractionToBlank`.
//
// ⚠️ UNITS: the model is instructed to convert everything to INCHES regardless
// of the source document (`sourceUnits` only records what the source used, for
// metric-aware naming). So every numeric value returned here is in inches and
// must be converted into the target record's own unit before it is compared or
// stored — see `extractedToToolFields` in src/schema/extractionDiff.js.

import { TT, MA, WM, BLANK, COOLANT_OPTS } from '../../tool-extractor.tsx';
import { FLUTE_DESIGN_OPTIONS } from '../schema/fieldRegistry.js';
import { getVendorNames, getManufacturerNames, resolveVendorName } from '../schema/vendorRegistry.js';

// Optional-chained so this module can be imported in plain Node (the round-trip
// audit pulls the schema barrel, which reaches tool-extractor.tsx).
export const EXTRACTOR_API_URL =
  import.meta.env?.VITE_EXTRACTOR_API_URL ||
  'https://tooldex-extractor.yinglingd.workers.dev';

// Every key the extraction can answer. Order is irrelevant; membership is what
// gates EXTRACT_RESET and the update-side proposal builder.
export const EXTRACTED_KEYS = [
  'toolType', 'diameter', 'loc', 'oal', 'flutes', 'shankDia', 'cornerRadius',
  'material', 'coating', 'workpieceMats', 'tipAngle', 'tipDiameter', 'helixAngle', 'pitch',
  'productLink', 'edpNumber', 'approvedBrand', 'vendor', 'vendorStockNum',
  'coolant', 'centerCutting', 'fluteType', 'fluteDesign', 'cost', 'tapClass', 'pointType',
  'shoulderLen', 'ooh', 'taperAngle', 'minThreadPitch', 'maxThreadPitch',
  'tapSubType', 'isSTI', 'tpiMin', 'tpiMax', 'threadProfileAngle',
  'fullProfile', 'stubJobber', 'backsideCapable', 'doubleEnded',
  'cuttingDirection',
];

// ⚠️ Both of these are derived LAZILY, not at module scope. This module and
// tool-extractor.tsx import each other (the extractor calls runExtraction; we
// need its vocabulary lists), and in an ES-module cycle a top-level `const` in
// the partially-initialised module is still in the temporal dead zone. Reading
// BLANK or COOLANT_OPTS at import time therefore throws; reading them inside a
// function — which only ever runs long after both modules have settled — is
// safe. Do not hoist these back to module scope.
let _extractReset = null;
// The "not found → clear it" values for the add path. Built from BLANK so it
// can't drift from the form's own empty state. `toolType` is excluded: an
// extraction that doesn't name a type must leave the user's current selection
// alone, not snap it back to "flat end mill".
function extractReset() {
  if (!_extractReset) {
    _extractReset = Object.fromEntries(
      EXTRACTED_KEYS.filter(k => k !== 'toolType').map(k => [k, BLANK[k]])
    );
  }
  return _extractReset;
}

let _validCoolants = null;
function validCoolants() {
  if (!_validCoolants) _validCoolants = new Set(COOLANT_OPTS.map(([v]) => v));
  return _validCoolants;
}

function buildVendorLists() {
  // Read at call time, not module load, so the prompt reflects the vendor
  // registry actually loaded from Drive rather than the bundled seed.
  return {
    vendors: getVendorNames().join(', '),
    manufacturers: getManufacturerNames().join(', '),
  };
}

export function buildExtractionPrompt() {
  const { vendors: VENDOR_LIST_STR, manufacturers: MANUFACTURER_LIST_STR } = buildVendorLists();
  return `You are a machining expert. Extract tool data from product pages, spec sheets, or text. Return ONLY valid JSON — no markdown, no extra text:
{"toolType":"flat end mill|ball end mill|bull nose end mill|tapered mill|radius mill|form mill|lollipop mill|slot/key cutter|dovetail|thread mill|face mill|chamfer mill|circle segment barrel|circle segment lens|circle segment oval|circle segment taper|drill|center drill|spot drill|reamer|counter bore|counter sink|tap|boring head|turning general","diameter":"cutting diameter decimal inches","loc":"flute/cutting length decimal inches","oal":"overall length decimal inches","flutes":"integer string","shankDia":"shank diameter decimal inches","cornerRadius":"0 for square, half-dia for ball, actual CR for bull nose","material":"carbide|hss|cobalt|ceramic","coating":"The coating name EXACTLY as the page states it (ZPLUS, Tuff-Coat, nACo, AlTiN...). This is an OPEN field — do NOT restrict to any list and do not translate a brand name into a generic one. Only exception: Uncoated/Bright/None → UC. Empty if not stated.","workpieceMats":"Array ISO codes N=Al,M=SS,P=Steel,S=HTA,K=CI primary first","tipAngle":"included angle degrees for drills/chamfers/spot — else empty","tipDiameter":"The flat/point diameter at the TIP, decimal inches — the small end, NOT the cutting diameter. Spec sheets label this many ways and often shorten it to just \\"Tip\\": Tip, Tip Dia, Point Dia, Point Diameter, Flat, Flat Dia, End Dia, d1, or an unlabelled second diameter column next to the main one. Applies to chamfer mills, spot drills, center drills, counter sinks, dovetails, thread mills and circle-segment taper tools. IMPORTANT: on a TAPERED MILL the sheet's \\"tip\\" IS the cutting diameter — put that in diameter and leave this empty. Empty if not stated.","helixAngle":"helix degrees if visible","pitch":"thread size x pitch (e.g. 1/4-20 or M6x1.0) for taps/thread mills — else empty","productLink":"url if visible","edpNumber":"Mfr# — NOT distributor stock#","approvedBrand":"manufacturer of the tool. Match to: ${MANUFACTURER_LIST_STR}. If the brand is not in the list but clearly a tool manufacturer, still return it exactly as shown on the page.","vendorStockNum":"distributor catalog#. Empty if not found.","vendor":"seller. Match: ${VENDOR_LIST_STR}. Empty if not confident.","coolant":"flood|disabled|mist|through tool|air|air through tool|suction|flood and mist|flood and through tool — default flood. If tool is described as through-coolant or through-spindle coolant, return \\"flood and through tool\\".","centerCutting":true,"fluteType":"Roughing|Semi-Finishing|Finishing|Yes|No or empty","fluteDesign":"None|Variable Index|Variable Flute|Variable Helix|Variable Pitch — a CLOSED list; pick the closest match. Manufacturers word this many ways, so map their wording onto ours: variable pitch / unequal spacing / unequal indexing -> Variable Pitch; variable index -> Variable Index; variable helix / variable lead / unequal helix -> Variable Helix; variable flute -> Variable Flute. Read the tool TITLE and description text, not just the spec table — this is usually stated there. CRITICAL — \"None\" and empty are DIFFERENT answers and must not be confused: return \"None\" ONLY when the page EXPLICITLY states the flutes are standard / uniform / equally spaced / evenly indexed. If the page simply does not mention flute geometry at all, return EMPTY. Empty means nobody has checked yet; \"None\" is a positive claim that the page made, and asserting it from silence destroys that distinction.","tapClass":"Tolerance class, e.g. H3/6H or D2-D6. Empty if not tap.","tapSubType":"cut|form — tap sub-type from description/markings. Empty if not tap.","isSTI":"true if the tap is an STI/Helicoil thread insert tap, else false. Only relevant for taps.","threadUnit":"inch|metric — infer from the thread designation format (M-prefix or mm pitch = metric). Empty if not tap or thread mill.","pointType":"Bottoming|Modified Bottoming|Plug|Taper|Spiral Point|Spiral Flute|Forming. Empty if not tap.","shoulderLen":"shoulder length >= LOC decimal inches. Empty if unsure.","ooh":"Leave empty — user sets manually.","cost":"The best actual purchase price for this specific tool. Follow these rules in order:
  1. HAAS TOOLS ONLY: Use the Winner's Circle price if shown — ignore all other prices.
  2. DISCOUNTED PRICE: If a sale price, your price, web price, or discounted price is shown alongside a list/regular price, use the discounted one.
  3. PACK PRICING: If the item is only sold in a multi-pack (e.g. pkg of 10, box of 5), use the total pack price — not the per-unit breakdown price.
  4. SINGLE-TOOL PRICE: If multiple different tools are listed on the same page (e.g. a size chart or related products), only use the price for the specific tool being described — not the cheapest one on the page.
  5. FALLBACK: If only one price is shown with no pack or discount context, use it.
  Return as a decimal string (e.g. \\"28.28\\"). Empty if no price found.","sourceUnits":"in|mm","taperAngle":"taper/lead angle degrees","minThreadPitch":"thread mill TPN decimal inches","maxThreadPitch":"thread mill TPX decimal inches","tpiMin":"thread mill minimum TPI (threads per inch) capability — integer string. Empty if not thread mill.","tpiMax":"thread mill maximum TPI capability — integer string. Empty if not thread mill.","threadProfileAngle":"thread mill thread profile included angle in degrees (e.g. 60 for unified, 55 for Whitworth). Empty if not thread mill or unknown.","fullProfile":false,"stubJobber":"Stub or Jobber if specified","backsideCapable":false,"doubleEnded":false,"cuttingDirection":"Right Hand or Left Hand","notes":"brief note"}
Rules: Convert metric to inches. Ball cornerRadius=dia/2. Drills tipAngle=full included angle (135 not 67.5). Return ONLY JSON.`;
}

// A model answer counts as "present" only when it carries information. An empty
// string / null / undefined means "not on the sheet" — which on the update side
// must never become a proposal to blank a real stored value.
const has = (v) => v !== undefined && v !== null && v !== '';

/**
 * Normalize a raw model payload into a SPARSE extractor-shaped object.
 * Validation rules are identical to the original inline extractor logic — a
 * value that fails validation is OMITTED rather than replaced with a default,
 * so the caller decides whether "absent" means "clear it" (add) or "leave it
 * alone" (update).
 *
 * @returns {{ fields: object, notes: string, sourceUnits: 'in'|'mm' }}
 */
export function sanitizeExtraction(p) {
  const f = {};
  const put = (k, v) => { f[k] = v; };

  if (TT.includes(p.toolType)) put('toolType', p.toolType);

  // Plain string passthroughs (always inches for the numeric ones).
  for (const k of [
    'diameter', 'loc', 'oal', 'flutes', 'shankDia', 'coating', 'tipAngle', 'tipDiameter',
    'helixAngle', 'pitch', 'productLink', 'edpNumber', 'vendorStockNum',
    'fluteType', 'cost', 'tapClass', 'pointType', 'shoulderLen', 'ooh',
    'taperAngle', 'minThreadPitch', 'maxThreadPitch', 'tpiMin', 'tpiMax',
    'threadProfileAngle', 'stubJobber',
  ]) {
    if (has(p[k])) put(k, p[k]);
  }

  // cornerRadius: `?? "0"` in the original — an explicit "" is meaningful
  // (square), so only a truly absent key falls through to the reset.
  if (p.cornerRadius !== undefined && p.cornerRadius !== null) put('cornerRadius', p.cornerRadius);

  if (MA.includes(p.material)) put('material', p.material);

  if (Array.isArray(p.workpieceMats)) {
    const mats = p.workpieceMats.filter(x => WM.includes(x));
    if (mats.length) put('workpieceMats', mats);
  } else if (WM.includes(p.workpieceMat) && p.workpieceMat) {
    put('workpieceMats', [p.workpieceMat]);
  }

  // Canonicalize alias → preferred name; unknown free text passes through for
  // the manufacturer, but a vendor must resolve to a known seller.
  if (has(p.approvedBrand)) {
    const brand = resolveVendorName(p.approvedBrand);
    if (has(brand)) put('approvedBrand', brand);
  }
  if (has(p.vendor)) {
    const v = resolveVendorName(p.vendor);
    if (getVendorNames().includes(v)) put('vendor', v);
  }

  if (has(p.coolant) && validCoolants().has(p.coolant)) {
    put('coolant', (p.coolant === 'through tool' || p.coolant === 'air through tool')
      ? 'flood and through tool'
      : p.coolant);
  }

  // Booleans are emitted ONLY when explicitly true. A `false` from the model is
  // indistinguishable from "didn't look", and an update must never turn a real
  // capability flag off on that basis.
  for (const k of ['centerCutting', 'isSTI', 'fullProfile', 'backsideCapable', 'doubleEnded']) {
    if (p[k] === true) put(k, true);
  }

  // Flute design is a CLOSED list (the shop's one vocabulary for a geometry
  // manufacturers name a dozen ways). Match case/space-insensitively so a model
  // answer of "variable pitch" lands on "Variable Pitch"; anything unrecognised
  // is dropped rather than inventing a new option.
  if (has(p.fluteDesign)) {
    const want = String(p.fluteDesign).trim().toLowerCase().replace(/\s+/g, ' ');
    const hit = FLUTE_DESIGN_OPTIONS.find(o => o.toLowerCase() === want);
    if (hit) put('fluteDesign', hit);
  }

  if (p.tapSubType === 'cut' || p.tapSubType === 'form') put('tapSubType', p.tapSubType);
  if (p.cuttingDirection === 'Right Hand' || p.cuttingDirection === 'Left Hand') {
    put('cuttingDirection', p.cuttingDirection);
  }

  return {
    fields: f,
    notes: typeof p.notes === 'string' ? p.notes : '',
    sourceUnits: p.sourceUnits === 'mm' ? 'mm' : 'in',
  };
}

/**
 * Merge a sparse extraction onto the extractor's own BLANK-shaped form state,
 * reproducing the original "clear anything the sheet didn't mention" behaviour
 * of the add flow. `prev.toolType` is preserved when no type was extracted.
 */
export function applyExtractionToBlank(prev, fields) {
  return { ...prev, ...extractReset(), ...fields };
}

/**
 * Call the extraction API.
 *
 * @param {{kind:'image'|'pdf'|'text', data:string, mediaType?:string}} input
 *        `data` is base64 for image/pdf, raw text for text.
 * @returns {Promise<{fields:object, notes:string, sourceUnits:'in'|'mm'}>}
 */
export async function runExtraction({ kind, data, mediaType = 'image/png' }) {
  let messages;
  if (kind === 'image') {
    messages = [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data } },
        { type: 'text', text: 'Extract all tool data including price/cost if shown anywhere on this product page.' },
      ],
    }];
  } else if (kind === 'pdf') {
    messages = [{
      role: 'user',
      content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } },
        { type: 'text', text: 'Extract all tool data including price/cost if shown anywhere.' },
      ],
    }];
  } else {
    messages = [{ role: 'user', content: 'Extract tool data including price/cost:\n\n' + data }];
  }

  const res = await fetch(EXTRACTOR_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: 2048,
      system: buildExtractionPrompt(),
      messages,
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`API ${res.status}: ${t.slice(0, 200)}`);
  }
  const d = await res.json();
  const text = (d.content || []).map(b => b.text || '').join('').replace(/```json|```/g, '').trim();
  return sanitizeExtraction(JSON.parse(text));
}
