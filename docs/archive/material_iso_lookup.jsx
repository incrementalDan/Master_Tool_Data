import { useState, useMemo } from "react";

const GRP = {
  P: { badge: "#1D4ED8", bg: "#EFF6FF", label: "Steel" },
  M: { badge: "#92400E", bg: "#FFFBEB", label: "Stainless" },
  K: { badge: "#B91C1C", bg: "#FEF2F2", label: "Cast Iron" },
  N: { badge: "#166534", bg: "#F0FDF4", label: "Non-Ferrous" },
  S: { badge: "#C2410C", bg: "#FFF7ED", label: "High Temp" },
  H: { badge: "#374151", bg: "#F9FAFB", label: "Hardened" },
};

// ── PRESETS — the Fusion "Name" layer ───────────────────────────
const PRESETS = [
  // N
  {id:"pre_N_al_wrought",   name:"Al Wrought",             g:"N", desc:"Wrought Al alloys — 1100 through 7075",           iso513:"N1.2", k:"N2", vdi:"22", mat_ids:["N_1100","N_2024","N_5052","N_6061","N_7075"]},
  {id:"pre_N_al_cast_low",  name:"Al Cast",                g:"N", desc:"Cast Al, low-to-mid Si (356, 380)",               iso513:"N2.2", k:"N2", vdi:"23", mat_ids:["N_356","N_380"]},
  {id:"pre_N_al_cast_hi",   name:"Al Cast High-Si",        g:"N", desc:"Hypereutectic cast Al, Si >12% (390)",            iso513:"N2.3", k:"N3", vdi:"25", mat_ids:["N_390"]},
  {id:"pre_N_brass",        name:"Brass / Cu Alloy",       g:"N", desc:"Leaded and non-leaded brass",                    iso513:"N3.1", k:"N4", vdi:"26", mat_ids:["N_C36000","N_C26000"]},
  {id:"pre_N_copper",       name:"Pure Copper",            g:"N", desc:"Electrolytic and pure copper",                   iso513:"N3.3", k:"N4", vdi:"28", mat_ids:["N_C11000"]},
  // P
  {id:"pre_P_free",         name:"Steel Free Machining",   g:"P", desc:"Leaded & resulfurized (12L14, 1213)",            iso513:"P1.3", k:"P1", vdi:"1", mat_ids:["P_12L14","P_1213"]},
  {id:"pre_P_1144",         name:"Steel 1144 Stressproof", g:"P", desc:"Resulfurized med-C — Kennametal uses P2",        iso513:"P1.1", k:"P2", vdi:"2", mat_ids:["P_1144"]},
  {id:"pre_P_low_c",        name:"Steel Low Carbon",       g:"P", desc:"Low-C structural and bar steel (A36, 1018)",     iso513:"P2.1", k:"P0", vdi:"1", mat_ids:["P_A36","P_1018","P_1020"]},
  {id:"pre_P_med_c",        name:"Steel Med/High Carbon",  g:"P", desc:"Med/high-C steel (1045, 1060, 1080)",           iso513:"P2.2", k:"P2", vdi:"4", mat_ids:["P_1045","P_1060"]},
  {id:"pre_P_alloy_soft",   name:"Alloy Steel Soft",       g:"P", desc:"Alloy/tool steel annealed (4140, 4340, H13, D2)",iso513:"P3.1", k:"P3", vdi:"6", mat_ids:["P_4130","P_4140_ann","P_4340","P_8620","P_4150","P_H13_soft","P_D2_soft","P_O1"]},
  {id:"pre_P_alloy_28_34",  name:"Alloy Steel 28-34 HRC", g:"P", desc:"Pre-hard alloy & mold steel (4140 PH, P20)",     iso513:"P3.2", k:"P3", vdi:"8", mat_ids:["P_4140_PH","P_P20"]},
  {id:"pre_P_alloy_36_42",  name:"Alloy Steel 36-42 HRC", g:"P", desc:"Hard alloy steel, Q&T (4140 H&T)",              iso513:"P3.3", k:"P4", vdi:"9", mat_ids:["P_4140_hard"]},
  // M
  {id:"pre_M_free",         name:"SS Free Machining",      g:"M", desc:"Resulfurized stainless (303, 416)",              iso513:"M3.1", k:"M1", vdi:"14", mat_ids:["M_303","M_416"]},
  {id:"pre_M_aus_304",      name:"SS Austenitic 304",      g:"M", desc:"304/321/347 series austenitic",                 iso513:"M3.1", k:"M1", vdi:"14", mat_ids:["M_304","M_321"]},
  {id:"pre_M_aus_316",      name:"SS Austenitic 316",      g:"M", desc:"316/310 Mo-bearing, harder to machine",         iso513:"M3.1", k:"M2", vdi:"14", mat_ids:["M_316","M_310"]},
  {id:"pre_M_ferr_mart",    name:"SS Ferritic/Martensitic",g:"M", desc:"400-series straight-Cr (409, 410, 420, 430)",   iso513:"M1.1", k:"P5", vdi:"12", mat_ids:["M_409","M_430","M_410","M_420"]},
  {id:"pre_M_duplex",       name:"SS Duplex",              g:"M", desc:"Duplex & super-austenitic (2205, 904L)",        iso513:"M4.1", k:"M3", vdi:"14", mat_ids:["M_2205","M_904L"]},
  {id:"pre_M_PH",           name:"SS Precipitation Hard",  g:"M", desc:"PH stainless (17-4 PH, 15-5 PH, 13-8 PH)",    iso513:"M4.2", k:"P5", vdi:"13", mat_ids:["M_17_4PH","M_15_5PH","M_13_8PH"]},
  // K
  {id:"pre_K_gray",         name:"Gray Iron",              g:"K", desc:"Gray cast iron, all classes",                   iso513:"K1.1", k:"K1", vdi:"15", mat_ids:["K_gray_soft","K_gray_med","K_gray_hard"]},
  {id:"pre_K_ductile",      name:"Ductile Iron",           g:"K", desc:"Ductile/nodular iron (60-40-18, 80-55-06)",    iso513:"K3.1", k:"K2", vdi:"17", mat_ids:["K_ductile_soft","K_ductile_med"]},
  {id:"pre_K_ductile_hi",   name:"Ductile Iron High Str",  g:"K", desc:"High strength and ADI ductile iron",           iso513:"K3.3", k:"K3", vdi:"18", mat_ids:["K_ductile_hard"]},
  // S
  {id:"pre_S_titan",        name:"Titanium",               g:"S", desc:"CP Ti and Ti-6Al-4V",                           iso513:"S1.2", k:"S4", vdi:"37", mat_ids:["S_cpTi","S_Ti64","S_Ti6242"]},
  {id:"pre_S_nickel",       name:"Inconel / Ni Alloy",     g:"S", desc:"Ni-based superalloys (625, 718, Hastelloy)",   iso513:"S3.1", k:"S3", vdi:"34", mat_ids:["S_In625","S_In718","S_HastC276","S_Waspalloy"]},
  {id:"pre_S_fe_hta",       name:"Fe-Based HTA",           g:"S", desc:"Fe-based high-temp alloys (A-286)",            iso513:"S2.2", k:"S1", vdi:"31", mat_ids:["S_A286"]},
  {id:"pre_S_co_hta",       name:"Co-Based HTA",           g:"S", desc:"Co-based high-temp alloys (Stellite)",         iso513:"S4.2", k:"S2", vdi:"33", mat_ids:["S_Stellite"]},
  // H
  {id:"pre_H_44_48",        name:"Hardened 44-48 HRC",     g:"H", desc:"Lower hard milling",                           iso513:"H3.1", k:"H1", vdi:"38", mat_ids:["H_44_48"]},
  {id:"pre_H_48_55",        name:"Hardened 48-55 HRC",     g:"H", desc:"Mid hard milling",                             iso513:"H3.2", k:"H2", vdi:"38", mat_ids:["H_48_55"]},
  {id:"pre_H_55_60",        name:"Hardened 55-60 HRC",     g:"H", desc:"High hard milling",                            iso513:"H4.1", k:"H3", vdi:"39", mat_ids:["H_55_60"]},
  {id:"pre_H_60plus",       name:"Hardened >60 HRC",       g:"H", desc:"Extreme hard milling",                         iso513:"H4.2", k:"H4", vdi:"39", mat_ids:["H_60plus"]},
];

