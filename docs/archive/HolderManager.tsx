import { useState, useMemo, useRef, useEffect } from "react";

/* ═══════════════════════════════════════════════════════════════════════════
   HOLDER MANAGEMENT — UI/UX mockup for Claude Code integration

   Replaces the read-only Fusion holder library with an APP-OWNED holder
   database: real UUID keys, structured fields, purchasing, extensions.

   THE CORE INSIGHT, verified against the real Master-Holder.json:
     NBT30-SK13C-60                    gauge 54.999mm,  9 segments
     NBT30-SK13C-60 w/ ER8 EXT 1.2OOH  gauge 85.479mm, 10 segments
     difference = 30.48mm = EXACTLY 1.2 inches = the "1.2OOH" in the name.
   The extension is ONE ADDED SEGMENT at the tip. So: add an "Extension"
   checkbox to the segment table (next to Fusion's "Above Gauge Line"), sum
   the flagged segments, and that sum IS the extension OOH — DERIVED, never
   typed. It then feeds the description. See SegmentTable + deriveExtensionOoh.

   ⚠️ TWO DIFFERENT THINGS BOTH CALLED "OOH" — never conflate:
     - extension OOH (here)  = property of the holder+extension. Fixed.
                               Communicates HOW TO SET THE EXTENSION UP.
     - assembly OOH (LB)     = the CUTTING TOOL's stickout. Per-assembly.

   ⚠️ CASCADE RISK — holder descriptions are load-bearing. holderShortName()
   parses them → feeds preset names + asm_number → presetMatchesAssembly
   links presets to assemblies by parsing that back out. A silent description
   rewrite can ORPHAN PRESETS. Auto-suggestion here is a UI affordance the
   user accepts, never an automatic rewrite. See the nameManual pattern.

   Claude Code: this is a DESIGN REFERENCE, not drop-in code. Inline styles
   and local state so it runs standalone. Map tokens to the app's CSS vars,
   reuse existing utils (sumGaugeSegments, computeGaugeLength,
   buildGaugeLengthExpression, holderShortName, the purchasing shape).
   ═══════════════════════════════════════════════════════════════════════ */

const T = {
  page: "#0d0d0f", surface: "#17171a", surface2: "#1e1e22", raise: "#28282e",
  inputBg: "#121215", border: "#303036", borderSoft: "#26262b",
  text: "#e4e4e6", muted: "#8b8b93", veryMuted: "#4a4a52",
  blue: "#3d7fe6", blueD: "#141d2a", blueB: "#253a5e",
  teal: "#2bb3a3", tealD: "#062220", tealB: "#124440",
  /* EXTENSION — semantic, not decorative. Everything that refers to an
     extension uses these and nothing else: the profile shape, the segment
     row, the Extension column + section, the derived OOH/shank readouts,
     the filter pill, the healer chip. Previously it was teal in the table
     and orange in the profile, which read as unrelated features.

     extD/extB are the SAME hex with alpha, not separately-picked dark
     greens. A hand-picked dark green measured the same hue but read as a
     different colour because it was too low-chroma; deriving by alpha
     makes the tint provably the same green, just quieter. Change `ext`
     and the other two follow. */
  ext: "#43c463", extD: "#43c46333", extB: "#43c46377",
  amber: "#c98a28", amberD: "#1e1208", amberB: "#3e2808",
  red: "#e05252", redD: "#1e0a0a", redB: "#3e1414",
  violet: "#9b87e6", violetD: "#1c1730", violetB: "#3a2e5e",
  green: "#4ca94c", greenD: "#0c1e0c", greenB: "#1e3e1e",
  mono: "'JetBrains Mono','Fira Mono',monospace",
  sans: "'Space Grotesk',system-ui,sans-serif",
};

const MM_PER_IN = 25.4;
/* Two independent unit concepts in this file:
   1. mm↔in MATH — always the same conversion factor.
   2. The HOLDER's own unit — a per-record toggle, independent of anything
      else the app does. A holder can be drawn in mm or in, and switching it
      REWRITES the stored segment numbers (not just their label), so typing a
      correction later can be done in whichever unit the source spec used.
   asInches / asMm read a value that's already in the holder's CURRENT unit
   and convert only when needed — never assume mm. The old toIn() below did
   assume mm; every call site was updated to asInches(value, holder.unit). */
const asInches = (v, unit) => (unit === "mm" ? v / MM_PER_IN : v);
const asMm = (v, unit) => (unit === "mm" ? v : v * MM_PER_IN);

// The ONE place the display-precision rule lives: metric shows 3 decimals,
// inch shows 4. Every readout in this file routes through this — no ad hoc
// toFixed calls, so the rule can't drift out of sync between spots again.
const formatLen = (v, unit) => v == null ? null : v.toFixed(unit === "mm" ? 3 : 4);

// Converts every length-bearing field on a holder to a new unit. Rounds to
// 5 decimals — Claude Code: this precision matters, don't shorten it. A
// single mm→in→mm round trip at 4 decimals of inch precision loses real
// mm-level resolution (e.g. 2mm → 0.0787in → 1.999mm, not 2.000mm) because
// 0.0001" (4 decimals) is coarser than 0.001mm. 5 decimals of inch
// resolution (0.00001" ≈ 0.000254mm) comfortably survives a round trip
// back to 3-decimal mm display. Verified against real data (2.309mm and
// 2mm both round-trip clean at 5 decimals, drift at 4).
function convertHolderUnits(h, toUnit) {
  if (h.unit === toUnit) return h;
  const conv = (v) => v == null ? v : +(h.unit === "mm"
    ? (toUnit === "in" ? v / MM_PER_IN : v)
    : (toUnit === "mm" ? v * MM_PER_IN : v)
  ).toFixed(5);
  return {
    ...h,
    unit: toUnit,
    segments: h.segments.map(s => ({ ...s, h: conv(s.h), ud: conv(s.ud), ld: conv(s.ld) })),
  };
}

/* ═══ SHARED OPTION LOOKUPS — the bin_sizes pattern ═════════════════════════
   Each option is a stable UUID + label. Holder records store the UUID, NOT
   the text. Rename a label once → every holder referencing it updates.
   "Add custom" appends here and becomes a real option everywhere.
   Claude Code: these live in shop_settings alongside bin_sizes, using the
   SAME machinery. Don't build a parallel system. ═══════════════════════ */
/* ═══ COLOR SYSTEM ═══════════════════════════════════════════════════════════
   Two INDEPENDENT color concepts, deliberately kept from competing for the
   same surface — that's the whole answer to "how do we not make them clash":

   1. HOLDER color — one per holder record, fully custom (color picker).
      Shows as a left-border accent + dot on the holder's pill. NEVER tints
      the pill's background — the background stays one consistent neutral
      surface for every holder, everywhere. This mirrors a pattern already
      in this app: CamPresetPicker's material cards use a colored
      `borderLeftColor`, not a tinted fill, for exactly this reason.

   2. COLLET SIZE color — one per shared collet-size OPTION (not per
      holder), also custom. Shows as inline TEXT color for the matching
      substring inside a holder's description ("SK13" in "NBT30-SK13C-60").

   Because #1 never touches the background and #2 only tints a slice of
   text sitting on that same neutral background, the two never fight for
   contrast against each other — a vivid collet color reads fine regardless
   of which holder color happens to be active, since the surface behind it
   never changes.

   Claude Code: THEME_COLORS below is a starting default set — it should
   pull from the app's REAL existing color theme/design tokens (Dan
   confirmed one already exists) rather than this placeholder list. The
   picker also needs a true custom option (native <input type="color"> is
   the mockup's stand-in; use whatever color-input the app already has).
   ═══════════════════════════════════════════════════════════════════════ */
const THEME_COLORS = [
  { id: "blue", hex: "#3d7fe6" }, { id: "teal", hex: "#2bb3a3" },
  { id: "violet", hex: "#9b87e6" }, { id: "amber", hex: "#c98a28" },
  { id: "red", hex: "#e05252" }, { id: "green", hex: "#4ca94c" },
  { id: "pink", hex: "#d9679c" }, { id: "cyan", hex: "#4fb8d9" },
  { id: "orange", hex: "#d97a2b" }, { id: "lime", hex: "#9bc93e" },
];
const DEFAULT_HOLDER_COLOR = "#5a5a63"; // neutral gray until the user picks one
const DEFAULT_COLLET_COLOR = "#8b8b93"; // same — collet text is plain muted until assigned

const OPT = {
  type: [
    { id: "ty-collet", label: "Collet" },
    { id: "ty-shrink", label: "Shrink Fit" },
    { id: "ty-sidelock", label: "End Mill / Side Lock" },
    { id: "ty-hydraulic", label: "Hydraulic" },
    { id: "ty-drillchuck", label: "Drill Chuck" },
    { id: "ty-shellmill", label: "Shell Mill" },
    { id: "ty-boring", label: "Boring Head" },
  ],
  taper: [
    // Dual-contact is a SEPARATE taper option, not a modifier flag —
    // deliberately redundant because it's simpler than a modifier.
    { id: "tp-bt30", label: "BT30" },
    { id: "tp-bt30dc", label: "BT30 Dual Contact", dc: true },
    { id: "tp-nbt30", label: "NBT30", dc: true, nikken: true },
    { id: "tp-bbt30", label: "BBT30", dc: true },
    { id: "tp-cat40", label: "CAT40" },
    { id: "tp-cat40dc", label: "CAT40 Dual Contact", dc: true },
    { id: "tp-bt40", label: "BT40" },
    { id: "tp-hsk63a", label: "HSK-63A" },
    { id: "tp-hsk40e", label: "HSK-40E" },
  ],
  colletFamily: [
    { id: "cf-sk", label: "SK" },
    { id: "cf-er", label: "ER" },
    { id: "cf-tg", label: "TG" },
  ],
  colletSize: [
    { id: "cs-sk10", label: "SK10", family: "cf-sk", color: "#3d7fe6" },
    { id: "cs-sk13", label: "SK13", family: "cf-sk", color: "#2bb3a3" },
    { id: "cs-sk16", label: "SK16", family: "cf-sk", color: "#9b87e6" },
    { id: "cs-sk20", label: "SK20", family: "cf-sk", color: "#c98a28" },
    { id: "cs-er8", label: "ER8", family: "cf-er", color: "#4fb8d9" },
    { id: "cs-er11", label: "ER11", family: "cf-er", color: "#d9679c" },
    { id: "cs-er16", label: "ER16", family: "cf-er", color: "#9bc93e" },
    { id: "cs-er20", label: "ER20", family: "cf-er", color: "#d97a2b" },
    { id: "cs-er25", label: "ER25", family: "cf-er", color: "#e05252" },
    { id: "cs-er32", label: "ER32", family: "cf-er", color: "#4ca94c" },
    { id: "cs-er40", label: "ER40", family: "cf-er", color: "#3d7fe6" },
    { id: "cs-er50", label: "ER50", family: "cf-er", color: "#9b87e6" },
  ],
};
const optLabel = (list, id) => OPT[list].find(o => o.id === id)?.label || null;
const optById = (list, id) => OPT[list].find(o => o.id === id);

/* ═══ SEED DATA — real records from Master-Holder.json ═════════════════════
   `ext` flags on segments are what this project ADDS. Verified: the ER8 EXT
   holder's tip segment is 30.48mm = 1.2in, matching its description. ═══ */
const SEED = [
  {
    id: "h-001", description: "NBT30-SK13C-60", unit: "mm", color: "#3d7fe6",
    type: "ty-collet", taper: "tp-nbt30", colletFamily: "cf-sk", colletSize: "cs-sk13",
    length: 60, tapCollet: false, hasExtension: false,
    vendor: "SK13", productId: "", productLink: "", location: "Cabinet A - Drawer 2",
    mfg: "Nikken", partNo: "", notes: "",
    segments: [
      { h: 35, ud: 33, ld: 33 }, { h: 1, ud: 46, ld: 44 }, { h: 3.4, ud: 46, ld: 46 },
      { h: 2.309, ud: 38, ld: 46 }, { h: 3.381, ud: 38, ld: 38 }, { h: 2.309, ud: 46, ld: 38 },
      { h: 6.6, ud: 46, ld: 46 }, { h: 1, ud: 44, ld: 46 }, { h: 2, ud: 31.75, ld: 31.75, agl: true },
    ],
  },
  {
    id: "h-002", description: "NBT30-SK13C-60 w/ ER8 EXT 1.2OOH", unit: "mm", color: "#c98a28",
    type: "ty-collet", taper: "tp-nbt30", colletFamily: "cf-sk", colletSize: "cs-sk13",
    length: 60, tapCollet: false, hasExtension: true,
    extColletSize: "cs-er8", extMfg: "Maritool", extPartNo: "ER8-EXT-1.2", extVendor: "Maritool",
    vendor: "SK13-ER8", productId: "", productLink: "", location: "Cabinet A - Drawer 2",
    mfg: "Nikken", partNo: "", notes: "",
    segments: [
      // ext:true = counts toward OOH. shankSeg:true = THIS diameter is the
      // mating shank — only one candidate here, so it's the obvious pick.
      { h: 30.48, ud: 12, ld: 12, ext: true, shankSeg: true },
      { h: 35, ud: 33, ld: 33 }, { h: 1, ud: 46, ld: 44 }, { h: 3.4, ud: 46, ld: 46 },
      { h: 2.309, ud: 38, ld: 46 }, { h: 3.381, ud: 38, ld: 38 }, { h: 2.309, ud: 46, ld: 38 },
      { h: 6.6, ud: 46, ld: 46 }, { h: 1, ud: 44, ld: 46 }, { h: 2, ud: 31.75, ld: 31.75, agl: true },
    ],
  },
  {
    id: "h-003", description: "NBT30-SK20C-90 ER16 EX OOH 2.2 Shank .75", unit: "mm", color: "#e05252",
    type: "ty-collet", taper: "tp-nbt30", colletFamily: "cf-sk", colletSize: "cs-sk20",
    length: 90, tapCollet: false, hasExtension: true,
    extColletSize: "cs-er16", extMfg: "Maritool", extPartNo: "", extVendor: "Maritool",
    vendor: "SK20-ER16", productId: "", productLink: "", location: "",
    mfg: "Nikken", partNo: "", notes: "",
    segments: [
      // Two ext segments — a stepped extension body. 19.05mm is flagged as
      // the shank because 19.05 / 25.4 = EXACTLY 0.75, matching this
      // holder's real "Shank .75". The 22.225mm segment is the collar/head
      // above it — same collet family, wrong dimension to be "the shank".
      { h: 17.78, ud: 22.225, ld: 22.225, ext: true },
      { h: 38.1, ud: 19.05, ld: 19.05, ext: true, shankSeg: true },
      { h: 64, ud: 46, ld: 46 }, { h: 1, ud: 44, ld: 46 }, { h: 3.4, ud: 46, ld: 46 },
      { h: 2.309, ud: 46, ld: 38 }, { h: 3.381, ud: 38, ld: 38 }, { h: 2.309, ud: 38, ld: 46 },
      { h: 6.6, ud: 46, ld: 46 }, { h: 1, ud: 46, ld: 44 }, { h: 2, ud: 31.75, ld: 31.75, agl: true },
    ],
  },
  {
    id: "h-004", description: "NBT30-SK13C-120", unit: "mm", color: "#3d7fe6",
    type: "ty-collet", taper: "tp-nbt30", colletFamily: "cf-sk", colletSize: "cs-sk13",
    length: 120, tapCollet: false, hasExtension: false,
    vendor: "SK13", productId: "", productLink: "", location: "Cabinet A - Drawer 3",
    mfg: "Nikken", partNo: "", notes: "",
    segments: [
      { h: 95, ud: 33, ld: 33 }, { h: 1, ud: 46, ld: 44 }, { h: 3.4, ud: 46, ld: 46 },
      { h: 6.6, ud: 46, ld: 46 }, { h: 2, ud: 31.75, ld: 31.75, agl: true },
    ],
  },
  {
    id: "h-005", description: "NBT30SK13-90 -ER16 TAP C EX2.33OOH", unit: "mm", color: "#9b87e6",
    type: "ty-collet", taper: "tp-nbt30", colletFamily: "cf-sk", colletSize: "cs-sk13",
    length: 90, tapCollet: true, hasExtension: true,
    extColletSize: "cs-er16", extMfg: "Maritool", extPartNo: "TAP COLLET EXT", extVendor: "Maritool",
    vendor: "SK13-ER16", productId: "", productLink: "", location: "",
    mfg: "Nikken", partNo: "", notes: "Tap collet — floating holder",
    segments: [
      { h: 59.182, ud: 20, ld: 20, ext: true, shankSeg: true },
      { h: 65, ud: 33, ld: 33 }, { h: 1, ud: 46, ld: 44 }, { h: 6.6, ud: 46, ld: 46 },
      { h: 2, ud: 31.75, ld: 31.75, agl: true },
    ],
  },
  {
    id: "h-006", description: "DRILL CHUCK - BT30", unit: "mm", color: "#4ca94c",
    type: "ty-drillchuck", taper: "tp-bt30dc", colletFamily: null, colletSize: null,
    length: null, tapCollet: false, hasExtension: false,
    vendor: "Maritool", productId: "BT30-APU13D",
    productLink: "https://www.maritool.com/...", location: "",
    mfg: "Maritool", partNo: "BT30-APU13D", notes: "",
    segments: [
      { h: 80, ud: 42, ld: 42 }, { h: 6.6, ud: 46, ld: 46 },
      { h: 2, ud: 31.75, ld: 31.75, agl: true },
    ],
  },
  {
    id: "h-007", description: "NBT30 Holder for hass 2.5\" shell mill", unit: "mm",
    type: "ty-shellmill", taper: "tp-nbt30", colletFamily: null, colletSize: null,
    length: null, tapCollet: false, hasExtension: false,
    vendor: "", productId: "", productLink: "", location: "",
    mfg: "", partNo: "", notes: "",
    segments: [
      { h: 50, ud: 60, ld: 60 }, { h: 6.6, ud: 46, ld: 46 },
      { h: 2, ud: 31.75, ld: 31.75, agl: true },
    ],
  },
];

