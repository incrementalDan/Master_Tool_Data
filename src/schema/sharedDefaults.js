// Default content for the shared Drive files, used to create them on first run
// (see driveService.loadOrCreateSharedJson). vendor_registry.json's default
// lives in vendorRegistry.js (it's assembled from the existing registry data).

// ─── Material code systems ───────────────────────────────────────────────────
// The material-classification standards we track a code for on each CAM preset
// (and, via the vendor page, the standard a given manufacturer publishes). A
// manufacturer entity's `material_code_system` points at one of these ids so its
// catalog's material codes can be mapped back to our CAM presets.
export const MATERIAL_CODE_SYSTEMS = [
  { id: 'iso_513',   label: 'ISO 513' },
  { id: 'kennametal', label: 'Kennametal' },
  { id: 'vdi_3323',  label: 'Haas / VDI 3323' },
];

// materials.json — the shop's material taxonomy and the single source of
// material in the app. Three tiers:
//   • groups[]    — the standard ISO turning groups (P/M/K/N/S/H); `iso` marks
//                   the standards. `code` is the short token used in preset names
//                   ("SS 2.125 30-SK13-60 - Rough"); `color` tints presets.
//   • presets[]   — CAM presets: the middle layer that becomes the Fusion
//                   speed/feed preset group name. Each carries the equivalent
//                   code in three standards (iso_513 / kennametal / vdi_3323) so
//                   manufacturer charts cross-reference, plus an optional short
//                   `code` (falls back to the group code in preset names).
//   • materials[] — individual alloy records (6061, 316L, …) with `aliases` for
//                   "look it up by the name we know it by," each linked up to a
//                   CAM preset via `preset_id`.
// Seeded from the shop's material reference docs; audit values against the
// charts in /Material REF Docs as needed.
export const DEFAULT_MATERIALS = {
  version: 2,
  groups: [
    { id: 'P', label: 'Steel',            code: 'STEEL', color: '#4A90D9', iso: true, order: 0 },
    { id: 'M', label: 'Stainless Steel',  code: 'SS',    color: '#F5C842', iso: true, order: 1 },
    { id: 'K', label: 'Cast Iron',        code: 'CI',    color: '#E05252', iso: true, order: 2 },
    { id: 'N', label: 'Non-Ferrous',      code: 'AL',    color: '#5BAD6F', iso: true, order: 3 },
    { id: 'S', label: 'High Temp Alloys', code: 'TI',    color: '#C4956A', iso: true, order: 4 },
    { id: 'H', label: 'Hardened Steel',   code: 'HARD',  color: '#888888', iso: true, order: 5 },
  ],
  // CAM presets — the Fusion speed/feed preset group names.
  presets: [
    // N — Non-Ferrous
    { id: 'pre_N_al_wrought',  group_id: 'N', name: 'Al Wrought',             code: '', description: 'Wrought Al alloys — 1100 through 7075',           iso_513: 'N1.2', kennametal: 'N2', vdi_3323: '22', order: 0 },
    { id: 'pre_N_al_cast_low', group_id: 'N', name: 'Al Cast',                code: '', description: 'Cast Al, low-to-mid Si (356, 380)',               iso_513: 'N2.2', kennametal: 'N2', vdi_3323: '23', order: 1 },
    { id: 'pre_N_al_cast_hi',  group_id: 'N', name: 'Al Cast High-Si',        code: '', description: 'Hypereutectic cast Al, Si >12% (390)',            iso_513: 'N2.3', kennametal: 'N3', vdi_3323: '25', order: 2 },
    { id: 'pre_N_brass',       group_id: 'N', name: 'Brass / Cu Alloy',       code: '', description: 'Leaded and non-leaded brass',                    iso_513: 'N3.1', kennametal: 'N4', vdi_3323: '26', order: 3 },
    { id: 'pre_N_copper',      group_id: 'N', name: 'Pure Copper',            code: '', description: 'Electrolytic and pure copper',                   iso_513: 'N3.3', kennametal: 'N4', vdi_3323: '28', order: 4 },
    // P — Steel
    { id: 'pre_P_free',        group_id: 'P', name: 'Steel Free Machining',   code: '', description: 'Leaded & resulfurized (12L14, 1213)',            iso_513: 'P1.3', kennametal: 'P1', vdi_3323: '1', order: 5 },
    { id: 'pre_P_1144',        group_id: 'P', name: 'Steel 1144 Stressproof', code: '', description: 'Resulfurized med-C — Kennametal uses P2',        iso_513: 'P1.1', kennametal: 'P2', vdi_3323: '2', order: 6 },
    { id: 'pre_P_low_c',       group_id: 'P', name: 'Steel Low Carbon',       code: '', description: 'Low-C structural and bar steel (A36, 1018)',     iso_513: 'P2.1', kennametal: 'P0', vdi_3323: '1', order: 7 },
    { id: 'pre_P_med_c',       group_id: 'P', name: 'Steel Med/High Carbon',  code: '', description: 'Med/high-C steel (1045, 1060, 1080)',           iso_513: 'P2.2', kennametal: 'P2', vdi_3323: '4', order: 8 },
    { id: 'pre_P_alloy_soft',  group_id: 'P', name: 'Alloy Steel Soft',       code: '', description: 'Alloy/tool steel annealed (4140, 4340, H13, D2)', iso_513: 'P3.1', kennametal: 'P3', vdi_3323: '6', order: 9 },
    { id: 'pre_P_alloy_28_34', group_id: 'P', name: 'Alloy Steel 28-34 HRC',  code: '', description: 'Pre-hard alloy & mold steel (4140 PH, P20)',     iso_513: 'P3.2', kennametal: 'P3', vdi_3323: '8', order: 10 },
    { id: 'pre_P_alloy_36_42', group_id: 'P', name: 'Alloy Steel 36-42 HRC',  code: '', description: 'Hard alloy steel, Q&T (4140 H&T)',              iso_513: 'P3.3', kennametal: 'P4', vdi_3323: '9', order: 11 },
    // M — Stainless
    { id: 'pre_M_free',        group_id: 'M', name: 'SS Free Machining',      code: '', description: 'Resulfurized stainless (303, 416)',              iso_513: 'M3.1', kennametal: 'M1', vdi_3323: '14', order: 12 },
    { id: 'pre_M_aus_304',     group_id: 'M', name: 'SS Austenitic 304',      code: '', description: '304/321/347 series austenitic',                 iso_513: 'M3.1', kennametal: 'M1', vdi_3323: '14', order: 13 },
    { id: 'pre_M_aus_316',     group_id: 'M', name: 'SS Austenitic 316',      code: '', description: '316/310 Mo-bearing, harder to machine',         iso_513: 'M3.1', kennametal: 'M2', vdi_3323: '14', order: 14 },
    { id: 'pre_M_ferr_mart',   group_id: 'M', name: 'SS Ferritic/Martensitic', code: '', description: '400-series straight-Cr (409, 410, 420, 430)',   iso_513: 'M1.1', kennametal: 'P5', vdi_3323: '12', order: 15 },
    { id: 'pre_M_duplex',      group_id: 'M', name: 'SS Duplex',              code: '', description: 'Duplex & super-austenitic (2205, 904L)',        iso_513: 'M4.1', kennametal: 'M3', vdi_3323: '14', order: 16 },
    { id: 'pre_M_PH',          group_id: 'M', name: 'SS Precipitation Hard',  code: '', description: 'PH stainless (17-4 PH, 15-5 PH, 13-8 PH)',      iso_513: 'M4.2', kennametal: 'P5', vdi_3323: '13', order: 17 },
    // K — Cast Iron
    { id: 'pre_K_gray',        group_id: 'K', name: 'Gray Iron',              code: '', description: 'Gray cast iron, all classes',                   iso_513: 'K1.1', kennametal: 'K1', vdi_3323: '15', order: 18 },
    { id: 'pre_K_ductile',     group_id: 'K', name: 'Ductile Iron',          code: '', description: 'Ductile/nodular iron (60-40-18, 80-55-06)',     iso_513: 'K3.1', kennametal: 'K2', vdi_3323: '17', order: 19 },
    { id: 'pre_K_ductile_hi',  group_id: 'K', name: 'Ductile Iron High Str', code: '', description: 'High strength and ADI ductile iron',           iso_513: 'K3.3', kennametal: 'K3', vdi_3323: '18', order: 20 },
    // S — High Temp Alloys
    { id: 'pre_S_titan',       group_id: 'S', name: 'Titanium',               code: '', description: 'CP Ti and Ti-6Al-4V',                           iso_513: 'S1.2', kennametal: 'S4', vdi_3323: '37', order: 21 },
    { id: 'pre_S_nickel',      group_id: 'S', name: 'Inconel / Ni Alloy',     code: '', description: 'Ni-based superalloys (625, 718, Hastelloy)',    iso_513: 'S3.1', kennametal: 'S3', vdi_3323: '34', order: 22 },
    { id: 'pre_S_fe_hta',      group_id: 'S', name: 'Fe-Based HTA',           code: '', description: 'Fe-based high-temp alloys (A-286)',             iso_513: 'S2.2', kennametal: 'S1', vdi_3323: '31', order: 23 },
    { id: 'pre_S_co_hta',      group_id: 'S', name: 'Co-Based HTA',           code: '', description: 'Co-based high-temp alloys (Stellite)',          iso_513: 'S4.2', kennametal: 'S2', vdi_3323: '33', order: 24 },
    // H — Hardened Steel
    { id: 'pre_H_44_48',       group_id: 'H', name: 'Hardened 44-48 HRC',     code: '', description: 'Lower hard milling',                            iso_513: 'H3.1', kennametal: 'H1', vdi_3323: '38', order: 25 },
    { id: 'pre_H_48_55',       group_id: 'H', name: 'Hardened 48-55 HRC',     code: '', description: 'Mid hard milling',                              iso_513: 'H3.2', kennametal: 'H2', vdi_3323: '38', order: 26 },
    { id: 'pre_H_55_60',       group_id: 'H', name: 'Hardened 55-60 HRC',     code: '', description: 'High hard milling',                             iso_513: 'H4.1', kennametal: 'H3', vdi_3323: '39', order: 27 },
    { id: 'pre_H_60plus',      group_id: 'H', name: 'Hardened >60 HRC',       code: '', description: 'Extreme hard milling',                          iso_513: 'H4.2', kennametal: 'H4', vdi_3323: '39', order: 28 },
  ],
  // Individual alloy records — linked up to a CAM preset via preset_id.
  materials: [
    // N — Non-Ferrous
    { id: 'N_1100',   group_id: 'N', preset_id: 'pre_N_al_wrought',  label: '1100',                 aliases: ['1100-H14', '1100-O', 'pure aluminum'],              category: 'Aluminum – Wrought',     condition: 'any temper',          code: '', iso_513: 'N1.1', kennametal: 'N1', notes: 'Commercially pure Al, gummy to cut', order: 0 },
    { id: 'N_2024',   group_id: 'N', preset_id: 'pre_N_al_wrought',  label: '2024',                 aliases: ['2024-T4', '2024-T351', '24ST'],                     category: 'Aluminum – Wrought',     condition: 'T4',                  code: '', iso_513: 'N1.2', kennametal: 'N2', notes: 'Aerospace Cu-based Al alloy', order: 1 },
    { id: 'N_5052',   group_id: 'N', preset_id: 'pre_N_al_wrought',  label: '5052',                 aliases: ['5052-H32', '5052-H34'],                             category: 'Aluminum – Wrought',     condition: 'H32',                 code: '', iso_513: 'N1.2', kennametal: 'N2', notes: 'Mg-based, good corrosion resistance', order: 2 },
    { id: 'N_6061',   group_id: 'N', preset_id: 'pre_N_al_wrought',  label: '6061',                 aliases: ['6061-T6', '6061-T651', '6061 T6'],                  category: 'Aluminum – Wrought',     condition: 'T6 (~95 HB)',         code: '', iso_513: 'N1.2', kennametal: 'N2', notes: 'Most common structural Al', order: 3 },
    { id: 'N_7075',   group_id: 'N', preset_id: 'pre_N_al_wrought',  label: '7075',                 aliases: ['7075-T6', '7075-T651', '7075-T7351'],               category: 'Aluminum – Wrought',     condition: 'T6 (~150 HB)',        code: '', iso_513: 'N1.3', kennametal: 'N2', notes: 'High strength Zn-Mg-Cu alloy', order: 4 },
    { id: 'N_356',    group_id: 'N', preset_id: 'pre_N_al_cast_low', label: '356 / A356',           aliases: ['356', 'A356', '356.0', 'A356.0'],                   category: 'Aluminum – Cast',        condition: 'T6 typical',          code: '', iso_513: 'N2.2', kennametal: 'N2', notes: 'Al-Si casting alloy, Si ~7%', order: 5 },
    { id: 'N_380',    group_id: 'N', preset_id: 'pre_N_al_cast_low', label: '380 / A380',           aliases: ['380', 'A380', '383', 'A383'],                       category: 'Aluminum – Cast',        condition: 'as cast',             code: '', iso_513: 'N2.2', kennametal: 'N2', notes: 'Most common die cast alloy, Si ~8-9%', order: 6 },
    { id: 'N_390',    group_id: 'N', preset_id: 'pre_N_al_cast_hi',  label: '390 / A390',           aliases: ['390', 'A390', 'hypereutectic Al'],                  category: 'Aluminum – Cast',        condition: 'as cast',             code: '', iso_513: 'N2.3', kennametal: 'N3', notes: 'Si >17%, very abrasive — use PCD', order: 7 },
    { id: 'N_C36000', group_id: 'N', preset_id: 'pre_N_brass',       label: 'C36000',               aliases: ['360 brass', 'free cutting brass', 'CZ121'],         category: 'Brass – Free Cutting',   condition: 'any',                 code: '', iso_513: 'N3.1', kennametal: 'N4', notes: 'Most machinable brass (leaded)', order: 8 },
    { id: 'N_C26000', group_id: 'N', preset_id: 'pre_N_brass',       label: 'C26000',               aliases: ['260 brass', 'cartridge brass', 'yellow brass'],     category: 'Brass',                  condition: 'any',                 code: '', iso_513: 'N3.2', kennametal: 'N4', notes: 'Work hardens more than C36000', order: 9 },
    { id: 'N_C11000', group_id: 'N', preset_id: 'pre_N_copper',      label: 'C11000',               aliases: ['ETP copper', 'electrolytic copper', 'OFHC'],        category: 'Copper',                 condition: 'any',                 code: '', iso_513: 'N3.3', kennametal: 'N4', notes: 'Very gummy — high helix, flood coolant', order: 10 },
    // P — Steel
    { id: 'P_12L14',    group_id: 'P', preset_id: 'pre_P_free',       label: '12L14',                aliases: ['12L13', '12L15'],                                   category: 'Steel – Free Machining', condition: 'as drawn',            code: '', iso_513: 'P1.3', kennametal: 'P1', notes: 'Easiest steel to machine (leaded)', order: 11 },
    { id: 'P_1213',     group_id: 'P', preset_id: 'pre_P_free',       label: '1213 / 1215',          aliases: ['1213', '1215', '1212', '1114'],                     category: 'Steel – Free Machining', condition: 'as drawn',            code: '', iso_513: 'P1.2', kennametal: 'P1', notes: 'Resulfurized/phosphorized, no lead', order: 12 },
    { id: 'P_1144',     group_id: 'P', preset_id: 'pre_P_1144',       label: '1144 Stressproof',     aliases: ['1144', 'Stressproof'],                              category: 'Steel – Free Machining', condition: 'stress relieved',     code: '', iso_513: 'P1.1', kennametal: 'P2', notes: 'Higher C; Kennametal = P2 (not P1)', order: 13 },
    { id: 'P_A36',      group_id: 'P', preset_id: 'pre_P_low_c',      label: 'A36',                  aliases: ['ASTM A36', 'structural steel', 'HRS', 'mild steel'], category: 'Steel – Low Carbon',     condition: 'hot rolled',          code: '', iso_513: 'P2.1', kennametal: 'P0', notes: 'Standard structural grade', order: 14 },
    { id: 'P_1018',     group_id: 'P', preset_id: 'pre_P_low_c',      label: '1018',                 aliases: ['1018 CRS', 'cold rolled steel'],                    category: 'Steel – Low Carbon',     condition: 'cold drawn',          code: '', iso_513: 'P2.1', kennametal: 'P0', notes: 'Most common CRS bar stock', order: 15 },
    { id: 'P_1020',     group_id: 'P', preset_id: 'pre_P_low_c',      label: '1020 / 1025',          aliases: ['1020', '1025', '1020 HRS'],                         category: 'Steel – Low Carbon',     condition: 'normalized',          code: '', iso_513: 'P2.1', kennametal: 'P0', notes: 'Similar to 1018 HRS', order: 16 },
    { id: 'P_1045',     group_id: 'P', preset_id: 'pre_P_med_c',      label: '1045',                 aliases: ['1045 HRS', '1045 normalized', 'C45'],               category: 'Steel – Med Carbon',     condition: 'annealed/normalized', code: '', iso_513: 'P2.2', kennametal: 'P2', notes: 'Versatile; hardenable to ~30 HRC', order: 17 },
    { id: 'P_1060',     group_id: 'P', preset_id: 'pre_P_med_c',      label: '1060 / 1080',          aliases: ['1060', '1065', '1074', '1080', 'spring steel'],     category: 'Steel – High Carbon',    condition: 'annealed',            code: '', iso_513: 'P2.3', kennametal: 'P2', notes: 'Spring/blade range; harder to cut', order: 18 },
    { id: 'P_4130',     group_id: 'P', preset_id: 'pre_P_alloy_soft', label: '4130',                 aliases: ['4130 annealed', 'chromoly', 'Cr-Mo steel'],         category: 'Steel – Alloy',          condition: 'annealed',            code: '', iso_513: 'P3.1', kennametal: 'P3', notes: 'Common aerospace/structural alloy', order: 19 },
    { id: 'P_4140_ann', group_id: 'P', preset_id: 'pre_P_alloy_soft', label: '4140 Annealed',        aliases: ['4140', '4140 annealed', 'chromoly 4140'],           category: 'Steel – Alloy',          condition: 'annealed <220 HB',    code: '', iso_513: 'P3.1', kennametal: 'P3', notes: 'Most versatile alloy steel', order: 20 },
    { id: 'P_4140_PH',  group_id: 'P', preset_id: 'pre_P_alloy_28_34', label: '4140 Prehard',        aliases: ['4140 PH', '4140 prehard', '4140 H&T 28-34 HRC'],     category: 'Steel – Alloy',          condition: 'Q&T 28-34 HRC',       code: '', iso_513: 'P3.2', kennametal: 'P3', notes: 'Pre-hardened mold base stock', order: 21 },
    { id: 'P_4140_hard', group_id: 'P', preset_id: 'pre_P_alloy_36_42', label: '4140 H&T Hard',      aliases: ['4140 H&T 36-42 HRC', '4140 hardened'],              category: 'Steel – Alloy',          condition: 'Q&T 36-42 HRC',       code: '', iso_513: 'P3.3', kennametal: 'P4', notes: 'Approaching H territory', order: 22 },
    { id: 'P_4340',     group_id: 'P', preset_id: 'pre_P_alloy_soft', label: '4340',                 aliases: ['4340 annealed', '300M precursor', 'NiCrMo'],        category: 'Steel – Alloy',          condition: 'annealed',            code: '', iso_513: 'P3.1', kennametal: 'P3', notes: 'Aerospace/defense; tougher than 4140', order: 23 },
    { id: 'P_8620',     group_id: 'P', preset_id: 'pre_P_alloy_soft', label: '8620',                 aliases: ['8620 annealed', 'case hardening steel'],            category: 'Steel – Alloy',          condition: 'annealed',            code: '', iso_513: 'P3.1', kennametal: 'P3', notes: 'Case-hardening gear/shaft steel', order: 24 },
    { id: 'P_4150',     group_id: 'P', preset_id: 'pre_P_alloy_soft', label: '4150',                 aliases: ['4150', '4150 annealed'],                            category: 'Steel – Alloy',          condition: 'annealed',            code: '', iso_513: 'P3.1', kennametal: 'P3', notes: 'Higher C than 4140', order: 25 },
    { id: 'P_P20',      group_id: 'P', preset_id: 'pre_P_alloy_28_34', label: 'P20',                 aliases: ['P-20', 'P20 mold steel', '1.2311'],                 category: 'Steel – Tool',           condition: 'pre-hard 28-34 HRC',  code: '', iso_513: 'P4.2', kennametal: 'P4', notes: 'Standard mold/die steel', order: 26 },
    { id: 'P_H13_soft', group_id: 'P', preset_id: 'pre_P_alloy_soft', label: 'H13 (annealed)',       aliases: ['H-13 soft', 'H13 annealed', '1.2344', 'SKD61'],     category: 'Steel – Tool',           condition: 'annealed <26 HRC',    code: '', iso_513: 'P4.1', kennametal: 'P3', notes: 'Machine soft; harden after', order: 27 },
    { id: 'P_D2_soft',  group_id: 'P', preset_id: 'pre_P_alloy_soft', label: 'D2 (annealed)',        aliases: ['D-2 soft', 'D2 annealed', '1.2379'],                category: 'Steel – Tool',           condition: 'annealed',            code: '', iso_513: 'P4.1', kennametal: 'P3', notes: 'High-Cr cold work; abrasive even soft', order: 28 },
    { id: 'P_O1',       group_id: 'P', preset_id: 'pre_P_alloy_soft', label: 'O1 / W1',              aliases: ['O1', 'W1', 'W2', 'O2', 'oil hardening'],            category: 'Steel – Tool',           condition: 'annealed',            code: '', iso_513: 'P4.1', kennametal: 'P3', notes: 'Oil/water hardening tool steels', order: 29 },
    // M — Stainless
    { id: 'M_409',    group_id: 'M', preset_id: 'pre_M_ferr_mart', label: '409',                  aliases: ['SS409', '409 stainless', '409S'],                   category: 'Stainless – Ferritic',    condition: 'annealed',            code: '', iso_513: 'M1.1', kennametal: 'P5', notes: '⚠️ Kennametal = P5 (not M) for 400-series', order: 30 },
    { id: 'M_430',    group_id: 'M', preset_id: 'pre_M_ferr_mart', label: '430 / 430F',           aliases: ['SS430', '430 stainless', '430F'],                   category: 'Stainless – Ferritic',    condition: 'annealed',            code: '', iso_513: 'M1.1', kennametal: 'P5', notes: '⚠️ Kennametal = P5; magnetic SS', order: 31 },
    { id: 'M_410',    group_id: 'M', preset_id: 'pre_M_ferr_mart', label: '410',                  aliases: ['SS410', '410 stainless', '410S'],                   category: 'Stainless – Martensitic', condition: 'annealed',            code: '', iso_513: 'M2.1', kennametal: 'P5', notes: '⚠️ Kennametal = P5; hardenable to ~40 HRC', order: 32 },
    { id: 'M_416',    group_id: 'M', preset_id: 'pre_M_free',      label: '416',                  aliases: ['SS416', '416 stainless', 'free machining SS'],      category: 'Stainless – Martensitic', condition: 'annealed',            code: '', iso_513: 'M2.1', kennametal: 'P5', notes: 'Easiest SS to machine; resulfurized 410', order: 33 },
    { id: 'M_420',    group_id: 'M', preset_id: 'pre_M_ferr_mart', label: '420 / 420F',           aliases: ['SS420', '420 stainless', '420F'],                   category: 'Stainless – Martensitic', condition: 'annealed',            code: '', iso_513: 'M2.1', kennametal: 'P5', notes: '⚠️ Kennametal = P5; higher C than 410', order: 34 },
    { id: 'M_303',    group_id: 'M', preset_id: 'pre_M_free',      label: '303',                  aliases: ['SS303', '303 stainless', '303Se'],                  category: 'Stainless – Austenitic',  condition: 'annealed',            code: '', iso_513: 'M3.1', kennametal: 'M1', notes: 'Most machinable austenitic SS', order: 35 },
    { id: 'M_304',    group_id: 'M', preset_id: 'pre_M_aus_304',   label: '304 / 304L',           aliases: ['SS304', '304L', '304LN', '18-8', '18/8'],           category: 'Stainless – Austenitic',  condition: 'annealed',            code: '', iso_513: 'M3.1', kennametal: 'M1', notes: 'Most common SS; work hardens aggressively', order: 36 },
    { id: 'M_316',    group_id: 'M', preset_id: 'pre_M_aus_316',   label: '316 / 316L',           aliases: ['SS316', '316L', '316 L', '316LN', '316Ti'],         category: 'Stainless – Austenitic',  condition: 'annealed',            code: '', iso_513: 'M3.1', kennametal: 'M2', notes: 'Mo-bearing; tougher to machine than 304', order: 37 },
    { id: 'M_310',    group_id: 'M', preset_id: 'pre_M_aus_316',   label: '310 / 310S',           aliases: ['SS310', '310S', 'high temp stainless'],             category: 'Stainless – Austenitic',  condition: 'annealed',            code: '', iso_513: 'M3.2', kennametal: 'M2', notes: 'High Ni-Cr; difficult to machine', order: 38 },
    { id: 'M_321',    group_id: 'M', preset_id: 'pre_M_aus_304',   label: '321 / 347',            aliases: ['SS321', '347', '321 stainless'],                    category: 'Stainless – Austenitic',  condition: 'annealed',            code: '', iso_513: 'M3.1', kennametal: 'M1', notes: 'Stabilized grades (Ti or Nb)', order: 39 },
    { id: 'M_2205',   group_id: 'M', preset_id: 'pre_M_duplex',    label: '2205 Duplex',          aliases: ['Duplex 2205', 'S32205', 'F51'],                     category: 'Stainless – Duplex',      condition: 'annealed',            code: '', iso_513: 'M4.1', kennametal: 'M3', notes: 'High strength; harder than 316', order: 40 },
    { id: 'M_904L',   group_id: 'M', preset_id: 'pre_M_duplex',    label: '904L',                 aliases: ['904 L', 'N08904', 'super austenitic'],              category: 'Stainless – Super Aus.',  condition: 'annealed',            code: '', iso_513: 'M4.1', kennametal: 'M3', notes: 'Like very difficult 316', order: 41 },
    { id: 'M_17_4PH', group_id: 'M', preset_id: 'pre_M_PH',        label: '17-4 PH',              aliases: ['630', '17-4PH', 'SS630', 'S17400'],                 category: 'Stainless – PH',          condition: 'H900 (38-44 HRC)',    code: '', iso_513: 'M4.2', kennametal: 'P5', notes: '⚠️ Kennametal = P5; most others = M4', order: 42 },
    { id: 'M_15_5PH', group_id: 'M', preset_id: 'pre_M_PH',        label: '15-5 PH',              aliases: ['15-5PH', 'S15500', 'XM-12'],                        category: 'Stainless – PH',          condition: 'H900 (~40 HRC)',      code: '', iso_513: 'M4.2', kennametal: 'P5', notes: '⚠️ Kennametal = P5; similar to 17-4 PH', order: 43 },
    { id: 'M_13_8PH', group_id: 'M', preset_id: 'pre_M_PH',        label: '13-8 PH',              aliases: ['13-8PH', 'S13800', 'XM-13'],                        category: 'Stainless – PH',          condition: 'H950 (~40 HRC)',      code: '', iso_513: 'M4.2', kennametal: 'P5', notes: '⚠️ Kennametal = P5; aerospace SS', order: 44 },
    // K — Cast Iron
    { id: 'K_gray_soft',    group_id: 'K', preset_id: 'pre_K_gray',       label: 'Gray Iron – Soft',     aliases: ['Class 20', 'Class 25', 'G1800', 'G2500', 'A48 Cl.20'], category: 'Cast Iron – Gray',    condition: 'as cast <180 HB',    code: '', iso_513: 'K1.1', kennametal: 'K1', notes: 'Ferritic; free machining', order: 45 },
    { id: 'K_gray_med',     group_id: 'K', preset_id: 'pre_K_gray',       label: 'Gray Iron – Medium',   aliases: ['Class 30', 'Class 35', 'G3000', 'G3500', 'A48 Cl.30'], category: 'Cast Iron – Gray',    condition: 'as cast 180-240 HB', code: '', iso_513: 'K1.2', kennametal: 'K1', notes: 'Most common automotive gray iron', order: 46 },
    { id: 'K_gray_hard',    group_id: 'K', preset_id: 'pre_K_gray',       label: 'Gray Iron – Hard',     aliases: ['Class 40', 'Class 50', 'G4000', 'A48 Cl.50'],          category: 'Cast Iron – Gray',    condition: 'as cast 240-280 HB', code: '', iso_513: 'K1.3', kennametal: 'K1', notes: 'Pearlitic; harder to machine', order: 47 },
    { id: 'K_ductile_soft', group_id: 'K', preset_id: 'pre_K_ductile',    label: 'Ductile Iron – Ferritic',  aliases: ['60-40-18', '65-45-12', 'GGG-40'],                 category: 'Cast Iron – Ductile', condition: 'annealed <180 HB',   code: '', iso_513: 'K3.1', kennametal: 'K2', notes: 'Nodular graphite; tougher than gray', order: 48 },
    { id: 'K_ductile_med',  group_id: 'K', preset_id: 'pre_K_ductile',    label: 'Ductile Iron – Pearlitic', aliases: ['80-55-06', '100-70-03', 'GGG-70'],                category: 'Cast Iron – Ductile', condition: 'as cast 180-260 HB', code: '', iso_513: 'K3.2', kennametal: 'K2', notes: 'Common hydraulic component grade', order: 49 },
    { id: 'K_ductile_hard', group_id: 'K', preset_id: 'pre_K_ductile_hi', label: 'Ductile Iron – High Str',  aliases: ['120-90-02', 'ADI', 'A897 Grade 3'],               category: 'Cast Iron – Ductile', condition: '>260 HB / austempered', code: '', iso_513: 'K3.3', kennametal: 'K3', notes: 'ADI versions approach H territory', order: 50 },
    // S — High Temp Alloys
    { id: 'S_cpTi',     group_id: 'S', preset_id: 'pre_S_titan',  label: 'CP Titanium',          aliases: ['Ti Grade 1', 'Ti Grade 2', 'R50250'],               category: 'Titanium',            condition: 'annealed <200 HB',    code: '', iso_513: 'S1.1', kennametal: 'S4', notes: '⚠️ ISO 513 = S1; Kennametal Ti = S4', order: 51 },
    { id: 'S_Ti64',     group_id: 'S', preset_id: 'pre_S_titan',  label: 'Ti-6Al-4V',            aliases: ['Ti 6-4', 'Ti64', 'Grade 5', '6AL4V'],               category: 'Titanium',            condition: 'annealed 200-280 HB', code: '', iso_513: 'S1.2', kennametal: 'S4', notes: 'Most common Ti alloy; low SFM, flood only', order: 52 },
    { id: 'S_Ti6242',   group_id: 'S', preset_id: 'pre_S_titan',  label: 'Ti-6-2-4-2',           aliases: ['Ti-6242', 'Ti-6Al-2Sn-4Zr-2Mo', 'beta Ti'],         category: 'Titanium',            condition: '280-360 HB',          code: '', iso_513: 'S1.3', kennametal: 'S4', notes: 'Beta-stabilized; harder than Ti64', order: 53 },
    { id: 'S_In625',    group_id: 'S', preset_id: 'pre_S_nickel', label: 'Inconel 625',          aliases: ['IN625', '625', 'N06625', 'Alloy 625'],              category: 'High Temp – Ni Based', condition: 'annealed <280 HB',   code: '', iso_513: 'S3.1', kennametal: 'S3', notes: 'Work hardens severely; keep sharp', order: 54 },
    { id: 'S_In718',    group_id: 'S', preset_id: 'pre_S_nickel', label: 'Inconel 718',          aliases: ['IN718', '718', 'N07718', 'Alloy 718'],              category: 'High Temp – Ni Based', condition: 'aged 280-350 HB',    code: '', iso_513: 'S3.2', kennametal: 'S3', notes: 'Most common Ni superalloy in machining', order: 55 },
    { id: 'S_HastC276', group_id: 'S', preset_id: 'pre_S_nickel', label: 'Hastelloy C-276',      aliases: ['C276', 'C-276', 'N10276', 'Hastelloy'],             category: 'High Temp – Ni Based', condition: 'annealed ~220 HB',   code: '', iso_513: 'S3.1', kennametal: 'S3', notes: 'Extreme corrosion resist; hard to machine', order: 56 },
    { id: 'S_Waspalloy', group_id: 'S', preset_id: 'pre_S_nickel', label: 'Waspaloy',            aliases: ['Waspalloy', 'N07001'],                              category: 'High Temp – Ni Based', condition: 'aged ~310 HB',       code: '', iso_513: 'S3.2', kennametal: 'S3', notes: 'Aerospace turbine alloy; very tough', order: 57 },
    { id: 'S_A286',     group_id: 'S', preset_id: 'pre_S_fe_hta',  label: 'A-286',               aliases: ['A286', 'Alloy A-286', 'S66286', 'Discaloy'],        category: 'High Temp – Fe Based', condition: 'aged 200-280 HB',    code: '', iso_513: 'S2.2', kennametal: 'S1', notes: '⚠️ Kennametal Fe-based = S1; ISO 513 = S2', order: 58 },
    { id: 'S_Stellite', group_id: 'S', preset_id: 'pre_S_co_hta',  label: 'Stellite 6 / Haynes 25', aliases: ['Stellite', 'Haynes 25', 'L605'],                  category: 'High Temp – Co Based', condition: 'cast ~320 HB',       code: '', iso_513: 'S4.2', kennametal: 'S2', notes: '⚠️ Kennametal Co-based = S2; ISO 513 = S4', order: 59 },
    // H — Hardened Steel
    { id: 'H_44_48',  group_id: 'H', preset_id: 'pre_H_44_48',  label: 'Hardened 44-48 HRC',   aliases: ['H13 hardened', 'P20 hardened', '4340 at 44 HRC'],    category: 'Hardened Steel',       condition: '44-48 HRC',          code: '', iso_513: 'H3.1', kennametal: 'H1', notes: 'Lower hard milling range', order: 60 },
    { id: 'H_48_55',  group_id: 'H', preset_id: 'pre_H_48_55',  label: 'Hardened 48-55 HRC',   aliases: ['H13 at 50 HRC', 'D2 at 52 HRC'],                    category: 'Hardened Steel',       condition: '48-55 HRC',          code: '', iso_513: 'H3.2', kennametal: 'H2', notes: 'Mid hard milling; dedicated toolpath needed', order: 61 },
    { id: 'H_55_60',  group_id: 'H', preset_id: 'pre_H_55_60',  label: 'Hardened 55-60 HRC',   aliases: ['D2 at 58-60', '52100 hardened'],                    category: 'Hardened Steel',       condition: '55-60 HRC',          code: '', iso_513: 'H4.1', kennametal: 'H3', notes: 'High hard milling; CBN preferred', order: 62 },
    { id: 'H_60plus', group_id: 'H', preset_id: 'pre_H_60plus', label: 'Hardened >60 HRC',     aliases: ['D2 max hard', 'RC 60+'],                            category: 'Hardened Steel',       condition: '>60 HRC',            code: '', iso_513: 'H4.2', kennametal: 'H4', notes: 'Extreme; CBN/ceramic only', order: 63 },
  ],
};