// Build reverse lookup: mat_id → preset_id
const M2P = {};
PRESETS.forEach(p => p.mat_ids.forEach(id => { M2P[id] = p.id; }));

// ── MATERIALS — individual alloy records ────────────────────────
const MAT = [
  // N
  {id:"N_1100",  alloy:"1100",               aliases:["1100-H14","1100-O","pure aluminum"],              cat:"Aluminum – Wrought",    g:"N", cond:"any temper",        d:"N1.1", k:"N1", note:"Commercially pure Al, gummy to cut"},
  {id:"N_2024",  alloy:"2024",               aliases:["2024-T4","2024-T351","24ST"],                     cat:"Aluminum – Wrought",    g:"N", cond:"T4",                d:"N1.2", k:"N2", note:"Aerospace Cu-based Al alloy"},
  {id:"N_5052",  alloy:"5052",               aliases:["5052-H32","5052-H34"],                            cat:"Aluminum – Wrought",    g:"N", cond:"H32",               d:"N1.2", k:"N2", note:"Mg-based, good corrosion resistance"},
  {id:"N_6061",  alloy:"6061",               aliases:["6061-T6","6061-T651","6061 T6"],                  cat:"Aluminum – Wrought",    g:"N", cond:"T6 (~95 HB)",       d:"N1.2", k:"N2", note:"Most common structural Al"},
  {id:"N_7075",  alloy:"7075",               aliases:["7075-T6","7075-T651","7075-T7351"],               cat:"Aluminum – Wrought",    g:"N", cond:"T6 (~150 HB)",      d:"N1.3", k:"N2", note:"High strength Zn-Mg-Cu alloy"},
  {id:"N_356",   alloy:"356 / A356",         aliases:["356","A356","356.0","A356.0"],                   cat:"Aluminum – Cast",       g:"N", cond:"T6 typical",         d:"N2.2", k:"N2", note:"Al-Si casting alloy, Si ~7%"},
  {id:"N_380",   alloy:"380 / A380",         aliases:["380","A380","383","A383"],                       cat:"Aluminum – Cast",       g:"N", cond:"as cast",            d:"N2.2", k:"N2", note:"Most common die cast alloy, Si ~8-9%"},
  {id:"N_390",   alloy:"390 / A390",         aliases:["390","A390","hypereutectic Al"],                 cat:"Aluminum – Cast",       g:"N", cond:"as cast",            d:"N2.3", k:"N3", note:"Si >17%, very abrasive — use PCD"},
  {id:"N_C36000",alloy:"C36000",             aliases:["360 brass","free cutting brass","CZ121"],        cat:"Brass – Free Cutting",  g:"N", cond:"any",               d:"N3.1", k:"N4", note:"Most machinable brass (leaded)"},
  {id:"N_C26000",alloy:"C26000",             aliases:["260 brass","cartridge brass","yellow brass"],    cat:"Brass",                 g:"N", cond:"any",               d:"N3.2", k:"N4", note:"Work hardens more than C36000"},
  {id:"N_C11000",alloy:"C11000",             aliases:["ETP copper","electrolytic copper","OFHC"],       cat:"Copper",                g:"N", cond:"any",               d:"N3.3", k:"N4", note:"Very gummy — high helix, flood coolant"},
  // P
  {id:"P_12L14", alloy:"12L14",              aliases:["12L13","12L15"],                                 cat:"Steel – Free Machining",g:"P", cond:"as drawn",          d:"P1.3", k:"P1", note:"Easiest steel to machine (leaded)"},
  {id:"P_1213",  alloy:"1213 / 1215",        aliases:["1213","1215","1212","1114"],                     cat:"Steel – Free Machining",g:"P", cond:"as drawn",          d:"P1.2", k:"P1", note:"Resulfurized/phosphorized, no lead"},
  {id:"P_1144",  alloy:"1144 Stressproof",   aliases:["1144","Stressproof"],                            cat:"Steel – Free Machining",g:"P", cond:"stress relieved",   d:"P1.1", k:"P2", note:"Higher C; Kennametal = P2 (not P1)"},
  {id:"P_A36",   alloy:"A36",                aliases:["ASTM A36","structural steel","HRS","mild steel"],cat:"Steel – Low Carbon",    g:"P", cond:"hot rolled",         d:"P2.1", k:"P0", note:"Standard structural grade"},
  {id:"P_1018",  alloy:"1018",               aliases:["1018 CRS","cold rolled steel"],                  cat:"Steel – Low Carbon",    g:"P", cond:"cold drawn",         d:"P2.1", k:"P0", note:"Most common CRS bar stock"},
  {id:"P_1020",  alloy:"1020 / 1025",        aliases:["1020","1025","1020 HRS"],                        cat:"Steel – Low Carbon",    g:"P", cond:"normalized",         d:"P2.1", k:"P0", note:"Similar to 1018 HRS"},
  {id:"P_1045",  alloy:"1045",               aliases:["1045 HRS","1045 normalized","C45"],              cat:"Steel – Med Carbon",    g:"P", cond:"annealed/normalized", d:"P2.2", k:"P2", note:"Versatile; hardenable to ~30 HRC"},
  {id:"P_1060",  alloy:"1060 / 1080",        aliases:["1060","1065","1074","1080","spring steel"],      cat:"Steel – High Carbon",   g:"P", cond:"annealed",           d:"P2.3", k:"P2", note:"Spring/blade range; harder to cut"},
  {id:"P_4130",  alloy:"4130",               aliases:["4130 annealed","chromoly","Cr-Mo steel"],        cat:"Steel – Alloy",         g:"P", cond:"annealed",           d:"P3.1", k:"P3", note:"Common aerospace/structural alloy"},
  {id:"P_4140_ann",alloy:"4140 Annealed",    aliases:["4140","4140 annealed","chromoly 4140"],          cat:"Steel – Alloy",         g:"P", cond:"annealed <220 HB",   d:"P3.1", k:"P3", note:"Most versatile alloy steel"},
  {id:"P_4140_PH",alloy:"4140 Prehard",      aliases:["4140 PH","4140 prehard","4140 H&T 28-34 HRC"],  cat:"Steel – Alloy",         g:"P", cond:"Q&T 28-34 HRC",      d:"P3.2", k:"P3", note:"Pre-hardened mold base stock"},
  {id:"P_4140_hard",alloy:"4140 H&T Hard",   aliases:["4140 H&T 36-42 HRC","4140 hardened"],           cat:"Steel – Alloy",         g:"P", cond:"Q&T 36-42 HRC",      d:"P3.3", k:"P4", note:"Approaching H territory"},
  {id:"P_4340",  alloy:"4340",               aliases:["4340 annealed","300M precursor","NiCrMo"],       cat:"Steel – Alloy",         g:"P", cond:"annealed",           d:"P3.1", k:"P3", note:"Aerospace/defense; tougher than 4140"},
  {id:"P_8620",  alloy:"8620",               aliases:["8620 annealed","case hardening steel"],          cat:"Steel – Alloy",         g:"P", cond:"annealed",           d:"P3.1", k:"P3", note:"Case-hardening gear/shaft steel"},
  {id:"P_4150",  alloy:"4150",               aliases:["4150","4150 annealed"],                          cat:"Steel – Alloy",         g:"P", cond:"annealed",           d:"P3.1", k:"P3", note:"Higher C than 4140"},
  {id:"P_P20",   alloy:"P20",                aliases:["P-20","P20 mold steel","1.2311"],                cat:"Steel – Tool",          g:"P", cond:"pre-hard 28-34 HRC", d:"P4.2", k:"P4", note:"Standard mold/die steel"},
  {id:"P_H13_soft",alloy:"H13 (annealed)",   aliases:["H-13 soft","H13 annealed","1.2344","SKD61"],     cat:"Steel – Tool",          g:"P", cond:"annealed <26 HRC",   d:"P4.1", k:"P3", note:"Machine soft; harden after"},
  {id:"P_D2_soft",alloy:"D2 (annealed)",     aliases:["D-2 soft","D2 annealed","1.2379"],               cat:"Steel – Tool",          g:"P", cond:"annealed",           d:"P4.1", k:"P3", note:"High-Cr cold work; abrasive even soft"},
  {id:"P_O1",    alloy:"O1 / W1",            aliases:["O1","W1","W2","O2","oil hardening"],              cat:"Steel – Tool",          g:"P", cond:"annealed",           d:"P4.1", k:"P3", note:"Oil/water hardening tool steels"},
  // M
  {id:"M_409",   alloy:"409",                aliases:["SS409","409 stainless","409S"],                  cat:"Stainless – Ferritic",  g:"M", cond:"annealed",           d:"M1.1", k:"P5", note:"⚠️ Kennametal = P5 (not M) for 400-series"},
  {id:"M_430",   alloy:"430 / 430F",         aliases:["SS430","430 stainless","430F"],                  cat:"Stainless – Ferritic",  g:"M", cond:"annealed",           d:"M1.1", k:"P5", note:"⚠️ Kennametal = P5; magnetic SS"},
  {id:"M_410",   alloy:"410",                aliases:["SS410","410 stainless","410S"],                  cat:"Stainless – Martensitic",g:"M",cond:"annealed",           d:"M2.1", k:"P5", note:"⚠️ Kennametal = P5; hardenable to ~40 HRC"},
  {id:"M_416",   alloy:"416",                aliases:["SS416","416 stainless","free machining SS"],     cat:"Stainless – Martensitic",g:"M",cond:"annealed",           d:"M2.1", k:"P5", note:"Easiest SS to machine; resulfurized 410"},
  {id:"M_420",   alloy:"420 / 420F",         aliases:["SS420","420 stainless","420F"],                  cat:"Stainless – Martensitic",g:"M",cond:"annealed",           d:"M2.1", k:"P5", note:"⚠️ Kennametal = P5; higher C than 410"},
  {id:"M_303",   alloy:"303",                aliases:["SS303","303 stainless","303Se"],                 cat:"Stainless – Austenitic",g:"M", cond:"annealed",           d:"M3.1", k:"M1", note:"Most machinable austenitic SS"},
  {id:"M_304",   alloy:"304 / 304L",         aliases:["SS304","304L","304LN","18-8","18/8"],            cat:"Stainless – Austenitic",g:"M", cond:"annealed",           d:"M3.1", k:"M1", note:"Most common SS; work hardens aggressively"},
  {id:"M_316",   alloy:"316 / 316L",         aliases:["SS316","316L","316 L","316LN","316Ti"],         cat:"Stainless – Austenitic",g:"M", cond:"annealed",           d:"M3.1", k:"M2", note:"Mo-bearing; tougher to machine than 304"},
  {id:"M_310",   alloy:"310 / 310S",         aliases:["SS310","310S","high temp stainless"],            cat:"Stainless – Austenitic",g:"M", cond:"annealed",           d:"M3.2", k:"M2", note:"High Ni-Cr; difficult to machine"},
  {id:"M_321",   alloy:"321 / 347",          aliases:["SS321","347","321 stainless"],                   cat:"Stainless – Austenitic",g:"M", cond:"annealed",           d:"M3.1", k:"M1", note:"Stabilized grades (Ti or Nb)"},
  {id:"M_2205",  alloy:"2205 Duplex",        aliases:["Duplex 2205","S32205","F51"],                    cat:"Stainless – Duplex",    g:"M", cond:"annealed",           d:"M4.1", k:"M3", note:"High strength; harder than 316"},
  {id:"M_904L",  alloy:"904L",               aliases:["904 L","N08904","super austenitic"],             cat:"Stainless – Super Aus.",g:"M", cond:"annealed",           d:"M4.1", k:"M3", note:"Like very difficult 316"},
  {id:"M_17_4PH",alloy:"17-4 PH",           aliases:["630","17-4PH","SS630","S17400"],                 cat:"Stainless – PH",        g:"M", cond:"H900 (38-44 HRC)",   d:"M4.2", k:"P5", note:"⚠️ Kennametal = P5; most others = M4"},
  {id:"M_15_5PH",alloy:"15-5 PH",           aliases:["15-5PH","S15500","XM-12"],                       cat:"Stainless – PH",        g:"M", cond:"H900 (~40 HRC)",     d:"M4.2", k:"P5", note:"⚠️ Kennametal = P5; similar to 17-4 PH"},
  {id:"M_13_8PH",alloy:"13-8 PH",           aliases:["13-8PH","S13800","XM-13"],                       cat:"Stainless – PH",        g:"M", cond:"H950 (~40 HRC)",     d:"M4.2", k:"P5", note:"⚠️ Kennametal = P5; aerospace SS"},
  // K
  {id:"K_gray_soft",alloy:"Gray Iron – Soft",aliases:["Class 20","Class 25","G1800","G2500","A48 Cl.20"],cat:"Cast Iron – Gray",    g:"K", cond:"as cast <180 HB",   d:"K1.1", k:"K1", note:"Ferritic; free machining"},
  {id:"K_gray_med",alloy:"Gray Iron – Medium",aliases:["Class 30","Class 35","G3000","G3500","A48 Cl.30"],cat:"Cast Iron – Gray",   g:"K", cond:"as cast 180-240 HB", d:"K1.2", k:"K1", note:"Most common automotive gray iron"},
  {id:"K_gray_hard",alloy:"Gray Iron – Hard", aliases:["Class 40","Class 50","G4000","A48 Cl.50"],      cat:"Cast Iron – Gray",     g:"K", cond:"as cast 240-280 HB", d:"K1.3", k:"K1", note:"Pearlitic; harder to machine"},
  {id:"K_ductile_soft",alloy:"Ductile Iron – Ferritic",aliases:["60-40-18","65-45-12","GGG-40"],       cat:"Cast Iron – Ductile",  g:"K", cond:"annealed <180 HB",   d:"K3.1", k:"K2", note:"Nodular graphite; tougher than gray"},
  {id:"K_ductile_med",alloy:"Ductile Iron – Pearlitic",aliases:["80-55-06","100-70-03","GGG-70"],      cat:"Cast Iron – Ductile",  g:"K", cond:"as cast 180-260 HB", d:"K3.2", k:"K2", note:"Common hydraulic component grade"},
  {id:"K_ductile_hard",alloy:"Ductile Iron – High Str",aliases:["120-90-02","ADI","A897 Grade 3"],     cat:"Cast Iron – Ductile",  g:"K", cond:">260 HB / austempered",d:"K3.3",k:"K3", note:"ADI versions approach H territory"},
  // S
  {id:"S_cpTi",  alloy:"CP Titanium",        aliases:["Ti Grade 1","Ti Grade 2","R50250"],              cat:"Titanium",              g:"S", cond:"annealed <200 HB",   d:"S1.1", k:"S4", note:"⚠️ ISO 513 = S1; Kennametal Ti = S4"},
  {id:"S_Ti64",  alloy:"Ti-6Al-4V",          aliases:["Ti 6-4","Ti64","Grade 5","6AL4V"],               cat:"Titanium",              g:"S", cond:"annealed 200-280 HB", d:"S1.2", k:"S4", note:"Most common Ti alloy; low SFM, flood only"},
  {id:"S_Ti6242",alloy:"Ti-6-2-4-2",         aliases:["Ti-6242","Ti-6Al-2Sn-4Zr-2Mo","beta Ti"],       cat:"Titanium",              g:"S", cond:"280-360 HB",          d:"S1.3", k:"S4", note:"Beta-stabilized; harder than Ti64"},
  {id:"S_In625", alloy:"Inconel 625",         aliases:["IN625","625","N06625","Alloy 625"],              cat:"High Temp – Ni Based",  g:"S", cond:"annealed <280 HB",   d:"S3.1", k:"S3", note:"Work hardens severely; keep sharp"},
  {id:"S_In718", alloy:"Inconel 718",         aliases:["IN718","718","N07718","Alloy 718"],              cat:"High Temp – Ni Based",  g:"S", cond:"aged 280-350 HB",    d:"S3.2", k:"S3", note:"Most common Ni superalloy in machining"},
  {id:"S_HastC276",alloy:"Hastelloy C-276",  aliases:["C276","C-276","N10276","Hastelloy"],             cat:"High Temp – Ni Based",  g:"S", cond:"annealed ~220 HB",   d:"S3.1", k:"S3", note:"Extreme corrosion resist; hard to machine"},
  {id:"S_Waspalloy",alloy:"Waspaloy",        aliases:["Waspalloy","N07001"],                            cat:"High Temp – Ni Based",  g:"S", cond:"aged ~310 HB",       d:"S3.2", k:"S3", note:"Aerospace turbine alloy; very tough"},
  {id:"S_A286",  alloy:"A-286",              aliases:["A286","Alloy A-286","S66286","Discaloy"],        cat:"High Temp – Fe Based",  g:"S", cond:"aged 200-280 HB",    d:"S2.2", k:"S1", note:"⚠️ Kennametal Fe-based = S1; ISO 513 = S2"},
  {id:"S_Stellite",alloy:"Stellite 6 / Haynes 25",aliases:["Stellite","Haynes 25","L605"],             cat:"High Temp – Co Based",  g:"S", cond:"cast ~320 HB",       d:"S4.2", k:"S2", note:"⚠️ Kennametal Co-based = S2; ISO 513 = S4"},
  // H
  {id:"H_44_48", alloy:"Hardened 44-48 HRC", aliases:["H13 hardened","P20 hardened","4340 at 44 HRC"], cat:"Hardened Steel",         g:"H", cond:"44-48 HRC",          d:"H3.1", k:"H1", note:"Lower hard milling range"},
  {id:"H_48_55", alloy:"Hardened 48-55 HRC", aliases:["H13 at 50 HRC","D2 at 52 HRC"],                 cat:"Hardened Steel",         g:"H", cond:"48-55 HRC",          d:"H3.2", k:"H2", note:"Mid hard milling; dedicated toolpath needed"},
  {id:"H_55_60", alloy:"Hardened 55-60 HRC", aliases:["D2 at 58-60","52100 hardened"],                  cat:"Hardened Steel",         g:"H", cond:"55-60 HRC",          d:"H4.1", k:"H3", note:"High hard milling; CBN preferred"},
  {id:"H_60plus",alloy:"Hardened >60 HRC",   aliases:["D2 max hard","RC 60+"],                          cat:"Hardened Steel",         g:"H", cond:">60 HRC",            d:"H4.2", k:"H4", note:"Extreme; CBN/ceramic only"},
];