// Fake "used by N tools" counts for the mockup
const USAGE = { "h-001": 14, "h-002": 6, "h-003": 3, "h-004": 9, "h-005": 2, "h-006": 1, "h-007": 1 };

/* ═══ DERIVED GEOMETRY ══════════════════════════════════════════════════════
   Claude Code: DO NOT reimplement. The app already has sumGaugeSegments /
   computeGaugeLength / buildGaugeLengthExpression which handle the real
   bottom-first array order (jsonIndex = S − fusionNumber) and the
   above-gauge-line exclusion. These are simplified stand-ins so the mockup
   runs; call the real utils. ═══════════════════════════════════════════ */

// Gauge length = sum of every segment NOT above the gauge line.
function deriveGaugeLength(segments) {
  return segments.filter(s => !s.agl).reduce((a, s) => a + (Number(s.h) || 0), 0);
}
// Extension OOH = sum of segments flagged as extension. THE NEW IDEA.
// Derived only — never directly editable. Verified against real data:
// the ER8-EXT holder's single ext segment is 30.48mm = exactly 1.2in.
function deriveExtensionOoh(segments) {
  const ext = segments.filter(s => s.ext);
  if (!ext.length) return null;
  return ext.reduce((a, s) => a + (Number(s.h) || 0), 0);
}
// Extension SHANK diameter — the diameter of the ONE segment marked as the
// extension's mating body (`shankSeg`), not the whole extension. Same
// collet, different shank diameter, so it fits different BT/NBT holders.
// Verified against real data: the SK20/ER16-EXT holder has TWO ext segments
// (Ø22.225 and Ø19.05) — only 19.05mm is flagged shankSeg, and 19.05/25.4
// = exactly 0.75, matching that holder's real description ("Shank .75").
// The other segment is the collar/head, not the shank.
function deriveExtensionShankDia(segments) {
  const s = segments.find(x => x.ext && x.shankSeg);
  if (!s) return null;
  return (Number(s.ud) + Number(s.ld)) / 2;
}

/* ═══ DESCRIPTION AUTO-SUGGEST ══════════════════════════════════════════════
   Composed from the structured fields. SUGGESTION ONLY — Fusion has a
   character limit and the shop hand-shortens regularly (especially with
   extensions). Uses the same nameManual + ↺ Auto protection pattern already
   built for preset names. Never auto-rewrites an existing description.
   Targets from real data:
     NBT30-SK13C-60
     NBT30-SK13C-60 w/ ER8 EXT 1.2OOH
     NBT30-SK20C-90 ER16 EX OOH 2.2 Shank .75
     NBT30SK13-90 -ER16 TAP C EX2.33OOH
   ═══════════════════════════════════════════════════════════════════════ */
const FUSION_DESC_LIMIT = 64; // ⚠️ Claude Code: find the REAL limit, don't guess

function composeDescription(h) {
  const taper = optLabel("taper", h.taper);
  const collet = optLabel("colletSize", h.colletSize);
  const bits = [];
  let head = taper || "";
  if (collet) head += `-${collet}C`;
  if (h.length) head += `-${h.length}`;
  if (head) bits.push(head);
  if (h.hasExtension) {
    const ec = optLabel("colletSize", h.extColletSize);
    const ooh = deriveExtensionOoh(h.segments);
    // The printed OOH is always inches — real descriptions ("1.2OOH",
    // "OOH 2.2") use inches even on mm-native holders. asInches() converts
    // only if the segments are currently mm; if the holder is already in
    // inches this is a no-op.
    const oohIn = ooh != null ? +asInches(ooh, h.unit).toFixed(3) : null;
    let e = "w/";
    if (ec) e += ` ${ec}`;
    if (h.tapCollet) e += " TAP C";
    e += " EXT";
    if (oohIn != null) e += ` ${oohIn}OOH`;
    bits.push(e);
  } else if (h.tapCollet) {
    bits.push("TAP C");
  }
  // Shank prints in the HOLDER'S OWN current unit — deliberately different
  // from OOH above. Dan's rule: "if it's 12mm that's what I want in the
  // description," not force-converted to inches. Metric gets an explicit
  // "mm" suffix to disambiguate; inches matches the real convention (no
  // suffix, no leading zero — "Shank .75", not "Shank 0.75").
  const shankDia = deriveExtensionShankDia(h.segments);
  if (h.hasExtension && shankDia != null) {
    // Round-trip through Number to strip trailing zeros — formatLen's fixed
    // decimals are right for the table (alignment) but wrong here: "12mm"
    // is what Dan wants, not "12.000mm". Same trick oohIn already uses.
    const shown = +formatLen(shankDia, h.unit);
    bits.push(h.unit === "mm" ? `Shank ${shown}mm` : `Shank ${String(shown).replace(/^0/, "")}`);
  }
  return bits.join(" ");
}

/* ═══ THE HOLDER HEALER ═════════════════════════════════════════════════════
   Parses legacy free-text descriptions into structured fields on import /
   normalize. The real names are regular enough that ~99% resolve cleanly;
   the rest get FLAGGED rather than guessed.

   Claude Code: this is the migration path off free text. Present it as a
   preview→commit normalize action (the established pattern — same as
   normalizeLibrary / NormalizeModal). NEVER auto-apply silently: writing a
   parsed description back can cascade into preset names and orphan presets
   (see the cascade warning at the top of this file).
   ═══════════════════════════════════════════════════════════════════════ */
function healDescription(desc) {
  const out = { matched: {}, confidence: "high", flags: [] };
  const d = desc || "";
  const U = d.toUpperCase();

  // Taper — longest first so BBT30 beats BT30, NBT30 beats BT30
  const taperPat = [
    ["BBT30", "tp-bbt30"], ["NBT30", "tp-nbt30"], ["CAT40", "tp-cat40"],
    ["BT40", "tp-bt40"], ["BT30", "tp-bt30"], ["HSK63A", "tp-hsk63a"],
  ];
  for (const [pat, id] of taperPat) {
    if (U.includes(pat)) { out.matched.taper = id; break; }
  }
  if (!out.matched.taper) { out.confidence = "low"; out.flags.push("No taper recognized"); }

  // "DC" / "Dual Contact" as a standalone marker on a plain BT taper
  if (out.matched.taper === "tp-bt30" && /\bDC\b|DUAL\s*CONTACT/.test(U)) {
    out.matched.taper = "tp-bt30dc";
  }

  // Collet — SK<n> or ER<n>, optional trailing C
  const sk = U.match(/\bSK\s*(\d{1,2})C?\b/);
  if (sk) {
    out.matched.colletFamily = "cf-sk";
    out.matched.colletSize = `cs-sk${sk[1]}`;
    out.matched.type = "ty-collet";
  }

  // Extension collet — an ER token, usually alongside EX/EXT/EXTENSION
  const er = U.match(/\bER\s*(\d{1,2})\b/);
  const hasExtWord = /\bEX(T|TENSION)?\b|\bEX\d/.test(U);
  if (er && (hasExtWord || sk)) {
    out.matched.hasExtension = true;
    out.matched.extColletSize = `cs-er${er[1]}`;
    if (!sk) { out.matched.colletFamily = "cf-er"; out.matched.colletSize = `cs-er${er[1]}`; out.matched.type = "ty-collet"; }
  }

  // Holder length — the number right after the collet token
  const len = U.match(/SK\s*\d{1,2}C?\s*-?\s*(\d{2,3})\b/);
  if (len) out.matched.length = parseInt(len[1], 10);

  // Extension OOH — a number adjacent to "OOH" in any of the many orders seen:
  // "OOH1.22" | "OOH 2.2" | "EXT 2.5 OOH" | "EX2.33OOH" | "1.2OOH"
  const ooh = U.match(/OOH\s*([\d.]+)/) || U.match(/([\d.]+)\s*OOH/) || U.match(/EX\s*([\d.]+)\s*OOH/);
  if (ooh) {
    out.matched.extOohIn = parseFloat(ooh[1]);
    out.matched.hasExtension = true;
  }
  if (out.matched.hasExtension && out.matched.extOohIn == null) {
    out.confidence = out.confidence === "high" ? "medium" : out.confidence;
    out.flags.push("Extension found but no OOH — flag extension segments manually");
  }

  // Tap collet
  if (/\bTAP\b/.test(U)) out.matched.tapCollet = true;

  // Shank — this can only be a HINT now, not a committable field. Shank
  // diameter comes from marking a segment (shankSeg), which text parsing
  // can't do reliably (which of possibly several ext segments is it?).
  // Surface the number as a pointer for the human, not an auto-fill.
  const shank = U.match(/SHANK\s*\.?([\d.]+)/);
  const mmShank = U.match(/\b(\d{1,2})MM\b/);
  if (shank) {
    out.flags.push(`Name mentions "Shank ${shank[0].replace(/SHANK\s*/i, "")}" — mark the matching segment as the shank`);
  } else if (mmShank) {
    out.flags.push(`Name mentions "${mmShank[0]}" — may be a shank dimension, mark the matching segment`);
  }

  // Non-collet types by keyword
  if (/DRILL\s*CHUCK/.test(U)) { out.matched.type = "ty-drillchuck"; delete out.matched.colletSize; }
  if (/SHELL\s*MILL|FACE\s*MILL/.test(U)) { out.matched.type = "ty-shellmill"; delete out.matched.colletSize; }
  if (/BORING|EWN/.test(U)) { out.matched.type = "ty-boring"; delete out.matched.colletSize; }

  if (!out.matched.type) { out.confidence = "low"; out.flags.push("No holder type recognized"); }
  // Free-text prose = a hand-written name, not a spec string
  if (/HOLDER FOR|FOR\s+\w+\s+\d/.test(U)) {
    out.confidence = "low";
    out.flags.push("Descriptive prose — needs manual classification");
  }
  return out;
}

// ── shared bits ────────────────────────────────────────────────────────────
const inputStyle = {
  background: T.inputBg, border: `1px solid ${T.border}`, borderRadius: "6px",
  padding: "7px 9px", color: T.text, fontSize: "13px", width: "100%",
  boxSizing: "border-box", outline: "none", fontFamily: T.sans,
};

function Section({ label, color = T.blue, right, children, style }) {
  return (
    <div style={{
      background: T.surface2, border: `1px solid ${T.border}`,
      borderRadius: "10px", padding: "14px 16px", ...style,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
        <span style={{ fontSize: "12.5px", fontWeight: 800, letterSpacing: "0.09em", textTransform: "uppercase", color }}>{label}</span>
        <div style={{ flex: 1, height: "1px", background: T.borderSoft }} />
        {right}
      </div>
      {children}
    </div>
  );
}

function Field({ label, children, hint }) {
  return (
    <div>
      <div style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: T.muted, marginBottom: "5px" }}>{label}</div>
      {children}
      {hint && <div style={{ fontSize: "9.5px", color: T.veryMuted, marginTop: "3px" }}>{hint}</div>}
    </div>
  );
}

// A boolean field as a pill toggle — filled dot + color when on, matches
// the Pill visual language already used for filters/badges elsewhere in
// this file, but click-driven (no checkbox) since it IS the control.
function BoolPill({ label, active, onChange, color = T.blue, bg, bd }) {
  return (
    <button
      onClick={() => onChange(!active)}
      style={{
        display: "flex", alignItems: "center", gap: "7px",
        padding: "7px 14px", borderRadius: "20px", cursor: "pointer", fontFamily: T.sans,
        border: `1.5px solid ${active ? (bd || color) : T.border}`,
        background: active ? (bg || color + "22") : "transparent",
        color: active ? color : T.muted, fontSize: "12.5px", fontWeight: 700,
        transition: "all 0.14s",
      }}
    >
      <span style={{
        width: "8px", height: "8px", borderRadius: "50%",
        background: active ? color : T.veryMuted, flexShrink: 0, transition: "background 0.14s",
      }} />
      {label}
    </button>
  );
}

// Swatch row (from THEME_COLORS) + a native custom picker for going beyond
// the default set. Reused for both holder color and collet-size color —
// same control, different data source, so the two color systems always
// feel like one coherent feature rather than two bolted-on pickers.
function ColorPicker({ value, onChange, size = 20 }) {
  const isCustom = !THEME_COLORS.some(c => c.hex.toLowerCase() === (value || "").toLowerCase());
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
      {THEME_COLORS.map(c => {
        const active = value?.toLowerCase() === c.hex.toLowerCase();
        return (
          <button
            key={c.id} onClick={() => onChange(c.hex)} title={c.id}
            style={{
              width: `${size}px`, height: `${size}px`, borderRadius: "50%",
              background: c.hex, cursor: "pointer", padding: 0,
              border: active ? `2px solid #fff` : "2px solid transparent",
              boxShadow: active ? `0 0 0 2px ${c.hex}` : "none",
              transition: "all 0.12s",
            }}
          />
        );
      })}
      <span style={{ width: "1px", alignSelf: "stretch", background: T.border, margin: "0 2px" }} />
      <label style={{
        position: "relative", width: `${size}px`, height: `${size}px`, borderRadius: "50%",
        cursor: "pointer", overflow: "hidden",
        border: isCustom ? "2px solid #fff" : `1px dashed ${T.border}`,
        boxShadow: isCustom ? `0 0 0 2px ${value}` : "none",
        background: isCustom ? value : T.raise,
        display: "flex", alignItems: "center", justifyContent: "center",
      }} title="Custom color">
        {!isCustom && <span style={{ fontSize: "10px", color: T.muted }}>+</span>}
        <input
          type="color" value={value || DEFAULT_HOLDER_COLOR}
          onChange={e => onChange(e.target.value)}
          style={{ position: "absolute", inset: "-4px", opacity: 0, cursor: "pointer", border: "none" }}
        />
      </label>
    </div>
  );
}