// shop_settings.json — shop-wide settings shared by all users via Drive.
export const DEFAULT_SHOP_SETTINGS = {
  version: 1,
  shop_name: '',
  default_units: 'inches',
  machine_number: { start: 30, skip: [98, 99, 100] },
  // Tool ID system — controls how a tool's displayed ID is generated, labelled,
  // and (in proshop mode) linked. The value lives in one stored field: Fusion's
  // native `product-id` (our internal `tool_id`). The mode only changes how
  // that value is produced and shown — there is no second ID field.
  //   mode: location | sequential | type_prefix | size_first | machine_linked
  //         | proshop | other_erp (placeholder, disabled)
  //   separator: joins segments ('-', '.', '/', '_', or '' for none)
  //   start/skip: sequential counter floor + reserved numbers (shared with
  //               machine_number when mode === 'machine_linked')
  //   digits: zero-pad width for the numeric segment
  //   location.{cabinet,drawer}_identifier: 'number' | 'letter' — the format of
  //               the cabinet/drawer inputs in location mode
  tool_id_system: {
    mode: 'proshop',
    separator: '-',
    start: 1000,
    skip: [],
    digits: 4,
    location: {
      cabinet_identifier: 'number',
      drawer_identifier: 'letter',
    },
  },
  // CNC machine models. Each entry: id, model, machine_type, taper, max_rpm,
  // horsepower, through_coolant, through_coolant_psi, order.
  // machine_id on presets links to these entries.
  machines: [],
  default_machine_id: null,
  // Linked Fusion libraries (multi-library support). Each entry is an APS file
  // location: { id: itemId, hubId, projectId, folderId, itemId, fileName, order }.
  // `id` === `itemId` (stable, globally-unique APS file id) is the canonical
  // library_id used to tag a tool's source library and route its writes back.
  // Holder libraries are cross-library (any holder usable on any tool); they are
  // merged and only grouped-by-source in the holder picker. default_tool_library_id
  // is where new tools go (falls back to tool_libraries[0] when null).
  tool_libraries: [],
  holder_libraries: [],
  default_tool_library_id: null,
  // Hide tool types that have no tools in the library from the landing page type grid.
  // All types remain visible in the Add Tool form. Off in demo mode (small sample set).
  hide_unused_tool_types: true,
  // Physical location hierarchy. Each level links to its parent:
  //   station.zone_id, drawer.station_id, bin.drawer_id
  // Tools store tool_location: { zone_id, station_id, drawer_id, bin_id }
  // with only the most-specific assigned level non-null (parents filled in
  // for easy querying). The composed string is written to Fusion's vendor
  // field (the cabinet-location slot).
  location_system: {
    zones:    [],   // { id, label, name, order }
    stations: [],   // { id, zone_id, label, name, order }
    drawers:  [],   // { id, station_id, label, capacity_slots, order }
    bins:     [],   // { id, drawer_id, slot_number, order }
  },
  import: { last_proshop_import: null, last_photo_import_folder_id: null },
  aps: { last_used_hub_id: null, last_used_project_id: null },
  // ISO timestamps set when each step of the initial setup workflow completes.
  // null = not done. Shared across users via Drive (unlike the localStorage flags
  // used for the in-app banner). proshopPhotos is a sub-step of proshopMerged.
  setup_steps: {
    fusionConnected: null,
    metadataConnected: null,
    normalized: null,
    proshopMerged: null,
    proshopPhotos: null,
    machineNumbers: null,
    proshopExported: null,
  },
};