// Add preset_id to each material
MAT.forEach(m => { m.preset_id = M2P[m.id] || null; });

// Build alloy name lookup for chips in preset view
const MAT_BY_ID = Object.fromEntries(MAT.map(m => [m.id, m]));

const GROUPS = ["ALL","P","M","K","N","S","H"];

export default function MaterialLookup() {
  const [view, setView]       = useState("presets");   // "presets" | "materials"
  const [active, setActive]   = useState("ALL");
  const [search, setSearch]   = useState("");
  const [copied, setCopied]   = useState(false);

  // ── Filtered presets ─────────────────────────────────────────
  const filteredPresets = useMemo(() => {
    const q = search.toLowerCase().trim();
    return PRESETS.filter(p => {
      if (active !== "ALL" && p.g !== active) return false;
      if (!q) return true;
      const matNames = p.mat_ids.map(id => MAT_BY_ID[id]?.alloy || "").join(" ").toLowerCase();
      const matAliases = p.mat_ids.flatMap(id => MAT_BY_ID[id]?.aliases || []).join(" ").toLowerCase();
      return (
        p.name.toLowerCase().includes(q) ||
        p.desc.toLowerCase().includes(q) ||
        p.iso513.toLowerCase().includes(q) ||
        p.k.toLowerCase().includes(q) ||
        p.vdi.toLowerCase().includes(q) ||
        matNames.includes(q) ||
        matAliases.includes(q)
      );
    });
  }, [active, search]);

  // ── Filtered materials ────────────────────────────────────────
  const filteredMats = useMemo(() => {
    const q = search.toLowerCase().trim();
    return MAT.filter(m => {
      if (active !== "ALL" && m.g !== active) return false;
      if (!q) return true;
      return (
        m.alloy.toLowerCase().includes(q) ||
        m.aliases.some(a => a.toLowerCase().includes(q)) ||
        m.cat.toLowerCase().includes(q) ||
        m.note.toLowerCase().includes(q) ||
        m.cond.toLowerCase().includes(q)
      );
    });
  }, [active, search]);

  // ── Copy JSON ─────────────────────────────────────────────────
  const handleCopy = () => {
    const out = {
      presets: PRESETS.map(({ id, name, g, desc, iso513, k, vdi, mat_ids }) => ({
        id, name,
        iso_group: g,
        description: desc,
        manufacturer_codes: { iso_513: iso513, kennametal: k, vdi_3323: vdi },
        material_ids: mat_ids
      })),
      materials: MAT.map(({ id, alloy, aliases, cat, g, cond, preset_id, d, k, note }) => ({
        id, alloy, aliases,
        category: cat,
        iso_group: g,
        condition: cond,
        preset_id,
        manufacturer_codes: { iso_513: d, kennametal: k },
        notes: note
      }))
    };
    navigator.clipboard.writeText(JSON.stringify(out, null, 2))
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); })
      .catch(() => alert("Copy failed — try a different browser"));
  };

  const c = (g) => GRP[g];

  return (
    <div style={{ fontFamily:"system-ui,-apple-system,sans-serif", padding:"16px 16px 24px", fontSize:"13px", color:"#111827" }}>

      {/* ── Header ── */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:"14px", gap:"8px", flexWrap:"wrap" }}>
        <div>
          <div style={{ fontSize:"15px", fontWeight:"600", color:"#111827", marginBottom:"2px" }}>
            Material → ISO Group Lookup
          </div>
          <div style={{ fontSize:"11px", color:"#6B7280" }}>
            {PRESETS.length} cam presets · {MAT.length} materials · 3 code systems: ISO 513 · Kennametal · Haas/VDI 3323
          </div>
        </div>
        <button onClick={handleCopy} style={{
          padding:"7px 14px", background: copied ? "#059669" : "#111827",
          color:"white", border:"none", borderRadius:"6px", cursor:"pointer",
          fontSize:"12px", fontWeight:"600", transition:"background 0.2s", whiteSpace:"nowrap"
        }}>
          {copied ? "✓ Copied!" : "Copy JSON"}
        </button>
      </div>

      {/* ── View toggle ── */}
      <div style={{ display:"flex", gap:"0", marginBottom:"12px", border:"1px solid #E5E7EB", borderRadius:"6px", width:"fit-content", overflow:"hidden" }}>
        {["presets","materials"].map(v => (
          <button key={v} onClick={() => setView(v)} style={{
            padding:"5px 14px", border:"none", cursor:"pointer", fontSize:"12px", fontWeight:"600",
            background: view === v ? "#111827" : "white",
            color: view === v ? "white" : "#6B7280",
          }}>
            {v === "presets" ? `CAM Presets (${PRESETS.length})` : `Materials (${MAT.length})`}
          </button>
        ))}
      </div>

      {/* ── ISO group filter ── */}
      <div style={{ display:"flex", gap:"6px", flexWrap:"wrap", marginBottom:"10px" }}>
        {GROUPS.map(g => {
          const isAll = g === "ALL";
          const color = isAll ? "#374151" : GRP[g].badge;
          const on = active === g;
          return (
            <button key={g} onClick={() => setActive(g)} style={{
              padding:"3px 10px", borderRadius:"999px",
              border:`1.5px solid ${color}`,
              background: on ? color : "transparent",
              color: on ? "white" : color,
              cursor:"pointer", fontSize:"12px", fontWeight:"600"
            }}>
              {isAll ? "All" : `${g} — ${GRP[g].label}`}
            </button>
          );
        })}
      </div>

      {/* ── Search ── */}
      <input
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder={view === "presets"
          ? "Search CAM presets or alloys: Al Wrought · SS 316 · Gray Iron · Inconel..."
          : "Search materials: 6061 · 316L · 4140 · Ti64 · duplex..."}
        style={{
          width:"100%", boxSizing:"border-box", padding:"8px 12px",
          border:"1px solid #D1D5DB", borderRadius:"6px", fontSize:"13px",
          marginBottom:"12px", outline:"none", color:"#111827", background:"white"
        }}
      />

      {/* ── PRESETS VIEW ── */}
      {view === "presets" && (
        <div style={{ display:"flex", flexDirection:"column", gap:"8px" }}>
          {filteredPresets.length === 0 && (
            <div style={{ padding:"32px", textAlign:"center", color:"#9CA3AF" }}>No results for "{search}"</div>
          )}
          {filteredPresets.map(p => {
            const gc = c(p.g);
            const warn = p.k.startsWith("P") && p.g === "M";
            return (
              <div key={p.id} style={{
                border:"1px solid #E5E7EB", borderRadius:"8px",
                borderLeft:`4px solid ${gc.badge}`, background:"white", padding:"10px 14px"
              }}>
                <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:"8px", flexWrap:"wrap" }}>
                  {/* Left: group badge + name */}
                  <div style={{ display:"flex", alignItems:"center", gap:"8px" }}>
                    <span style={{
                      display:"inline-block", padding:"2px 7px", borderRadius:"4px",
                      background: gc.bg, color: gc.badge, fontWeight:"700", fontSize:"12px", whiteSpace:"nowrap"
                    }}>{p.g}</span>
                    <div>
                      <div style={{ fontWeight:"600", fontSize:"14px", color:"#111827" }}>{p.name}</div>
                      <div style={{ fontSize:"11px", color:"#6B7280", marginTop:"1px" }}>{p.desc}</div>
                    </div>
                  </div>
                  {/* Right: codes */}
                  <div style={{ display:"flex", gap:"8px", alignItems:"center", flexShrink:0 }}>
                    <div style={{ textAlign:"center" }}>
                      <div style={{ fontSize:"9px", color:"#9CA3AF", textTransform:"uppercase", letterSpacing:"0.05em" }}>ISO 513</div>
                      <div style={{ fontWeight:"700", fontSize:"14px", color: gc.badge }}>{p.iso513}</div>
                    </div>
                    <div style={{ width:"1px", height:"28px", background:"#E5E7EB" }}/>
                    <div style={{ textAlign:"center" }}>
                      <div style={{ fontSize:"9px", color:"#9CA3AF", textTransform:"uppercase", letterSpacing:"0.05em" }}>Kennametal</div>
                      <div style={{ fontWeight:"700", fontSize:"14px", color: warn ? "#DC2626" : gc.badge }}>
                        {p.k}{warn ? " ⚠️" : ""}
                      </div>
                    </div>
                    <div style={{ width:"1px", height:"28px", background:"#E5E7EB" }}/>
                    <div style={{ textAlign:"center" }}>
                      <div style={{ fontSize:"9px", color:"#9CA3AF", textTransform:"uppercase", letterSpacing:"0.05em" }}>Haas / VDI</div>
                      <div style={{ fontWeight:"700", fontSize:"14px", color: p.vdi === "—" ? "#9CA3AF" : gc.badge }}>{p.vdi}</div>
                    </div>
                  </div>
                </div>
                {/* Material chips */}
                <div style={{ display:"flex", gap:"5px", flexWrap:"wrap", marginTop:"9px" }}>
                  {p.mat_ids.map(mid => {
                    const m = MAT_BY_ID[mid];
                    return (
                      <span key={mid} style={{
                        padding:"2px 8px", borderRadius:"999px", fontSize:"11px", fontWeight:"500",
                        background: gc.bg, color: gc.badge, border:`1px solid ${gc.badge}22`
                      }}>
                        {m ? m.alloy : mid}
                      </span>
                    );
                  })}
                </div>
              </div>
            );
          })}
          <div style={{ fontSize:"11px", color:"#9CA3AF", marginTop:"4px" }}>
            {filteredPresets.length} of {PRESETS.length} presets shown
          </div>
        </div>
      )}

      {/* ── MATERIALS VIEW ── */}
      {view === "materials" && (
        <>
          <div style={{ overflowX:"auto", border:"1px solid #E5E7EB", borderRadius:"8px" }}>
            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:"12px" }}>
              <thead>
                <tr style={{ background:"#F9FAFB", borderBottom:"2px solid #E5E7EB" }}>
                  {["","Alloy / Material","Category","Condition","ISO 513 WMG","Kennametal","CAM Preset","Notes"].map((h,i) => (
                    <th key={i} style={{
                      padding:"7px 9px", textAlign: i>=4&&i<=5 ? "center" : "left",
                      fontWeight:"600", color:"#374151", fontSize:"11px",
                      textTransform:"uppercase", letterSpacing:"0.04em", whiteSpace:"nowrap"
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredMats.length === 0 ? (
                  <tr><td colSpan={8} style={{ padding:"32px", textAlign:"center", color:"#9CA3AF" }}>No results for "{search}"</td></tr>
                ) : filteredMats.map((m, i) => {
                  const gc = GRP[m.g];
                  const warn = m.note.startsWith("⚠️");
                  const preset = PRESETS.find(p => p.id === m.preset_id);
                  return (
                    <tr key={m.id} style={{ borderBottom:"1px solid #F3F4F6", background: i%2===0 ? "white" : "#FAFAFA" }}>
                      <td style={{ padding:"7px 9px", width:"36px" }}>
                        <span style={{ display:"inline-block", padding:"2px 7px", borderRadius:"4px", background:gc.bg, color:gc.badge, fontWeight:"700", fontSize:"12px" }}>{m.g}</span>
                      </td>
                      <td style={{ padding:"7px 9px", minWidth:"130px" }}>
                        <div style={{ fontWeight:"600", color:"#111827" }}>{m.alloy}</div>
                        <div style={{ fontSize:"10px", color:"#9CA3AF", marginTop:"1px" }}>
                          {m.aliases.slice(0,3).join(" · ")}
                        </div>
                      </td>
                      <td style={{ padding:"7px 9px", color:"#374151" }}>{m.cat}</td>
                      <td style={{ padding:"7px 9px", color:"#6B7280", fontSize:"11px", minWidth:"110px" }}>{m.cond}</td>
                      <td style={{ padding:"7px 9px", textAlign:"center", fontWeight:"700", fontSize:"13px", color:gc.badge }}>{m.d}</td>
                      <td style={{ padding:"7px 9px", textAlign:"center", fontWeight:"700", fontSize:"13px", color: warn ? "#DC2626" : gc.badge }}>{m.k}</td>
                      <td style={{ padding:"7px 9px", fontSize:"11px" }}>
                        {preset && (
                          <span style={{ padding:"2px 7px", borderRadius:"4px", background:gc.bg, color:gc.badge, fontWeight:"500" }}>
                            {preset.name}
                          </span>
                        )}
                      </td>
                      <td style={{ padding:"7px 9px", color: warn ? "#92400E" : "#6B7280", fontSize:"11px", minWidth:"160px" }}>{m.note}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop:"8px", fontSize:"11px", color:"#9CA3AF" }}>
            {filteredMats.length} of {MAT.length} shown
          </div>
        </>
      )}
    </div>
  );
}