// Finds the collet-size option's label somewhere inside a description
// string and splits the string around it — tolerant of the real-world
// variants seen in actual descriptions ("SK13C" with a trailing C, extra
// spaces, lowercase). Returns null if nothing matches, so the caller can
// fall back to plain unstyled text rather than erroring.
function findColletSpan(description, colletSizeId) {
  const opt = optById("colletSize", colletSizeId);
  if (!opt || !description) return null;
  const label = opt.label.replace(/[^A-Za-z0-9]/g, "");
  const re = new RegExp(label.replace(/([A-Za-z]+)(\d+)/, "$1\\s*$2") + "C?", "i");
  const m = description.match(re);
  if (!m) return null;
  return { before: description.slice(0, m.index), match: m[0], after: description.slice(m.index + m[0].length) };
}

/* ═══ HOLDER PILL — the reusable "what holder is this" bubble ═══════════════
   Meant to appear wherever a holder is referenced throughout the app, not
   just on this page — assembly pickers, tool rows, anywhere.

   ⚠️ Claude Code: this REPLACES the app's existing tool-holder pill color
   UI. Dan reviewed both and prefers this design — don't keep the old
   treatment running alongside it; this is the one going forward.

   Background stays one neutral surface always — the holder's own color
   never fills the middle (see the COLOR SYSTEM note above for why: keeps
   it from fighting the collet-size text color). The color instead shows as
   thick END CAPS mirrored on both sides — the same idea as CamPresetPicker's
   colored left edge, but mirrored to both ends and shaped as rounded caps
   (not a flat bar) so they follow the pill's own capsule curve rather than
   cutting a hard rectangle across a rounded shape. A thin matching border
   wraps the whole pill on top of that.

   Implementation note: the caps are plain rectangles positioned at the very
   left/right edges; `overflow: hidden` on the pill clips them to its own
   border-radius automatically, so they always match the curve exactly
   without needing to hand-shape the caps themselves.

   The collet-size substring within the description gets its own color if
   one is assigned and a match is found; everything else stays plain text.
   ═══════════════════════════════════════════════════════════════════════ */
/* ═══ SCOOP CAP GEOMETRY ═════════════════════════════════════════════════════
   The end caps need a curved inner wall — a radius LARGER than the pill's
   own outer corner radius — that still blends smoothly into the pill's
   top and bottom edges (no visible kink at the join).

   Why this needs a Bezier curve, not a literal circular arc: a single
   circular arc can only be tangent-to-horizontal at BOTH y=0 and y=H if
   its radius equals exactly H/2 — which is the pill's OWN outer radius.
   Any bigger circular radius can't hit both tangent points at once. A
   cubic Bezier sidesteps this: placing each control point at the SAME y
   as its adjacent endpoint (0 or H) forces that endpoint's tangent to be
   exactly horizontal, regardless of how far the curve bulges sideways in
   between. That's the actual mechanism that prevents the sharp corner.

   capW  = the cap's resting width at the very top/bottom (flush, matches
           the pill's own rounding — this is the "outer radius" reference)
   bulge = how much further the curve reaches toward the middle at the
           vertical center — this is what makes the inner radius bigger
   H     = pill height (fixed, so the geometry can be computed exactly —
           see the explicit height on the pill below)

   The straight outer edge (x=0) isn't rounded in the path itself — the
   parent's own border-radius + overflow:hidden clips it into shape for
   free, same trick as the flat-rectangle version before this.
   ═══════════════════════════════════════════════════════════════════════ */
function scoopCapPath(capW, scoop, H) {
  // Control points sit INSIDE capW, so the inner wall bows back toward the
  // outer edge at mid-height — the cap is widest at top/bottom and pinches
  // thin in the middle. (Pushing them past capW instead would bulge the cap
  // into the text area and pinch the middle of the PILL, which is backwards.)
  const xC = capW - scoop;
  return `M 0,0 L 0,${H} L ${capW},${H} C ${xC},${H} ${xC},0 ${capW},0 Z`;
}

function HolderPill({ holder, compact, colletColors }) {
  const hColor = holder.color || DEFAULT_HOLDER_COLOR;
  const span = holder.colletSize ? findColletSpan(holder.description, holder.colletSize) : null;
  const colletColor = holder.colletSize
    ? (colletColors?.[holder.colletSize] ?? optById("colletSize", holder.colletSize)?.color ?? DEFAULT_COLLET_COLOR)
    : null;

  // Fixed height so the SVG coordinate space matches the rendered pill
  // exactly — the scoop math above depends on knowing H precisely, not
  // guessing it from padding + font-size.
  const H = compact ? 24 : 30;
  const capW = compact ? 13 : 17;
  const scoop = compact ? 6 : 8;   // how deeply the inner wall bows back
  const totalW = capW;             // cap never exceeds capW now (was capW+bulge)
  const d = scoopCapPath(capW, scoop, H);

  return (
    <span style={{
      position: "relative", display: "inline-flex", alignItems: "center",
      height: `${H}px`, background: T.surface2, borderRadius: `${H / 2}px`,
      border: `1.5px solid ${hColor}`, overflow: "hidden",
      maxWidth: "100%",
    }}>
      {/* Mirrored scoop caps — right one is the same path, just flipped */}
      <svg width={totalW} height={H} viewBox={`0 0 ${totalW} ${H}`}
        style={{ position: "absolute", left: 0, top: 0 }}>
        <path d={d} fill={hColor} />
      </svg>
      <svg width={totalW} height={H} viewBox={`0 0 ${totalW} ${H}`}
        style={{ position: "absolute", right: 0, top: 0, transform: "scaleX(-1)" }}>
        <path d={d} fill={hColor} />
      </svg>

      <span style={{
        position: "relative", zIndex: 1, minWidth: 0,
        padding: `0 ${totalW + 5}px`,
        fontSize: compact ? "11.5px" : "13px", fontWeight: 600, color: T.text,
        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
      }}>
        {span ? (
          <>
            {span.before}
            <span style={{ color: colletColor, fontWeight: 800 }}>{span.match}</span>
            {span.after}
          </>
        ) : (holder.description || "Untitled holder")}
      </span>
    </span>
  );
}

function Pill({ children, color = T.blue, bg, bd, onClick, active, small }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: small ? "3px 8px" : "5px 11px", borderRadius: "20px",
        fontSize: small ? "10.5px" : "12px", fontWeight: 700, cursor: onClick ? "pointer" : "default",
        border: `1px solid ${active ? (bd || color) : T.border}`,
        background: active ? (bg || color + "22") : "transparent",
        color: active ? color : T.muted, fontFamily: T.sans,
        transition: "all 0.14s", whiteSpace: "nowrap",
      }}
    >{children}</button>
  );
}

// The native <select> arrow was invisible/inconsistent against this dark
// theme (varies by browser/OS, sometimes dark-on-dark). appearance:none
// strips it and a custom chevron replaces it — same ▾ glyph already used
// for the CAM preset picker button, so all dropdowns read consistently.
function Select({ value, onChange, options, placeholder, allowCustom, onAddCustom }) {
  return (
    <div style={{ position: "relative" }}>
      <select
        value={value || ""}
        onChange={e => {
          if (e.target.value === "__custom__") { onAddCustom?.(); return; }
          onChange(e.target.value || null);
        }}
        style={{
          ...inputStyle, cursor: "pointer", paddingRight: "28px",
          appearance: "none", WebkitAppearance: "none", MozAppearance: "none",
        }}
      >
        <option value="">{placeholder || "—"}</option>
        {options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
        {allowCustom && <option value="__custom__">+ Add custom…</option>}
      </select>
      <span style={{
        position: "absolute", right: "10px", top: "50%", transform: "translateY(-50%)",
        color: T.muted, fontSize: "11px", pointerEvents: "none",
      }}>▾</span>
    </div>
  );
}

// The holder's own unit — independent of anything else the app does.
// Toggling calls convertHolderUnits (a real value conversion, not a
// relabel), so switching rewrites every height/diameter. Lives in the
// "Holder Geometry" section header, right where the numbers it affects are.
function UnitToggle({ unit, onChange }) {
  return (
    <div style={{ display: "inline-flex", background: "#0d0d0d", border: `1px solid ${T.border}`, borderRadius: "8px", padding: "3px", gap: "3px" }}>
      {["mm", "in"].map(u => {
        const active = unit === u;
        return (
          <button
            key={u}
            onClick={() => active ? null : onChange(u)}
            style={{
              padding: "4px 12px", borderRadius: "6px", fontSize: "11.5px", fontWeight: 700,
              cursor: "pointer", fontFamily: T.sans,
              border: `1px solid ${active ? T.blueB : "transparent"}`,
              background: active ? T.blueD : "transparent",
              color: active ? T.blue : T.muted, transition: "all 0.14s",
            }}
          >{u === "mm" ? "Millimeters" : "Inches"}</button>
        );
      })}
    </div>
  );
}

/* ═══ 2D PROFILE VIEW ═══════════════════════════════════════════════════════
   Draws the silhouette from the segment list. A holder is a solid of
   revolution, so height + upper/lower diameter per segment is everything
   needed — no extra data required.

   ORIENTATION: spindle end at TOP, tool tip at BOTTOM — matches how the
   holder actually hangs in the machine, and matches the segment table's
   top-down row order. The underlying array is bottom-up (array[0] = tip),
   so this iterates it in reverse, same mirror as the table.

   Within a segment, `upper-diameter` is the spindle-ward end and
   `lower-diameter` is the tip-ward end, so each segment draws as a
   trapezoid from ud (top) to ld (bottom). Verified against real data: the
   BT30 retention groove (46 → 38 → 46 across three segments) renders as a
   proper V-groove with this convention.

   TRUE PROPORTIONS: uses one uniform scale for both axes rather than
   stretching to fill. A distorted profile would hide exactly the errors
   this view exists to catch.

   ⚠️ Claude Code: this is deliberately GENERIC — it takes a segment list,
   not a holder. Dan wants the same component reused for cutting tools and
   full tool assemblies later. To extend: an assembly is just holder
   segments + tool segments concatenated, with the tool's stickout (OOH)
   positioned below the holder's tip. Keep the `kindOf()` color hook as the
   single place segment types are styled so tool-specific types (flute,
   shank, neck) slot in without touching the geometry code.
   ═══════════════════════════════════════════════════════════════════════ */
function ProfileView({ segments, unit, selectedIndex, onSelect, hoverIndex, onHover, maxHeight = 340, width = 150 }) {
  const totalH = segments.reduce((a, s) => a + (Number(s.h) || 0), 0);
  const maxD = segments.reduce((a, s) => Math.max(a, Number(s.ud) || 0, Number(s.ld) || 0), 0);
  if (!totalH || !maxD) {
    return (
      <div style={{
        width, minHeight: 140, borderRadius: "8px", border: `1px dashed ${T.border}`,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: "10.5px", color: T.veryMuted, textAlign: "center", padding: "10px",
      }}>Add segments to see the profile</div>
    );
  }

  const padY = 14, padX = 12;
  // One scale for both axes — true proportions, never stretched to fit.
  const scale = Math.min((maxHeight - padY * 2) / totalH, (width - padX * 2) / maxD);
  const svgH = totalH * scale + padY * 2;
  const cx = width / 2;

  // Classifies a segment for styling. THE hook to extend for tool/assembly
  // segment types later — geometry code below never branches on type.
  // Colors are deliberately BRIGHT: this sits on a near-black panel and its
  // whole job is making a wrong segment jump out. Extension is orange, not
  // teal — teal on dark read as muddy, and orange separates cleanly from
  // both the steel body and the blue selection state.
  const kindOf = (s) => s.agl ? "agl" : (s.ext ? (s.shankSeg ? "shank" : "ext") : "body");
  const STYLE = {
    body:  { fill: "#8b95a3", stroke: "#b6c0cc" },              // steel
    agl:   { fill: "#3f434b", stroke: "#6c727d", dash: "3 2" }, // dim, not counted
    ext:   { fill: T.ext,     stroke: "#8fe8ab" },              // extension green
    shank: { fill: T.ext,     stroke: "#d98cff" },              // extension green + violet edge
  };

  // Gauge line sits below the above-gauge-line segments (which are at the
  // spindle end). Everything below it is what counts toward gauge length.
  let aglH = 0;
  for (let i = segments.length - 1; i >= 0; i--) {
    if (segments[i].agl) aglH += Number(segments[i].h) || 0; else break;
  }

  // Build top-down draw order while remembering each shape's REAL array
  // index, so clicks map back to the right row in the table.
  const shapes = [];
  let y = padY;
  for (let i = segments.length - 1; i >= 0; i--) {
    const s = segments[i];
    const h = (Number(s.h) || 0) * scale;
    const rU = (Number(s.ud) || 0) / 2 * scale;
    const rL = (Number(s.ld) || 0) / 2 * scale;
    shapes.push({
      realIndex: i, kind: kindOf(s), y, h,
      points: `${cx - rU},${y} ${cx + rU},${y} ${cx + rL},${y + h} ${cx - rL},${y + h}`,
    });
    y += h;
  }

  return (
    <div style={{ width, flexShrink: 0 }}>
      <svg width={width} height={svgH} style={{ display: "block", borderRadius: "8px", background: "#101013", border: `1px solid ${T.border}` }}>
        {/* centre line */}
        <line x1={cx} y1={padY} x2={cx} y2={svgH - padY} stroke={T.border} strokeWidth="1" strokeDasharray="2 3" />

        {shapes.map(sh => {
          const st = STYLE[sh.kind];
          const isSel = selectedIndex === sh.realIndex;
          const isHov = hoverIndex === sh.realIndex;
          return (
            <polygon
              key={sh.realIndex}
              points={sh.points}
              onClick={() => onSelect?.(isSel ? null : sh.realIndex)}
              onMouseEnter={() => onHover?.(sh.realIndex)}
              onMouseLeave={() => onHover?.(null)}
              style={{ cursor: "pointer" }}
              fill={isSel ? "#4d9bff" : st.fill}
              stroke={isSel ? "#ffffff" : (isHov ? "#ffffff" : st.stroke)}
              strokeWidth={isSel ? 2 : (isHov ? 1.5 : 1)}
              strokeDasharray={st.dash || "none"}
            />
          );
        })}

        {/* Gauge line — where measurement starts */}
        {aglH > 0 && (
          <g>
            <line
              x1={2} y1={padY + aglH * scale} x2={width - 2} y2={padY + aglH * scale}
              stroke={T.amber} strokeWidth="1" strokeDasharray="4 3"
            />
            <text x={4} y={padY + aglH * scale - 3} fill={T.amber} fontSize="7.5" fontFamily={T.mono}>GAUGE</text>
          </g>
        )}
      </svg>

      {/* Legend — only shows the types actually present */}
      <div style={{ display: "flex", flexDirection: "column", gap: "3px", marginTop: "7px" }}>
        {[
          { k: "agl", label: "Above gauge" },
          { k: "ext", label: "Extension" },
          { k: "shank", label: "Ext shank seg" },
        ].filter(l => shapes.some(s => s.kind === l.k)).map(l => (
          <div key={l.k} style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "9.5px", color: T.muted }}>
            <span style={{
              width: "10px", height: "10px", borderRadius: "2px", flexShrink: 0,
              background: STYLE[l.k].fill, border: `1px ${STYLE[l.k].dash ? "dashed" : "solid"} ${STYLE[l.k].stroke}`,
            }} />
            {l.label}
          </div>
        ))}
        <div style={{ fontSize: "9px", color: T.veryMuted, marginTop: "2px", fontFamily: T.mono }}>
          {formatLen(totalH, unit)} {unit} overall
        </div>
      </div>
    </div>
  );
}

/* ═══ SEGMENT TABLE — top-down display, bottom-up storage ═══════════════════
   Fusion's JSON stores segments BOTTOM-UP: array[0] is the tool-tip end,
   array[last] is the gauge-line/spindle end. Fusion's OWN editor UI shows
   the opposite — TOP-DOWN, gauge-line end at row 1, tip at the last row —
   because that reads the way a machinist looks at the holder. Verified
   against the real file: row 1 in Fusion's UI (2mm, Ø31.75, Above Gauge
   Line) is the LAST element of the JSON array.

   This mirrors a conversion the app's Fusion export code already does for
   gauge length math (jsonIndex = S − fusionNumber) — same flip, now made
   explicit in the UI layer. `displaySegments` is array-reversed for
   rendering only; every edit maps back to the real underlying index so the
   STORED array order for Fusion export never changes.

   New segment rows are added at the tip end (visually the BOTTOM of this
   top-down table) — that's where an extension actually gets added.
   ═══════════════════════════════════════════════════════════════════════ */
function SegmentTable({ segments, unit, onChange, hasExtension }) {
  const gauge = deriveGaugeLength(segments);
  const extOoh = deriveExtensionOoh(segments);
  const n = segments.length;

  // vi = visual (top-down) row index. Underlying array is bottom-up, so the
  // real index is a mirror: last real element shows first.
  const realIndex = (vi) => n - 1 - vi;

  const set = (vi, key, val) => {
    const ri = realIndex(vi);
    onChange(segments.map((s, i) => i === ri ? { ...s, [key]: val } : s));
  };
  // Shank is single-select among ext-flagged rows — a diameter can only be
  // "the" mating shank once. Clicking the already-checked row clears it;
  // clicking any other row moves the flag there and clears everywhere else.
  const setShank = (vi) => {
    const ri = realIndex(vi);
    const already = !!segments[ri].shankSeg;
    onChange(segments.map((s, i) => ({ ...s, shankSeg: !already && i === ri })));
  };
  // New segment = new tip. Tip is array[0], and the bottom row visually —
  // so this is a genuine prepend, not an append. Both mutate row COUNT, so
  // any active selection's vi indices would point at the wrong rows after —
  // clear it rather than let it go stale.
  const addRow = () => { onChange([{ h: 1, ud: 20, ld: 20 }, ...segments]); clearSelection(); };
  const delRow = (vi) => { onChange(segments.filter((_, i) => i !== realIndex(vi))); clearSelection(); };

  const th = {
    fontSize: "9.5px", fontWeight: 800, letterSpacing: "0.07em",
    textTransform: "uppercase", color: T.muted, textAlign: "left",
    padding: "0 0 6px", whiteSpace: "nowrap",
  };
  const cellInput = { ...inputStyle, padding: "4px 7px", fontFamily: T.mono, fontSize: "12px" };
  const unitAbbr = unit === "mm" ? "mm" : "in";

  // Cells display the rounded value (formatLen — 3mm/4in) at rest, but show
  // the raw stored number while the user is actively typing in that exact
  // cell, so rounding-on-every-keystroke doesn't fight their fingers. Only
  // ONE state var, keyed by "realIndex-field", not one hook per cell.
  const [focusedCell, setFocusedCell] = useState(null);
  const cellValue = (realI, key, raw) => {
    const cellKey = `${realI}-${key}`;
    return focusedCell === cellKey ? raw : formatLen(raw, unit);
  };

  /* ── Shift-click range select — a quick "add these up" tool ──────────────
     Standard file-manager convention: shift+click the # column sets an
     anchor (or extends from the existing one); the range fills in
     everything between, regardless of direction. A later shift+click moves
     the ACTIVE end but the anchor stays put, so the range always stays one
     contiguous block — never multiple disjoint groups. A plain (non-shift)
     click on # clears the selection; that's the "start over" gesture.

     Indices are VISUAL (vi, top-down) — what the user is actually looking
     at — not the underlying bottom-up array order. A contiguous visual
     range is also contiguous in the real array (realIndex is just a mirror
     of vi), so nothing is lost by tracking it this way; it's just more
     legible while writing the selection logic. */
  const [selAnchor, setSelAnchor] = useState(null);
  const [selEnd, setSelEnd] = useState(null);
  // Single-segment focus, shared with the profile view. Separate from the
  // shift-click RANGE selection above — that one answers "what do these add
  // up to", this one answers "which segment is this shape".
  const [activeSeg, setActiveSeg] = useState(null);
  const [hoverSeg, setHoverSeg] = useState(null);
  const selRange = selAnchor != null ? [Math.min(selAnchor, selEnd), Math.max(selAnchor, selEnd)] : null;
  const isSelected = (vi) => !!selRange && vi >= selRange[0] && vi <= selRange[1];
  const clearSelection = () => { setSelAnchor(null); setSelEnd(null); };
  const handleRowNumberClick = (vi, shiftKey) => {
    if (!shiftKey) { clearSelection(); return; }
    if (selAnchor == null) { setSelAnchor(vi); setSelEnd(vi); }
    else { setSelEnd(vi); }
  };

  const display = segments.slice().reverse(); // top-down, for both rendering and the sum below
  const selectedSum = selRange
    ? display.slice(selRange[0], selRange[1] + 1).reduce((a, s) => a + (Number(s.h) || 0), 0)
    : 0;
  const selectedCount = selRange ? selRange[1] - selRange[0] + 1 : 0;

  // Claude Code: row/header heights here are ESTIMATES for positioning the
  // floating total tag without a DOM measurement — good enough for "pops up
  // near the row" but will drift if the table's font-size/padding changes.
  // A real implementation should measure the active row via a ref
  // (getBoundingClientRect) instead of hardcoding these two numbers.
  const HEADER_H = 26;
  const ROW_H = 30;

  return (
    <div>
    {/* nowrap + minWidth:0 on the table column keeps the profile pinned
        beside the table at ANY width. With wrap enabled the profile jumped
        above the table on narrow screens; now the table just scrolls
        horizontally inside its own overflow box instead. */}
    <div style={{ display: "flex", gap: "14px", alignItems: "flex-start", flexWrap: "nowrap" }}>
      <ProfileView
        segments={segments} unit={unit}
        selectedIndex={activeSeg} onSelect={setActiveSeg}
        hoverIndex={hoverSeg} onHover={setHoverSeg}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ overflowX: "auto", position: "relative" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "560px" }}>
          <thead>
            <tr>
              <th style={{ ...th, width: "34px" }}>#</th>
              <th style={th}>Height ({unitAbbr})</th>
              <th style={th}>Upper Ø ({unitAbbr})</th>
              <th style={th}>Lower Ø ({unitAbbr})</th>
              <th style={{ ...th, textAlign: "center", width: "78px" }}>Above<br />gauge</th>
              <th style={{ ...th, textAlign: "center", width: "78px", color: T.ext }}>Extension</th>
              {hasExtension && <th style={{ ...th, textAlign: "center", width: "78px", color: T.violet }}>Ext shank<br />Ø</th>}
              <th style={{ ...th, width: "28px" }} />
            </tr>
          </thead>
          <tbody>
            {display.map((s, vi) => {
              const ri = realIndex(vi);
              const selected = isSelected(vi);
              return (
              <tr key={ri}
                onMouseEnter={() => setHoverSeg(ri)}
                onMouseLeave={() => setHoverSeg(null)}
                style={{
                background: activeSeg === ri ? T.blueD
                  : hoverSeg === ri ? T.raise
                  : selected ? T.blueD : (s.ext ? T.extD : "transparent"),
                boxShadow: activeSeg === ri
                  ? `inset 0 0 0 1px ${T.blue}`
                  : selected ? `inset 0 0 0 1px ${T.blueB}` : "none",
              }}>
                <td
                  onClick={e => handleRowNumberClick(vi, e.shiftKey)}
                  title="Click to clear · shift-click to select a range and see the total"
                  style={{
                    fontFamily: T.mono, fontSize: "11px", padding: "3px 0",
                    color: selected ? T.blue : T.muted, fontWeight: selected ? 800 : 400,
                    cursor: "pointer", userSelect: "none",
                  }}
                >{vi + 1}</td>
                <td style={{ padding: "3px 5px 3px 0" }}>
                  <input style={cellInput} type="number" step="0.001" value={cellValue(ri, "h", s.h)}
                    onFocus={() => { setFocusedCell(`${ri}-h`); clearSelection(); }} onBlur={() => setFocusedCell(null)}
                    onChange={e => set(vi, "h", parseFloat(e.target.value) || 0)} />
                </td>
                <td style={{ padding: "3px 5px 3px 0" }}>
                  <input style={cellInput} type="number" step="0.001" value={cellValue(ri, "ud", s.ud)}
                    onFocus={() => { setFocusedCell(`${ri}-ud`); clearSelection(); }} onBlur={() => setFocusedCell(null)}
                    onChange={e => set(vi, "ud", parseFloat(e.target.value) || 0)} />
                </td>
                <td style={{ padding: "3px 5px 3px 0" }}>
                  <input style={cellInput} type="number" step="0.001" value={cellValue(ri, "ld", s.ld)}
                    onFocus={() => { setFocusedCell(`${ri}-ld`); clearSelection(); }} onBlur={() => setFocusedCell(null)}
                    onChange={e => set(vi, "ld", parseFloat(e.target.value) || 0)} />
                </td>
                <td style={{ textAlign: "center", padding: "3px 0" }}>
                  <input type="checkbox" checked={!!s.agl} onChange={e => set(vi, "agl", e.target.checked)} />
                </td>
                <td style={{ textAlign: "center", padding: "3px 0" }}>
                  {/* THE NEW FLAG. Sum of checked heights = extension OOH. */}
                  <input type="checkbox" checked={!!s.ext} onChange={e => set(vi, "ext", e.target.checked)} />
                </td>
                {hasExtension && (
                  <td style={{ textAlign: "center", padding: "3px 0" }}>
                    {/* Only meaningful within an Extension-flagged segment —
                        marks WHICH diameter is the mating shank, single-select. */}
                    <input
                      type="checkbox" checked={!!s.shankSeg} disabled={!s.ext}
                      onChange={() => setShank(vi)}
                      style={{ opacity: s.ext ? 1 : 0.3, cursor: s.ext ? "pointer" : "not-allowed" }}
                    />
                  </td>
                )}
                <td style={{ textAlign: "center" }}>
                  <button onClick={() => delRow(vi)} style={{
                    background: "none", border: "none", color: T.veryMuted,
                    cursor: "pointer", fontSize: "14px", padding: "0 2px",
                  }}>×</button>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>

        {/* Floating range total — the whole feature. Positioned near the
            ACTIVE end of the selection (selEnd), not the anchor, so it
            tracks whichever row you most recently shift-clicked. pointerEvents
            none so it never blocks clicking the row underneath it. */}
        {selRange && (
          <div style={{
            position: "absolute",
            left: "38px",
            top: `${HEADER_H + selEnd * ROW_H + ROW_H / 2 - 15}px`,
            zIndex: 5, pointerEvents: "none",
            display: "flex", alignItems: "center", gap: "9px",
            background: T.blue, color: "#fff",
            borderRadius: "7px", padding: "6px 12px",
            fontFamily: T.sans, fontSize: "11.5px", fontWeight: 600,
            boxShadow: "0 4px 16px rgba(0,0,0,0.5)", whiteSpace: "nowrap",
          }}>
            <span style={{ opacity: 0.85 }}>{selectedCount} seg{selectedCount === 1 ? "" : "s"}</span>
            <span style={{ fontFamily: T.mono, fontSize: "13.5px", fontWeight: 800 }}>
              {formatLen(selectedSum, unit)} {unitAbbr}
            </span>
          </div>
        )}
      </div>
      <div style={{ fontSize: "9.5px", color: T.veryMuted, marginTop: "5px" }}>
        Row 1 = gauge line / spindle end · last row = tool tip — matches Fusion's own editor.
        New segments are added at the tip. Shift-click row numbers to total a range · click a number to clear.
      </div>

      <button onClick={addRow} style={{
        marginTop: "8px", padding: "5px 11px", borderRadius: "6px", fontSize: "11px",
        fontWeight: 600, cursor: "pointer", border: `1px solid ${T.border}`,
        background: T.raise, color: T.text, fontFamily: T.sans,
      }}>+ Add segment at tip</button>
      </div>
    </div>

      {/* Derived readouts — both computed from the table, neither typeable.
          Primary reads in the holder's CURRENT unit; the small secondary
          hint is always the other one, via asInches/asMm — never a blind
          mm-assumption. */}
      <div style={{ display: "flex", gap: "10px", marginTop: "12px", flexWrap: "wrap" }}>
        <div style={{
          flex: 1, minWidth: "180px", background: "#101013",
          border: `1px solid ${T.border}`, borderRadius: "8px", padding: "9px 12px",
        }}>
          <div style={{ fontSize: "9.5px", fontWeight: 800, letterSpacing: "0.08em", color: T.muted }}>GAUGE LENGTH</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: "6px", marginTop: "3px" }}>
            <span style={{ fontFamily: T.mono, fontSize: "19px", fontWeight: 800, color: T.text }}>{formatLen(gauge, unit)}</span>
            <span style={{ fontFamily: T.mono, fontSize: "10px", color: T.muted }}>{unitAbbr}</span>
            <span style={{ fontFamily: T.mono, fontSize: "10px", color: T.veryMuted }}>
              ({unit === "mm" ? `${formatLen(asInches(gauge, unit), "in")} in` : `${formatLen(asMm(gauge, unit), "mm")} mm`})
            </span>
          </div>
          <div style={{ fontSize: "9px", color: T.veryMuted, marginTop: "2px" }}>sum of segments below the gauge line</div>
        </div>

        {/* Only takes up space on holders that actually have an extension —
            a "—" placeholder on every other holder was just clutter. */}
        {hasExtension && (
          <div style={{
            flex: 1, minWidth: "180px",
            background: extOoh != null ? T.extD : "#101013",
            border: `1px solid ${extOoh != null ? T.extB : T.border}`,
            borderRadius: "8px", padding: "9px 12px",
          }}>
            <div style={{ fontSize: "9.5px", fontWeight: 800, letterSpacing: "0.08em", color: extOoh != null ? T.ext : T.muted }}>
              EXTENSION OOH
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: "6px", marginTop: "3px" }}>
              <span style={{ fontFamily: T.mono, fontSize: "19px", fontWeight: 800, color: extOoh != null ? T.ext : T.veryMuted }}>
                {extOoh != null ? formatLen(asInches(extOoh, unit), "in") : "—"}
              </span>
              <span style={{ fontFamily: T.mono, fontSize: "10px", color: T.muted }}>in</span>
              {extOoh != null && (
                <span style={{ fontFamily: T.mono, fontSize: "10px", color: T.veryMuted }}>
                  ({unit === "mm" ? formatLen(extOoh, "mm") : formatLen(asMm(extOoh, unit), "mm")} mm)
                </span>
              )}
            </div>
            <div style={{ fontSize: "9px", color: T.veryMuted, marginTop: "2px" }}>
              sum of flagged extension segments — derived, not editable
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ═══ HOLDER DETAIL / EDIT ═══════════════════════════════════════════════ */
function HolderDetail({ holder, onBack, onSave, allLocations, colletColors, onViewTools }) {
  const [h, setH] = useState(holder);
  const [descManual, setDescManual] = useState(true); // existing records have hand names
  const set = (k, v) => setH(p => ({ ...p, [k]: v }));

  const suggested = composeDescription(h);
  const overLimit = (h.description || "").length > FUSION_DESC_LIMIT;
  const taperOpt = optById("taper", h.taper);
  const extOoh = deriveExtensionOoh(h.segments);
  const shankDia = deriveExtensionShankDia(h.segments);
  const usage = USAGE[h.id] || 0;

  // Extension flag and extension segments must agree — surface the mismatch
  const extMismatch = h.hasExtension !== (extOoh != null);

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "14px", flexWrap: "wrap" }}>
        <button onClick={onBack} style={{
          padding: "7px 12px", borderRadius: "7px", fontSize: "12px", cursor: "pointer",
          border: `1px solid ${T.border}`, background: "transparent", color: T.muted, fontFamily: T.sans,
        }}>← Holders</button>
        <div style={{ flex: 1, minWidth: "160px" }}>
          <HolderPill holder={h} colletColors={colletColors} />
          <div style={{ fontSize: "10.5px", color: T.muted, fontFamily: T.mono, marginTop: "4px" }}>{h.id}</div>
        </div>
        <button
          onClick={() => usage && onViewTools?.(h)}
          disabled={!usage}
          title={usage ? `Show the ${usage} tools using this holder` : "No tools use this holder yet"}
          style={{
            fontSize: "11px", fontWeight: 700, color: usage ? T.blue : T.veryMuted,
            background: usage ? T.blueD : "transparent",
            border: `1px solid ${usage ? T.blueB : T.border}`,
            borderRadius: "6px", padding: "5px 10px", fontFamily: T.sans,
            cursor: usage ? "pointer" : "default",
            display: "inline-flex", alignItems: "center", gap: "5px",
          }}>
          used by {usage} tool{usage === 1 ? "" : "s"}
          {usage > 0 && <span style={{ opacity: 0.7 }}>→</span>}
        </button>
        <button onClick={() => onSave(h)} style={{
          padding: "9px 18px", borderRadius: "7px", fontSize: "13px", fontWeight: 700,
          cursor: "pointer", border: "none", background: T.blue, color: "#fff", fontFamily: T.sans,
        }}>✓ Save</button>
      </div>

      {/* Re-stamp — the explicit propagation push */}
      {usage > 0 && (
        <div style={{
          background: T.amberD, border: `1px solid ${T.amberB}`, borderRadius: "9px",
          padding: "10px 14px", marginBottom: "10px",
          display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap",
        }}>
          <div style={{ flex: 1, minWidth: "220px" }}>
            <div style={{ fontSize: "12px", fontWeight: 700, color: T.amber }}>Propagate geometry to linked tools</div>
            <div style={{ fontSize: "10.5px", color: T.muted, marginTop: "2px" }}>
              Tools refresh lazily on their own next save. Push now to update all {usage} immediately.
            </div>
          </div>
          <button style={{
            padding: "7px 13px", borderRadius: "6px", fontSize: "11.5px", fontWeight: 700,
            cursor: "pointer", border: `1px solid ${T.amberB}`, background: "transparent",
            color: T.amber, fontFamily: T.sans, whiteSpace: "nowrap",
          }}>Re-stamp {usage} tools…</button>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: "10px", marginBottom: "10px" }}>
        {/* Identity */}
        <Section label="Identity" color={T.violet}>
          <Field label="Description" hint={`Fusion limit ~${FUSION_DESC_LIMIT} chars — shorten by hand when needed`}>
            <input
              style={{ ...inputStyle, borderColor: overLimit ? T.red : T.border }}
              value={h.description}
              onChange={e => { set("description", e.target.value); setDescManual(true); }}
            />
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "5px", flexWrap: "wrap" }}>
              <span style={{
                fontFamily: T.mono, fontSize: "10px",
                color: overLimit ? T.red : T.veryMuted,
              }}>{(h.description || "").length}/{FUSION_DESC_LIMIT}</span>
              {descManual && suggested && suggested !== h.description && (
                <>
                  <span style={{ fontSize: "10px", color: T.muted, fontFamily: T.mono }}>suggested: {suggested}</span>
                  <button
                    onClick={() => { set("description", suggested); setDescManual(false); }}
                    style={{
                      padding: "2px 8px", borderRadius: "5px", fontSize: "10px", fontWeight: 700,
                      cursor: "pointer", border: `1px solid ${T.blueB}`, background: T.blueD,
                      color: T.blue, fontFamily: T.sans,
                    }}
                  >↺ Use auto</button>
                </>
              )}
            </div>
          </Field>

          <div style={{ marginTop: "12px" }}>
            <Field label="Color" hint="Appears as this holder's pill throughout the app">
              <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
                <ColorPicker value={h.color || DEFAULT_HOLDER_COLOR} onChange={v => set("color", v)} />
                <HolderPill holder={h} compact colletColors={colletColors} />
              </div>
            </Field>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginTop: "10px" }}>
            <Field label="Manufacturer"><input style={inputStyle} value={h.mfg || ""} onChange={e => set("mfg", e.target.value)} /></Field>
            <Field label="Part number"><input style={inputStyle} value={h.partNo || ""} onChange={e => set("partNo", e.target.value)} /></Field>
          </div>
          <div style={{ marginTop: "10px" }}>
            <Field label="Location" hint="Free text — suggestions from other holders">
              <input style={inputStyle} list="holder-locations" value={h.location || ""} onChange={e => set("location", e.target.value)} />
              <datalist id="holder-locations">
                {allLocations.map(l => <option key={l} value={l} />)}
              </datalist>
            </Field>
          </div>
        </Section>

        {/* Classification */}
        <Section label="Classification" color={T.violet}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
            <Field label="Type">
              <Select value={h.type} onChange={v => set("type", v)} options={OPT.type} allowCustom />
            </Field>
            <Field label="Taper">
              <Select value={h.taper} onChange={v => set("taper", v)} options={OPT.taper} allowCustom />
            </Field>
          </div>

          {/* NBT explainer pill — NBT is a Nikken designation meaning dual contact */}
          {taperOpt?.dc && (
            <div style={{
              marginTop: "8px", display: "inline-flex", alignItems: "center", gap: "7px",
              background: T.violetD, border: `1px solid ${T.violetB}`, borderRadius: "20px",
              padding: "4px 11px",
            }}>
              <span style={{ fontSize: "10px", fontWeight: 800, color: T.violet, letterSpacing: "0.05em" }}>DUAL CONTACT</span>
              <span style={{ fontSize: "10.5px", color: T.muted }}>
                {taperOpt.nikken
                  ? "NBT is Nikken's designation for a dual-contact BT taper"
                  : "Simultaneous taper + flange face contact"}
              </span>
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px", marginTop: "10px" }}>
            <Field label="Collet family">
              <Select value={h.colletFamily} onChange={v => set("colletFamily", v)} options={OPT.colletFamily} allowCustom />
            </Field>
            <Field label="Collet size">
              <Select
                value={h.colletSize} onChange={v => set("colletSize", v)}
                options={OPT.colletSize.filter(o => !h.colletFamily || o.family === h.colletFamily)}
                allowCustom
              />
            </Field>
            <Field label="Length"><input style={inputStyle} type="number" value={h.length ?? ""} onChange={e => set("length", e.target.value ? parseFloat(e.target.value) : null)} /></Field>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "16px", marginTop: "12px", flexWrap: "wrap" }}>
            <BoolPill
              label="Tap collet" active={!!h.tapCollet}
              onChange={v => set("tapCollet", v)}
              color={T.amber} bg={T.amberD} bd={T.amberB}
            />
          </div>
        </Section>
      </div>

      {/* Extension */}
      <Section label="Extension" color={T.ext} style={{ marginBottom: "10px" }}
        right={extOoh != null && (
          <span style={{ fontFamily: T.mono, fontSize: "12px", fontWeight: 800, color: T.ext }}>
            {formatLen(asInches(extOoh, h.unit), "in")} in OOH
          </span>
        )}>
        <div style={{ marginBottom: "10px" }}>
          <BoolPill
            label="This holder uses an extension" active={!!h.hasExtension}
            onChange={v => set("hasExtension", v)}
            color={T.ext} bg={T.extD} bd={T.extB}
          />
        </div>

        {extMismatch && (
          <div style={{
            background: T.amberD, border: `1px solid ${T.amberB}`, borderRadius: "7px",
            padding: "8px 11px", fontSize: "11px", color: T.amber, marginBottom: "10px",
          }}>
            {h.hasExtension
              ? "Extension is on, but no segments are flagged as Extension in the geometry table below. The OOH can't be derived until they are."
              : "Segments are flagged as Extension in the geometry below, but the Extension toggle is off."}
          </div>
        )}

        {h.hasExtension && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "10px" }}>
            <Field label="Extension collet">
              <Select value={h.extColletSize} onChange={v => set("extColletSize", v)}
                options={OPT.colletSize.filter(o => o.family === "cf-er")} allowCustom />
            </Field>
            <Field label="Manufacturer"><input style={inputStyle} value={h.extMfg || ""} onChange={e => set("extMfg", e.target.value)} /></Field>
            <Field label="Part number"><input style={inputStyle} value={h.extPartNo || ""} onChange={e => set("extPartNo", e.target.value)} /></Field>
            <Field label="Vendor / source"><input style={inputStyle} value={h.extVendor || ""} onChange={e => set("extVendor", e.target.value)} /></Field>
            <Field label="OOH (derived)" hint="Set by flagging segments below">
              <input
                style={{ ...inputStyle, fontFamily: T.mono, color: T.ext, fontWeight: 700, cursor: "not-allowed", opacity: 0.85 }}
                value={extOoh != null ? `${formatLen(asInches(extOoh, h.unit), "in")} in` : "—"} readOnly
              />
            </Field>
            <Field label="Extension shank diameter (derived)" hint="Mark one segment as the shank below">
              <input
                style={{ ...inputStyle, fontFamily: T.mono, color: shankDia != null ? T.ext : T.veryMuted, fontWeight: 700, cursor: "not-allowed", opacity: 0.85 }}
                value={shankDia != null ? `${formatLen(shankDia, h.unit)} ${h.unit}` : "—"} readOnly
              />
            </Field>
          </div>
        )}
      </Section>

      {/* Geometry */}
      <Section label="Holder Geometry" color={T.blue} style={{ marginBottom: "10px" }}
        right={<UnitToggle unit={h.unit} onChange={u => setH(p => convertHolderUnits(p, u))} />}>
        <SegmentTable
          segments={h.segments} unit={h.unit}
          onChange={v => set("segments", v)}
          hasExtension={h.hasExtension}
        />
      </Section>

      {/* Notes / attachments */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "10px" }}>
        <Section label="Notes" color={T.muted}>
          <textarea style={{ ...inputStyle, minHeight: "70px", resize: "vertical", fontFamily: T.sans }}
            value={h.notes || ""} onChange={e => set("notes", e.target.value)}
            placeholder="Setup notes, quirks, min OOH…" />
        </Section>
        <Section label="Attachments" color={T.muted}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
            <button style={{
              padding: "7px 13px", borderRadius: "7px", fontSize: "11.5px", fontWeight: 600,
              cursor: "pointer", border: `1px dashed ${T.border}`, background: "transparent",
              color: T.muted, fontFamily: T.sans,
            }}>+ Add photo or file</button>
            <span style={{ fontSize: "10px", color: T.veryMuted }}>same tool_files/&#123;id&#125;/ pattern as tools</span>
          </div>
        </Section>
      </div>
    </div>
  );
}

/* ═══ HEALER PREVIEW — preview → commit, never silent ═══════════════════ */
function HealerModal({ holders, onClose }) {
  const rows = holders.map(h => ({ h, heal: healDescription(h.description) }));
  const counts = rows.reduce((a, r) => { a[r.heal.confidence] = (a[r.heal.confidence] || 0) + 1; return a; }, {});
  const conf = { high: T.green, medium: T.amber, low: T.red };
  const confBg = { high: T.greenD, medium: T.amberD, low: T.redD };
  const confBd = { high: T.greenB, medium: T.amberB, low: T.redB };

  return (
    <div onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.72)", zIndex: 100,
        display: "flex", alignItems: "center", justifyContent: "center", padding: "20px",
      }}>
      <div style={{
        background: T.surface, border: `1px solid ${T.border}`, borderRadius: "12px",
        width: "100%", maxWidth: "900px", maxHeight: "88vh", display: "flex", flexDirection: "column",
      }}>
        <div style={{ padding: "14px 16px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: "200px" }}>
            <div style={{ fontSize: "14px", fontWeight: 700 }}>Normalize holder names</div>
            <div style={{ fontSize: "10.5px", color: T.muted, marginTop: "2px" }}>
              Parses legacy descriptions into structured fields. Preview only — nothing is written until you commit.
            </div>
          </div>
          {["high", "medium", "low"].map(c => counts[c] ? (
            <span key={c} style={{
              fontSize: "10.5px", fontWeight: 700, color: conf[c], background: confBg[c],
              border: `1px solid ${confBd[c]}`, borderRadius: "6px", padding: "3px 9px",
            }}>{counts[c]} {c}</span>
          ) : null)}
          <button onClick={onClose} style={{ background: "none", border: "none", color: T.muted, cursor: "pointer", fontSize: "18px" }}>×</button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px" }}>
          {rows.map(({ h, heal }) => (
            <div key={h.id} style={{
              background: T.surface2, border: `1px solid ${confBd[heal.confidence]}`,
              borderRadius: "9px", padding: "11px 13px", marginBottom: "8px",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: "9px", flexWrap: "wrap" }}>
                <span style={{
                  fontSize: "9px", fontWeight: 800, letterSpacing: "0.06em",
                  color: conf[heal.confidence], background: confBg[heal.confidence],
                  border: `1px solid ${confBd[heal.confidence]}`, borderRadius: "4px", padding: "2px 6px",
                }}>{heal.confidence.toUpperCase()}</span>
                <span style={{ fontFamily: T.mono, fontSize: "12px", color: T.text }}>{h.description}</span>
              </div>

              <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "8px" }}>
                {heal.matched.type && <Pill small active color={T.violet} bg={T.violetD} bd={T.violetB}>{optLabel("type", heal.matched.type)}</Pill>}
                {heal.matched.taper && <Pill small active color={T.blue} bg={T.blueD} bd={T.blueB}>{optLabel("taper", heal.matched.taper)}</Pill>}
                {heal.matched.colletSize && <Pill small active color={T.teal} bg={T.tealD} bd={T.tealB}>{optLabel("colletSize", heal.matched.colletSize)}</Pill>}
                {heal.matched.length && <Pill small active color={T.muted}>L {heal.matched.length}</Pill>}
                {heal.matched.tapCollet && <Pill small active color={T.amber} bg={T.amberD} bd={T.amberB}>Tap collet</Pill>}
                {heal.matched.hasExtension && (
                  <Pill small active color={T.ext} bg={T.extD} bd={T.extB}>
                    Ext {heal.matched.extColletSize ? optLabel("colletSize", heal.matched.extColletSize) : ""}
                    {heal.matched.extOohIn ? ` ${heal.matched.extOohIn}"` : ""}
                  </Pill>
                )}
              </div>

              {heal.flags.length > 0 && (
                <div style={{ marginTop: "7px" }}>
                  {heal.flags.map((f, i) => (
                    <div key={i} style={{ fontSize: "10.5px", color: conf[heal.confidence] }}>⚠ {f}</div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        <div style={{ padding: "11px 16px", borderTop: `1px solid ${T.border}`, display: "flex", gap: "9px", alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ flex: 1, fontSize: "10.5px", color: T.muted, minWidth: "200px" }}>
            ⚠ Commit fills structured fields only. Descriptions are never rewritten automatically.
          </span>
          <button onClick={onClose} style={{
            padding: "8px 14px", borderRadius: "6px", fontSize: "12px", cursor: "pointer",
            border: `1px solid ${T.border}`, background: "transparent", color: T.muted, fontFamily: T.sans,
          }}>Cancel</button>
          <button style={{
            padding: "8px 16px", borderRadius: "6px", fontSize: "12px", fontWeight: 700,
            cursor: "pointer", border: "none", background: T.blue, color: "#fff", fontFamily: T.sans,
          }}>Commit {counts.high || 0} high-confidence</button>
        </div>
      </div>
    </div>
  );
}

/* ═══ HOLDER LIST ═══════════════════════════════════════════════════════ */
/* ═══ COLLET COLOR EDITOR — assigns colors to the SHARED collet-size
   options, not to any one holder. Every holder using a given collet size
   picks up the same color everywhere its description shows. Lists ALL
   collet sizes (not just ones in use) so colors can be set ahead of time.
   ═══════════════════════════════════════════════════════════════════════ */
function ColletColorEditor({ colletColors, onChange, onClose }) {
  return (
    <div onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.72)", zIndex: 100,
        display: "flex", alignItems: "center", justifyContent: "center", padding: "20px",
      }}>
      <div style={{
        background: T.surface, border: `1px solid ${T.border}`, borderRadius: "12px",
        width: "100%", maxWidth: "420px", maxHeight: "80vh", display: "flex", flexDirection: "column",
      }}>
        <div style={{ padding: "14px 16px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: "10px" }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: "14px", fontWeight: 700 }}>Collet colors</div>
            <div style={{ fontSize: "10.5px", color: T.muted, marginTop: "2px" }}>
              One color per collet size — used everywhere that size's holders show up.
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: T.muted, cursor: "pointer", fontSize: "18px" }}>×</button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px", display: "flex", flexDirection: "column", gap: "12px" }}>
          {OPT.colletSize.map(o => {
            const hex = colletColors?.[o.id] ?? o.color ?? DEFAULT_COLLET_COLOR;
            return (
              <div key={o.id} style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <span style={{ fontFamily: T.mono, fontSize: "12.5px", fontWeight: 700, color: hex, width: "56px", flexShrink: 0 }}>{o.label}</span>
                <ColorPicker value={hex} onChange={v => onChange(o.id, v)} size={17} />
              </div>
            );
          })}
        </div>
        <div style={{ padding: "10px 16px", borderTop: `1px solid ${T.border}`, display: "flex", justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{
            padding: "8px 16px", borderRadius: "6px", fontSize: "12px", fontWeight: 700,
            cursor: "pointer", border: "none", background: T.blue, color: "#fff", fontFamily: T.sans,
          }}>Done</button>
        </div>
      </div>
    </div>
  );
}

/* ═══ HOLDER AUDIT — label-vs-geometry truth check ══════════════════════════
   THE PROBLEM THIS SOLVES (Dan's framing, and it reframes everything):
     CAM reads the GEOMETRY. The operator reads the DESCRIPTION.
   So the dangerous failure isn't geometry drifting — it's the description
   and the geometry telling DIFFERENT STORIES. A holder swapped for a
   near-identical one gets proven out in CAM anyway. A description that lies
   to the operator does not.

   Hence: match on parsed DESCRIPTION + GAUGE LENGTH, not segment-by-segment.
   If both agree, the odds the segments secretly differ are negligible, and
   segment-level diffing would just add noise.

   Tools are GROUPED BY HOLDER so a whole group can be corrected at once —
   the same stale holder is usually referenced in many places.
   ═══════════════════════════════════════════════════════════════════════ */
const TOL_IN = 0.005; // gauge-length tolerance. Beyond this = real drift.

/* Taper variants that are physically the SAME taper: NBT30 (Nikken dual
   contact), BBT30 (Big Plus), and "BT30 Dual Contact" are all a BT30 taper.
   Matching must treat them as equal or naming alone creates false
   mismatches. Claude Code: this derives from the OPT.taper lookup rather
   than hardcoding a taper list — add a taper to the lookup and matching
   picks it up automatically, no constant to maintain. */
const taperBase = (label) => (label || "")
  .replace(/\s*dual\s*contact/i, "")
  .replace(/^[NB](?=BT\d)/i, "")
  .trim()
  .toUpperCase();

// Pulls the comparable tokens out of a free-text description. Deliberately
// narrow — only the parts that identify WHICH holder this is.
function parseForMatch(desc) {
  const U = (desc || "").toUpperCase();
  const out = { taper: null, collet: null, length: null, hasExt: false, extCollet: null };

  // Tapers come from the shared lookup, longest label first so NBT30 wins
  // over BT30 when both would match.
  const taperLabels = OPT.taper.map(t => t.label.toUpperCase().replace(/\s*DUAL CONTACT/i, ""))
    .sort((a, b) => b.length - a.length);
  for (const t of taperLabels) {
    if (U.includes(t)) { out.taper = taperBase(t); break; }
  }

  const sk = U.match(/\bSK\s*(\d{1,2})C?\b/);
  if (sk) out.collet = `SK${sk[1]}`;

  const len = U.match(/SK\s*\d{1,2}C?\s*-?\s*(\d{2,3})\b/);
  if (len) out.length = parseInt(len[1], 10);

  const er = U.match(/\bER\s*(\d{1,2})\b/);
  const extWord = /\bEX(T|TENSION)?\b|\bEX\d|OOH/.test(U);
  if (er && (extWord || sk)) { out.hasExt = true; out.extCollet = `ER${er[1]}`; }
  else if (extWord) out.hasExt = true;

  return out;
}

// Scores a tool's embedded description against the holder record it points
// at. Returns each component so the UI can show WHICH part disagrees —
// "82%" alone isn't actionable.
function scoreDescription(desc, holder, normalizeTaper = true) {
  const p = parseForMatch(desc);
  const hTaperRaw = optLabel("taper", holder.taper) || "";
  const hTaper = normalizeTaper ? taperBase(hTaperRaw) : hTaperRaw.toUpperCase();
  const hCollet = optLabel("colletSize", holder.colletSize) || null;
  const hExtCollet = optLabel("colletSize", holder.extColletSize) || null;

  const parts = [
    { name: "Taper", got: p.taper, want: normalizeTaper ? taperBase(hTaperRaw) : hTaper },
    { name: "Collet", got: p.collet, want: hCollet },
    { name: "Length", got: p.length, want: holder.length ?? null },
    { name: "Extension", got: p.hasExt, want: !!holder.hasExtension },
  ];
  if (holder.hasExtension || p.hasExt) {
    parts.push({ name: "Ext collet", got: p.extCollet, want: hExtCollet });
  }

  const scored = parts.map(x => {
    // A component both sides leave blank isn't a disagreement.
    if ((x.got == null || x.got === "") && (x.want == null || x.want === "")) return { ...x, ok: true, na: true };
    return { ...x, ok: String(x.got) === String(x.want) };
  });
  const applicable = scored.filter(x => !x.na);
  const pct = applicable.length ? Math.round((applicable.filter(x => x.ok).length / applicable.length) * 100) : 100;
  return { pct, parts: scored };
}

// Gauge comparison is always done in INCHES so a mm-native holder and an
// inch-native snapshot compare correctly against one shared tolerance.
function scoreGauge(snapshotGaugeIn, holder) {
  const currentIn = asInches(deriveGaugeLength(holder.segments), holder.unit);
  const delta = snapshotGaugeIn - currentIn;
  return { currentIn, snapshotIn: snapshotGaugeIn, delta, within: Math.abs(delta) <= TOL_IN };
}

/* Verdict, ordered by Dan's risk model — NOT by size of difference.
   A 100%-description tool whose geometry drifted is SAFE to bulk-fix.
   A tool whose description disagrees with its holder is DANGEROUS no
   matter how small the number, because the operator and the CAM are
   reading two different things. */
function verdictOf(descScore, gaugeScore) {
  if (descScore.pct < 100) {
    return gaugeScore.within
      ? { key: "conflict", label: "Description conflict", color: T.red, bg: T.redD, bd: T.redB,
          note: "Geometry matches this holder but the description doesn't. The operator would read something different from what CAM cut." }
      : { key: "unmatched", label: "Unmatched", color: T.red, bg: T.redD, bd: T.redB,
          note: "Neither description nor gauge length matches. This is probably a different holder — relink manually." };
  }
  if (!gaugeScore.within) {
    return { key: "stale", label: "Stale geometry", color: T.amber, bg: T.amberD, bd: T.amberB,
      note: "Description matches; the holder was refined since this tool was made. Safe to re-stamp." };
  }
  return { key: "ok", label: "OK", color: T.green, bg: T.greenD, bd: T.greenB, note: null };
}

/* ═══ MOCK TOOL SNAPSHOTS ═══════════════════════════════════════════════════
   ⚠️ Claude Code: THIS DATA IS FABRICATED — the mockup has no tool library.
   Each entry is a real holder's geometry deliberately perturbed to produce
   one of the verdict cases, so the UI can be judged against realistic
   shapes. Replace entirely with real tool records; keep nothing here.
   `snapshotDesc` = the description frozen INTO the tool by Fusion.
   `snapshotGaugeIn` = the gauge length frozen into the tool, in inches.
   ═══════════════════════════════════════════════════════════════════════ */
const MOCK_TOOLS = [
  // h-001 · NBT30-SK13C-60 · true gauge 54.999mm = 2.1653in
  { id: "T-1042", name: '1/4" 4FL Carbide EM', holderId: "h-001", snapshotDesc: "NBT30-SK13C-60", snapshotGaugeIn: 2.1653 },
  { id: "T-1088", name: '3/8" 3FL Rougher', holderId: "h-001", snapshotDesc: "NBT30-SK13C-60", snapshotGaugeIn: 2.1671 },
  { id: "T-1120", name: '#7 Cobalt Drill', holderId: "h-001", snapshotDesc: "NBT30-SK13C-60", snapshotGaugeIn: 2.2050 },
  // ⚠️ label says -60, geometry is the -120. The dangerous case.
  { id: "T-1155", name: '1/2" Finisher', holderId: "h-001", snapshotDesc: "NBT30-SK13C-120", snapshotGaugeIn: 2.1653 },

  // h-004 · NBT30-SK13C-120 · true gauge 108.0mm = 4.2520in
  { id: "T-2010", name: '1/4" Long Reach EM', holderId: "h-004", snapshotDesc: "NBT30-SK13C-120", snapshotGaugeIn: 4.2520 },
  { id: "T-2044", name: "6mm Ball Nose", holderId: "h-004", snapshotDesc: "NBT30-SK13C-120", snapshotGaugeIn: 4.1732 },

  // h-002 · NBT30-SK13C-60 w/ ER8 EXT 1.2OOH · true gauge 85.479mm = 3.3653in
  { id: "T-3001", name: '1/8" Micro EM', holderId: "h-002", snapshotDesc: "NBT30-SK13C-60 w/ ER8 EXT 1.2OOH", snapshotGaugeIn: 3.3653 },
  // ⚠️ description dropped the extension entirely
  { id: "T-3077", name: "2mm Drill", holderId: "h-002", snapshotDesc: "NBT30-SK13C-60", snapshotGaugeIn: 3.3653 },

  // h-003 · NBT30-SK20C-90 ER16 ... · true gauge 139.878mm = 5.5070in
  { id: "T-4200", name: '3/4" Shell Mill Arbor', holderId: "h-003", snapshotDesc: "NBT30-SK20C-90 ER16 EX OOH 2.2 Shank .75", snapshotGaugeIn: 5.5070 },
  { id: "T-4231", name: "12mm Roughing EM", holderId: "h-003", snapshotDesc: "NBT30-SK20C-90 ER16 EX OOH 2.2 Shank .75", snapshotGaugeIn: 5.4102 },
];

function AuditView({ holders, colletColors, onClose }) {
  const [normalizeTaper, setNormalizeTaper] = useState(true);
  const [expanded, setExpanded] = useState({});
  const [fixed, setFixed] = useState({});   // demo-only: tracks re-stamped tools

  // Score every tool against the holder it points at, then group by holder.
  const groups = useMemo(() => {
    const byHolder = new Map();
    MOCK_TOOLS.forEach(t => {
      const holder = holders.find(h => h.id === t.holderId);
      if (!holder) return;
      const d = scoreDescription(t.snapshotDesc, holder, normalizeTaper);
      const g = scoreGauge(t.snapshotGaugeIn, holder);
      const v = fixed[t.id]
        ? { key: "ok", label: "OK", color: T.green, bg: T.greenD, bd: T.greenB, note: null }
        : verdictOf(d, g);
      if (!byHolder.has(holder.id)) byHolder.set(holder.id, { holder, tools: [] });
      byHolder.get(holder.id).tools.push({ ...t, d, g, v });
    });
    const RANK = { conflict: 0, unmatched: 1, stale: 2, ok: 3 };
    return [...byHolder.values()].map(grp => {
      grp.tools.sort((a, b) => RANK[a.v.key] - RANK[b.v.key]);
      grp.counts = grp.tools.reduce((a, t) => { a[t.v.key] = (a[t.v.key] || 0) + 1; return a; }, {});
      grp.worst = Math.min(...grp.tools.map(t => RANK[t.v.key]));
      return grp;
    }).sort((a, b) => a.worst - b.worst);
  }, [holders, normalizeTaper, fixed]);

  const totals = groups.reduce((a, g) => {
    Object.entries(g.counts).forEach(([k, v]) => { a[k] = (a[k] || 0) + v; });
    return a;
  }, {});

  const restampGroup = (grp) => {
    const next = { ...fixed };
    grp.tools.filter(t => t.v.key === "stale").forEach(t => { next[t.id] = true; });
    setFixed(next);
  };

  const Stat = ({ n, label, color, bg, bd }) => (
    <div style={{ background: bg, border: `1px solid ${bd}`, borderRadius: "8px", padding: "7px 12px", minWidth: "78px" }}>
      <div style={{ fontFamily: T.mono, fontSize: "19px", fontWeight: 800, color, lineHeight: 1.1 }}>{n || 0}</div>
      <div style={{ fontSize: "9.5px", color: T.muted, marginTop: "1px" }}>{label}</div>
    </div>
  );

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px", flexWrap: "wrap" }}>
        <button onClick={onClose} style={{
          padding: "7px 12px", borderRadius: "7px", fontSize: "12px", cursor: "pointer",
          border: `1px solid ${T.border}`, background: "transparent", color: T.muted, fontFamily: T.sans,
        }}>← Holders</button>
        <div style={{ flex: 1, minWidth: "200px" }}>
          <div style={{ fontSize: "17px", fontWeight: 800 }}>Holder audit</div>
          <div style={{ fontSize: "11px", color: T.muted, marginTop: "2px" }}>
            Does each tool's frozen holder description still match its geometry?
          </div>
        </div>
      </div>

      {/* The safety statement — this is WHY the tool exists */}
      <div style={{
        background: T.redD, border: `1px solid ${T.redB}`, borderRadius: "9px",
        padding: "10px 13px", marginBottom: "12px", fontSize: "11.5px", color: T.text, lineHeight: 1.6,
      }}>
        <strong style={{ color: T.red }}>CAM reads the geometry. The operator reads the description.</strong>
        {" "}When those disagree, the machine and the human are working from different information — that's the
        failure this catches. Geometry drift alone is safe to bulk-fix; a description conflict never is.
      </div>

      <div style={{ display: "flex", gap: "8px", marginBottom: "12px", flexWrap: "wrap", alignItems: "center" }}>
        <Stat n={totals.ok} label="OK" color={T.green} bg={T.greenD} bd={T.greenB} />
        <Stat n={totals.stale} label="Stale geometry" color={T.amber} bg={T.amberD} bd={T.amberB} />
        <Stat n={totals.conflict} label="Desc conflict" color={T.red} bg={T.redD} bd={T.redB} />
        <Stat n={totals.unmatched} label="Unmatched" color={T.red} bg={T.redD} bd={T.redB} />
        <div style={{ flex: 1 }} />
        <label style={{ display: "flex", alignItems: "center", gap: "7px", fontSize: "11px", color: T.muted, cursor: "pointer", maxWidth: "260px" }}>
          <input type="checkbox" checked={normalizeTaper} onChange={e => setNormalizeTaper(e.target.checked)} />
          <span>Treat taper variants as equal
            <span style={{ display: "block", fontSize: "9.5px", color: T.veryMuted }}>NBT30 / BBT30 / Dual Contact = BT30</span>
          </span>
        </label>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        {groups.map(grp => {
          const open = expanded[grp.holder.id];
          const staleCount = grp.counts.stale || 0;
          const badCount = (grp.counts.conflict || 0) + (grp.counts.unmatched || 0);
          return (
            <div key={grp.holder.id} style={{
              background: T.surface2, border: `1px solid ${badCount ? T.redB : T.border}`, borderRadius: "10px",
            }}>
              <div
                onClick={() => setExpanded(p => ({ ...p, [grp.holder.id]: !p[grp.holder.id] }))}
                style={{ display: "flex", alignItems: "center", gap: "10px", padding: "11px 13px", cursor: "pointer", flexWrap: "wrap" }}>
                <span style={{ color: T.muted, fontSize: "11px", width: "10px" }}>{open ? "▾" : "▸"}</span>
                <HolderPill holder={grp.holder} compact colletColors={colletColors} />
                <span style={{ flex: 1 }} />
                {badCount > 0 && (
                  <span style={{ fontSize: "10px", fontWeight: 800, color: T.red, background: T.redD, border: `1px solid ${T.redB}`, borderRadius: "5px", padding: "2px 7px" }}>
                    {badCount} need review
                  </span>
                )}
                {staleCount > 0 && (
                  <span style={{ fontSize: "10px", fontWeight: 800, color: T.amber, background: T.amberD, border: `1px solid ${T.amberB}`, borderRadius: "5px", padding: "2px 7px" }}>
                    {staleCount} stale
                  </span>
                )}
                <span style={{ fontSize: "10.5px", color: T.muted, fontFamily: T.mono }}>{grp.tools.length} tools</span>
                {staleCount > 0 && (
                  <button
                    onClick={e => { e.stopPropagation(); restampGroup(grp); }}
                    title="Only re-stamps the description-matching tools. Conflicts are never touched."
                    style={{
                      padding: "5px 11px", borderRadius: "6px", fontSize: "11px", fontWeight: 700, cursor: "pointer",
                      border: `1px solid ${T.amberB}`, background: T.amberD, color: T.amber, fontFamily: T.sans,
                    }}>Re-stamp {staleCount}</button>
                )}
              </div>

              {open && (
                <div style={{ borderTop: `1px solid ${T.border}`, padding: "4px 0 6px" }}>
                  {grp.tools.map(t => {
                    const failing = t.d.parts.filter(p => !p.ok);
                    return (
                      <div key={t.id} style={{
                        padding: "9px 13px", borderBottom: `1px solid ${T.borderSoft}`,
                        display: "flex", gap: "12px", alignItems: "flex-start", flexWrap: "wrap",
                      }}>
                        <div style={{ minWidth: "150px", flex: 1 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "7px" }}>
                            <span style={{ fontFamily: T.mono, fontSize: "11px", color: T.blue, fontWeight: 700 }}>{t.id}</span>
                            <span style={{ fontSize: "12px", color: T.text }}>{t.name}</span>
                          </div>
                          <div style={{ fontFamily: T.mono, fontSize: "10px", color: T.veryMuted, marginTop: "3px" }}>
                            “{t.snapshotDesc}”
                          </div>
                        </div>

                        {/* Description match — components, not just a % */}
                        <div style={{ minWidth: "170px" }}>
                          <div style={{ fontSize: "9px", fontWeight: 800, letterSpacing: "0.07em", color: T.muted }}>DESCRIPTION</div>
                          <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "2px", flexWrap: "wrap" }}>
                            <span style={{ fontFamily: T.mono, fontSize: "13px", fontWeight: 800, color: t.d.pct === 100 ? T.green : T.red }}>
                              {t.d.pct}%
                            </span>
                            {failing.map(p => (
                              <span key={p.name} style={{
                                fontSize: "9.5px", color: T.red, background: T.redD,
                                border: `1px solid ${T.redB}`, borderRadius: "4px", padding: "1px 5px",
                              }}>{p.name}: {String(p.got ?? "—")} ≠ {String(p.want ?? "—")}</span>
                            ))}
                          </div>
                        </div>

                        {/* Gauge match */}
                        <div style={{ minWidth: "150px" }}>
                          <div style={{ fontSize: "9px", fontWeight: 800, letterSpacing: "0.07em", color: T.muted }}>GAUGE</div>
                          <div style={{ display: "flex", alignItems: "baseline", gap: "6px", marginTop: "2px", fontFamily: T.mono, fontSize: "11px" }}>
                            <span style={{ color: T.veryMuted }}>{t.g.snapshotIn.toFixed(4)}</span>
                            <span style={{ color: T.muted }}>→</span>
                            <span style={{ color: T.text, fontWeight: 700 }}>{t.g.currentIn.toFixed(4)}</span>
                            <span style={{
                              fontSize: "10px", fontWeight: 700,
                              color: t.g.within ? T.green : T.amber,
                            }}>
                              {t.g.delta === 0 ? "exact" : `${t.g.delta > 0 ? "+" : ""}${t.g.delta.toFixed(4)}"`}
                            </span>
                          </div>
                        </div>

                        <div style={{ minWidth: "150px" }}>
                          <span style={{
                            fontSize: "10px", fontWeight: 800, color: t.v.color,
                            background: t.v.bg, border: `1px solid ${t.v.bd}`,
                            borderRadius: "5px", padding: "3px 8px", whiteSpace: "nowrap",
                          }}>{t.v.label}</span>
                          {t.v.note && (
                            <div style={{ fontSize: "9.5px", color: T.muted, marginTop: "4px", lineHeight: 1.5, maxWidth: "220px" }}>
                              {t.v.note}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ fontSize: "10px", color: T.veryMuted, marginTop: "12px", lineHeight: 1.6 }}>
        Tolerance {TOL_IN}" on gauge length. Tool data here is fabricated for the mockup — see the code note.
      </div>
    </div>
  );
}

function HolderList({ holders, onOpen, onHeal, colletColors, onColletColorChange, onViewTools, onAudit }) {
  const [q, setQ] = useState("");
  const [fType, setFType] = useState(null);
  const [fTaper, setFTaper] = useState(null);
  const [fCollet, setFCollet] = useState(null);
  const [fExt, setFExt] = useState(false);
  const [fTap, setFTap] = useState(false);
  const [colorEditorOpen, setColorEditorOpen] = useState(false);
  /* Grouping is ON by default — with 50+ holders across several tapers, a
     flat alphabetical list stops being useful fast. Sorting by a column is
     the escape hatch for "just show me everything by X", so picking a sort
     column AUTO-UNGROUPS: grouped-and-sorted at the same time answers
     neither question clearly. */
  const [grouped, setGrouped] = useState(true);
  const [sortCol, setSortCol] = useState(null);
  const [sortDir, setSortDir] = useState("asc");

  const toggleSort = (col) => {
    if (sortCol === col) {
      setSortDir(d => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortCol(col);
      setSortDir("asc");
      setGrouped(false); // sorting and grouping are mutually exclusive
    }
  };
  const enableGrouping = (on) => {
    setGrouped(on);
    if (on) setSortCol(null); // grouping wins; clear any active column sort
  };

  const visible = useMemo(() => holders.filter(h => {
    if (fType && h.type !== fType) return false;
    if (fTaper && h.taper !== fTaper) return false;
    if (fCollet && h.colletSize !== fCollet) return false;
    if (fExt && !h.hasExtension) return false;
    if (fTap && !h.tapCollet) return false;
    if (q) {
      const hay = [h.description, h.vendor, h.mfg, h.partNo, h.notes, h.location].join(" ").toLowerCase();
      if (!hay.includes(q.toLowerCase())) return false;
    }
    return true;
  }), [holders, q, fType, fTaper, fCollet, fExt, fTap]);

  const usedTapers = [...new Set(holders.map(h => h.taper).filter(Boolean))];
  const usedCollets = [...new Set(holders.map(h => h.colletSize).filter(Boolean))];
  const usedTypes = [...new Set(holders.map(h => h.type).filter(Boolean))];

  /* ── Sorting & grouping ────────────────────────────────────────────────
     Gauge and Ext OOH are compared as NUMBERS in a single common unit, not
     as the formatted strings shown in the cells — a mm-native and an
     inch-native holder in the same list would otherwise sort nonsensically
     against each other (e.g. "85.479" sorting above "1.2"). Everything
     else compares as lowercased text. Nulls always sink to the bottom
     regardless of direction, so "no value" never masquerades as smallest.
     ═══════════════════════════════════════════════════════════════════ */
  const sortValue = (h, col) => {
    switch (col) {
      case "description": return (h.description || "").toLowerCase();
      case "type": return (optLabel("type", h.type) || "").toLowerCase();
      case "taper": return (optLabel("taper", h.taper) || "").toLowerCase();
      case "collet": return (optLabel("colletSize", h.colletSize) || "").toLowerCase();
      case "extOoh": {
        const v = deriveExtensionOoh(h.segments);
        return v == null ? null : asInches(v, h.unit);
      }
      case "gauge": return asInches(deriveGaugeLength(h.segments), h.unit);
      case "location": return (h.location || "").toLowerCase();
      case "tools": return USAGE[h.id] || 0;
      default: return "";
    }
  };

  const compare = (a, b, col, dir) => {
    const av = sortValue(a, col), bv = sortValue(b, col);
    if (av == null && bv == null) return 0;
    if (av == null) return 1;   // nulls sink, regardless of direction
    if (bv == null) return -1;
    const r = typeof av === "number" ? av - bv : String(av).localeCompare(String(bv));
    return dir === "asc" ? r : -r;
  };

  // Group key: taper → collet size → extension collet size (only when the
  // holder actually has an extension). Matches how the shop reaches for a
  // holder: which spindle, then which collet, then which extension.
  const groupKeyOf = (h) => [
    h.taper || "~none",
    h.colletSize || "~none",
    h.hasExtension ? (h.extColletSize || "~ext") : "",
  ].join("|");

  const groupLabelOf = (h) => {
    const parts = [optLabel("taper", h.taper) || "No taper", optLabel("colletSize", h.colletSize) || "No collet"];
    if (h.hasExtension) parts.push(`+ ${optLabel("colletSize", h.extColletSize) || "extension"}`);
    return parts.join(" · ");
  };

  // Returns a flat render list of {kind:'group'|'row'} so the table body can
  // stay a single map — group headers are just rows with a different shape.
  const rows = useMemo(() => {
    if (!grouped) {
      const list = [...visible];
      if (sortCol) list.sort((a, b) => compare(a, b, sortCol, sortDir));
      return list.map(h => ({ kind: "row", h }));
    }
    const groups = new Map();
    visible.forEach(h => {
      const k = groupKeyOf(h);
      if (!groups.has(k)) groups.set(k, { label: groupLabelOf(h), items: [] });
      groups.get(k).items.push(h);
    });
    // Groups themselves ordered by their label; within a group, always
    // smallest gauge length first (the stated rule) regardless of sortDir.
    const out = [];
    [...groups.entries()]
      .sort((a, b) => a[1].label.localeCompare(b[1].label))
      .forEach(([k, g]) => {
        g.items.sort((a, b) => asInches(deriveGaugeLength(a.segments), a.unit) - asInches(deriveGaugeLength(b.segments), b.unit));
        out.push({ kind: "group", key: k, label: g.label, count: g.items.length });
        g.items.forEach(h => out.push({ kind: "row", h }));
      });
    return out;
  }, [visible, grouped, sortCol, sortDir]);

  const th = {
    fontSize: "9.5px", fontWeight: 800, letterSpacing: "0.07em", textTransform: "uppercase",
    color: T.muted, textAlign: "left", padding: "0 10px 8px", whiteSpace: "nowrap",
  };
  const td = { padding: "9px 10px", fontSize: "12.5px", borderTop: `1px solid ${T.borderSoft}` };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px", flexWrap: "wrap" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: "18px", fontWeight: 800 }}>Holders</h2>
          <div style={{ fontSize: "11.5px", color: T.muted, marginTop: "2px" }}>
            {holders.length} holders · app-owned, pushed to Fusion
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <button onClick={onAudit} style={{
          padding: "8px 13px", borderRadius: "7px", fontSize: "12px", fontWeight: 600,
          cursor: "pointer", border: `1px solid ${T.redB}`, background: T.redD,
          color: T.red, fontFamily: T.sans,
        }}>Audit tools…</button>
        <button onClick={onHeal} style={{
          padding: "8px 13px", borderRadius: "7px", fontSize: "12px", fontWeight: 600,
          cursor: "pointer", border: `1px solid ${T.amberB}`, background: T.amberD,
          color: T.amber, fontFamily: T.sans,
        }}>Normalize names…</button>
        <button style={{
          padding: "8px 15px", borderRadius: "7px", fontSize: "12px", fontWeight: 700,
          cursor: "pointer", border: "none", background: T.blue, color: "#fff", fontFamily: T.sans,
        }}>+ New holder</button>
      </div>

      {/* Search + filters */}
      <div style={{ marginBottom: "12px" }}>
        <input style={{ ...inputStyle, marginBottom: "9px" }} value={q} onChange={e => setQ(e.target.value)}
          placeholder="Search description, vendor, part number, notes…" />
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: "9.5px", fontWeight: 800, letterSpacing: "0.07em", color: T.muted, marginRight: "2px" }}>TYPE</span>
          {usedTypes.map(t => (
            <Pill key={t} small active={fType === t} color={T.violet} bg={T.violetD} bd={T.violetB}
              onClick={() => setFType(fType === t ? null : t)}>{optLabel("type", t)}</Pill>
          ))}
          <span style={{ width: "1px", alignSelf: "stretch", background: T.border, margin: "0 4px" }} />
          <span style={{ fontSize: "9.5px", fontWeight: 800, letterSpacing: "0.07em", color: T.muted, marginRight: "2px" }}>TAPER</span>
          {usedTapers.map(t => (
            <Pill key={t} small active={fTaper === t} color={T.blue} bg={T.blueD} bd={T.blueB}
              onClick={() => setFTaper(fTaper === t ? null : t)}>{optLabel("taper", t)}</Pill>
          ))}
        </div>
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center", marginTop: "7px" }}>
          <span style={{ fontSize: "9.5px", fontWeight: 800, letterSpacing: "0.07em", color: T.muted, marginRight: "2px" }}>COLLET</span>
          {usedCollets.map(c => {
            const hex = colletColors?.[c] ?? optById("colletSize", c)?.color ?? DEFAULT_COLLET_COLOR;
            return (
              <Pill key={c} small active={fCollet === c} color={hex} bg={hex + "22"} bd={hex + "55"}
                onClick={() => setFCollet(fCollet === c ? null : c)}>{optLabel("colletSize", c)}</Pill>
            );
          })}
          <button onClick={() => setColorEditorOpen(true)} title="Edit collet colors" style={{
            display: "flex", alignItems: "center", gap: "5px",
            padding: "3px 9px", borderRadius: "20px", fontSize: "10.5px", fontWeight: 600,
            border: `1px dashed ${T.border}`, background: "transparent", color: T.muted,
            cursor: "pointer", fontFamily: T.sans,
          }}>
            <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: `conic-gradient(${THEME_COLORS.map(c => c.hex).join(",")})` }} />
            Edit colors
          </button>
          <span style={{ width: "1px", alignSelf: "stretch", background: T.border, margin: "0 4px" }} />
          <Pill small active={fExt} color={T.ext} bg={T.extD} bd={T.extB} onClick={() => setFExt(!fExt)}>Has extension</Pill>
          <Pill small active={fTap} color={T.amber} bg={T.amberD} bd={T.amberB} onClick={() => setFTap(!fTap)}>Tap collet</Pill>
        </div>
      </div>

      {colorEditorOpen && (
        <ColletColorEditor
          colletColors={colletColors} onChange={onColletColorChange}
          onClose={() => setColorEditorOpen(false)}
        />
      )}

      {/* Table — the toolbar sits OUTSIDE the scroll box so it stays put,
          and the scroll box gets an explicit maxHeight. That height limit is
          what makes the sticky header work at all: `overflowX: auto` alone
          creates a horizontal scroll context with no vertical bound, so
          `position: sticky` would anchor to a container that never scrolls
          vertically and appear to do nothing. */}
      <div style={{ background: T.surface2, border: `1px solid ${T.border}`, borderRadius: "10px", padding: "12px 4px 4px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "0 10px 10px", flexWrap: "wrap" }}>
          <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11.5px", fontWeight: 600, cursor: "pointer", color: grouped ? T.text : T.muted }}>
            <input type="checkbox" checked={grouped} onChange={e => enableGrouping(e.target.checked)} />
            Group by taper · collet · extension
          </label>
          {grouped && <span style={{ fontSize: "10px", color: T.veryMuted }}>within each group: smallest gauge first</span>}
          {sortCol && (
            <>
              <span style={{ fontSize: "10px", color: T.veryMuted }}>
                sorted by {sortCol} {sortDir === "asc" ? "↑" : "↓"}
              </span>
              <button onClick={() => { setSortCol(null); enableGrouping(true); }} style={{
                padding: "2px 8px", borderRadius: "5px", fontSize: "10px", fontWeight: 600,
                cursor: "pointer", border: `1px solid ${T.border}`, background: "transparent",
                color: T.muted, fontFamily: T.sans,
              }}>Clear sort</button>
            </>
          )}
        </div>
        <div style={{ overflow: "auto", maxHeight: "calc(100vh - 340px)", minHeight: "160px" }}>
        {/* borderCollapse MUST be `separate` here: in `collapse` mode
            browsers don't reliably paint background colors on sticky cells,
            so the group headers went see-through and rows showed under
            them. `separate` + zero spacing looks identical but fixes it. */}
        <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, minWidth: "760px" }}>
          <thead>
            <tr>
              {[
                { key: "description", label: "Description" },
                { key: "type", label: "Type" },
                { key: "taper", label: "Taper" },
                { key: "collet", label: "Collet" },
                { key: "extOoh", label: "Ext OOH" },
                { key: "gauge", label: "Gauge" },
                { key: "location", label: "Location" },
                { key: "tools", label: "Tools", right: true },
              ].map(c => {
                const active = sortCol === c.key;
                return (
                  <th key={c.key}
                    onClick={() => toggleSort(c.key)}
                    title="Click to sort — this ungroups the list"
                    style={{
                      ...th, cursor: "pointer", userSelect: "none",
                      color: active ? T.blue : T.muted,
                      textAlign: c.right ? "right" : "left",
                      /* Sticky needs an OPAQUE background or rows show
                         through as they scroll under it. borderCollapse
                         also drops sticky borders, so the divider is a
                         box-shadow rather than border-bottom. */
                      position: "sticky", top: 0, zIndex: 2,
                      background: T.surface2,
                      boxShadow: `inset 0 -1px 0 ${T.border}`,
                      paddingTop: "8px",
                    }}>
                    {c.label}
                    <span style={{ marginLeft: "4px", opacity: active ? 1 : 0.25 }}>
                      {active ? (sortDir === "asc" ? "↑" : "↓") : "↕"}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              if (r.kind === "group") {
                return (
                  <tr key={`g-${r.key}`}>
                    <td colSpan={8} style={{
                      padding: "7px 10px",
                      /* NOT sticky. Every group header would pin to the same
                         offset and stack on top of each other (and on rows
                         scrolling past) — CSS sticky has no notion of "the
                         previous one should give way". Only the column
                         header sticks. */
                      background: T.raise,
                      borderTop: `1px solid ${T.border}`,
                      borderBottom: `1px solid ${T.border}`,
                    }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>
                        <span style={{ fontSize: "11.5px", fontWeight: 800, letterSpacing: "0.04em", color: T.text }}>{r.label}</span>
                        <span style={{
                          fontFamily: T.mono, fontSize: "9.5px", color: T.muted,
                          background: T.raise, borderRadius: "10px", padding: "1px 7px",
                        }}>{r.count}</span>
                      </span>
                    </td>
                  </tr>
                );
              }
              const h = r.h;
              const ext = deriveExtensionOoh(h.segments);
              const gauge = deriveGaugeLength(h.segments);
              return (
                <tr key={h.id} onClick={() => onOpen(h)} style={{ cursor: "pointer" }}
                  onMouseEnter={e => e.currentTarget.style.background = T.raise}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                  <td style={{ ...td, padding: "6px 10px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "7px" }}>
                      <HolderPill holder={h} compact colletColors={colletColors} />
                      {h.tapCollet && <span style={{ flexShrink: 0, fontSize: "9px", fontWeight: 800, color: T.amber, background: T.amberD, border: `1px solid ${T.amberB}`, borderRadius: "4px", padding: "1px 5px" }}>TAP</span>}
                    </div>
                  </td>
                  <td style={{ ...td, color: T.muted }}>{optLabel("type", h.type) || "—"}</td>
                  <td style={{ ...td, color: T.muted }}>{optLabel("taper", h.taper) || "—"}</td>
                  <td style={{ ...td, color: T.muted }}>{optLabel("colletSize", h.colletSize) || "—"}</td>
                  <td style={{ ...td, fontFamily: T.mono, color: ext != null ? T.ext : T.veryMuted }}>
                    {ext != null ? `${formatLen(asInches(ext, h.unit), "in")}"` : "—"}
                  </td>
                  <td style={{ ...td, fontFamily: T.mono, color: T.muted }}>
                    {formatLen(gauge, h.unit)} <span style={{ color: T.veryMuted, fontSize: "10px" }}>{h.unit}</span>
                  </td>
                  <td style={{ ...td, color: T.veryMuted, fontSize: "11.5px" }}>{h.location || "—"}</td>
                  <td style={{ ...td, textAlign: "right", padding: "6px 10px" }}>
                    {USAGE[h.id] ? (
                      <button
                        onClick={e => { e.stopPropagation(); onViewTools?.(h); }}
                        title={`Show the ${USAGE[h.id]} tools using this holder`}
                        style={{
                          fontFamily: T.mono, fontSize: "12.5px", fontWeight: 700,
                          color: T.blue, background: "transparent", border: "none",
                          cursor: "pointer", padding: "2px 4px", borderRadius: "4px",
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = T.blueD; }}
                        onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
                      >{USAGE[h.id]}</button>
                    ) : (
                      <span style={{ fontFamily: T.mono, fontSize: "12.5px", color: T.veryMuted }}>0</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
        {visible.length === 0 && (
          <div style={{ padding: "24px", textAlign: "center", fontSize: "12px", color: T.muted }}>No holders match.</div>
        )}
      </div>
    </div>
  );
}

// Line-art icon matching the app's existing icon language (thin stroke, no
// fill) — a simple holder silhouette so it reads distinctly from Sync Job's
// chain-link icon at a glance in the rail.
function HolderRailIcon({ size = 26 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 3h8v3.5c0 1-.8 1.8-1.8 1.8h-4.4C8.8 8.3 8 7.5 8 6.5V3Z" />
      <path d="M9.5 8.3v3.2c0 .5.2 1 .5 1.4l1 1.2c.3.4.5.9.5 1.4V21" />
      <path d="M14.5 8.3v3.2c0 .5-.2 1-.5 1.4l-1 1.2c-.3.4-.5.9-.5 1.4V21" />
      <path d="M9.5 21h5" />
    </svg>
  );
}

// The rail's own icon+label item — matches "Sync Job"'s layout exactly:
// icon centered, small caption below, no background except active/hover.
function RailItem({ icon, label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex", flexDirection: "column", alignItems: "center", gap: "6px",
        width: "100%", padding: "12px 6px", background: active ? T.raise : "transparent",
        border: "none", borderRadius: "9px", cursor: "pointer", fontFamily: T.sans,
        color: active ? T.text : T.muted, transition: "background 0.14s",
      }}
    >
      {icon}
      <span style={{ fontSize: "11px", fontWeight: 600 }}>{label}</span>
    </button>
  );
}

/* ═══ APP SHELL ═══════════════════════════════════════════════════════════
   Matches the real ToolDex chrome: a top tab bar (InDex / Materials /
   Vendors / Programs / Settings) and a narrow LEFT ICON RAIL that today
   holds only "Sync Job". Holders is a RAIL ITEM under Sync Job — NOT a new
   top tab, and not the invented text-list sidebar from the earlier draft
   of this mockup. Top tabs are visual-only here (not wired) since they're
   outside this feature's scope; the rail is the real navigation surface
   for this build. ═════════════════════════════════════════════════════ */
function SyncJobIcon({ size = 26 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="7" cy="6" r="2.2" />
      <path d="M7 8.2V15" />
      <path d="M7 15a3 3 0 0 0 3 3h4" />
      <circle cx="16" cy="18" r="2.2" />
    </svg>
  );
}

function TopTab({ label, active }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: "7px", padding: "8px 16px",
      borderRadius: "8px", fontSize: "13.5px", fontWeight: active ? 700 : 500,
      background: active ? T.raise : "transparent",
      color: active ? T.text : T.muted, cursor: "pointer",
    }}>{label}</div>
  );
}

export default function App() {
  const [holders, setHolders] = useState(SEED);
  const [openId, setOpenId] = useState(null);
  const [healing, setHealing] = useState(false);
  const [rail, setRail] = useState("holders"); // this mockup only implements the Holders page
  /* Clicking a "used by N tools" count. In the REAL app this should navigate
     to the InDex tool list with a holder filter applied — Claude Code: wire
     it to whatever the tool list's existing filter mechanism is, and add a
     removable filter chip there naming the holder so the user can see why
     the list is narrowed and can clear it. This mockup has no tool list, so
     it just reports what would happen rather than faking tool rows. */
  const [viewToolsFor, setViewToolsFor] = useState(null);
  const [auditing, setAuditing] = useState(false);

  // Collet colors are a shared, app-wide map — one color per collet SIZE
  // option, not per holder. Seeded from OPT.colletSize's defaults, then
  // fully editable via ColletColorEditor. Claude Code: this is the overlay
  // pattern for the mockup; the real app should make color a real column
  // on the collet-size shared-lookup record (same bin_sizes-style table
  // discussed for Type/Taper/Collet), not a separate override map.
  const [colletColors, setColletColors] = useState(() =>
    Object.fromEntries(OPT.colletSize.map(o => [o.id, o.color]))
  );
  const setColletColor = (id, hex) => setColletColors(prev => ({ ...prev, [id]: hex }));

  const open = holders.find(h => h.id === openId);
  const allLocations = [...new Set(holders.map(h => h.location).filter(Boolean))];

  return (
    <div style={{ background: T.page, minHeight: "100vh", fontFamily: T.sans, color: T.text }}>
      {/* Top bar — logo + existing tabs, unchanged. Visual reference only. */}
      <div style={{
        display: "flex", alignItems: "center", gap: "6px", padding: "12px 20px",
        borderBottom: `1px solid ${T.border}`, background: T.surface,
      }}>
        <div style={{
          width: "30px", height: "30px", borderRadius: "8px", background: T.blue,
          display: "flex", alignItems: "center", justifyContent: "center", marginRight: "6px",
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><path d="M6 3v18M6 3l12 4v10L6 21" /></svg>
        </div>
        <span style={{ fontSize: "17px", fontWeight: 800, marginRight: "18px" }}>
          <span style={{ color: T.text }}>Tool</span><span style={{ color: T.blue }}>Dex</span>
        </span>
        <TopTab label="InDex" active />
        <TopTab label="Materials" />
        <TopTab label="Vendors" />
        <TopTab label="Programs" />
        <TopTab label="Settings" />
      </div>

      <div style={{ display: "flex" }}>
        {/* Left icon rail — Sync Job today, Holders added right below it */}
        <div style={{
          width: "104px", flexShrink: 0, background: T.surface,
          borderRight: `1px solid ${T.border}`, padding: "16px 8px",
          minHeight: "calc(100vh - 55px)", display: "flex", flexDirection: "column", gap: "4px",
        }}>
          <RailItem icon={<SyncJobIcon />} label="Sync Job" active={false} onClick={() => {}} />
          <RailItem icon={<HolderRailIcon />} label="Holders" active={rail === "holders"} onClick={() => setRail("holders")} />
        </div>

        <div style={{ flex: 1, padding: "22px 20px", maxWidth: "1180px", minWidth: 0 }}>
          {viewToolsFor && (
            <div style={{
              background: T.blueD, border: `1px solid ${T.blueB}`, borderRadius: "9px",
              padding: "10px 14px", marginBottom: "12px",
              display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap",
            }}>
              <span style={{ fontSize: "12px", color: T.blue, fontWeight: 700 }}>→ Would open InDex</span>
              <span style={{ fontSize: "11.5px", color: T.muted }}>
                filtered to <strong style={{ color: T.text }}>{viewToolsFor.description}</strong>
                {" "}· {USAGE[viewToolsFor.id] || 0} tools
              </span>
              <span style={{ flex: 1 }} />
              <span style={{ fontSize: "10px", color: T.veryMuted }}>mockup has no tool list — see code note</span>
              <button onClick={() => setViewToolsFor(null)} style={{
                background: "none", border: "none", color: T.muted, cursor: "pointer", fontSize: "15px",
              }}>×</button>
            </div>
          )}
          {auditing ? (
            <AuditView holders={holders} colletColors={colletColors} onClose={() => setAuditing(false)} />
          ) : open ? (
            <HolderDetail
              holder={open}
              allLocations={allLocations}
              colletColors={colletColors}
              onBack={() => setOpenId(null)}
              onViewTools={setViewToolsFor}
              onSave={h => { setHolders(hs => hs.map(x => x.id === h.id ? h : x)); setOpenId(null); }}
            />
          ) : (
            <HolderList
              holders={holders} onOpen={h => setOpenId(h.id)} onHeal={() => setHealing(true)}
              colletColors={colletColors} onColletColorChange={setColletColor}
              onViewTools={setViewToolsFor} onAudit={() => setAuditing(true)}
            />
          )}
        </div>
      </div>

      {healing && <HealerModal holders={holders} onClose={() => setHealing(false)} />}
    </div>
  );
}
