/**
 * toolNaming.js — Shop-specific tool description generation
 *
 * Isolated so shops using this software can customize naming conventions
 * without touching core app logic. All functions are pure.
 */

export const THROUGH_COOLANT_VALUES = new Set(["through tool", "air through tool", "flood and through tool"]);

export const FRACS = {
  0.015625:"1/64",0.046875:"3/64",0.078125:"5/64",0.109375:"7/64",0.140625:"9/64",0.171875:"11/64",0.203125:"13/64",0.234375:"15/64",
  0.265625:"17/64",0.296875:"19/64",0.328125:"21/64",0.359375:"23/64",0.390625:"25/64",0.421875:"27/64",0.453125:"29/64",0.484375:"31/64",
  0.515625:"33/64",0.546875:"35/64",0.578125:"37/64",0.609375:"39/64",0.640625:"41/64",0.671875:"43/64",0.703125:"45/64",0.734375:"47/64",
  0.765625:"49/64",0.796875:"51/64",0.828125:"53/64",0.859375:"55/64",0.890625:"57/64",0.921875:"59/64",0.953125:"61/64",0.984375:"63/64",
  0.03125:"1/32",0.09375:"3/32",0.15625:"5/32",0.21875:"7/32",0.28125:"9/32",0.34375:"11/32",0.40625:"13/32",0.46875:"15/32",
  0.53125:"17/32",0.59375:"19/32",0.65625:"21/32",0.71875:"23/32",0.78125:"25/32",0.84375:"27/32",0.90625:"29/32",0.96875:"31/32",
  0.0625:"1/16",0.1875:"3/16",0.3125:"5/16",0.4375:"7/16",0.5625:"9/16",0.6875:"11/16",0.8125:"13/16",0.9375:"15/16",
  0.125:"1/8",0.375:"3/8",0.625:"5/8",0.875:"7/8",0.25:"1/4",0.75:"3/4",
  0.5:"1/2",1:"1",1.25:"1-1/4",1.5:"1-1/2",1.75:"1-3/4",2:"2",2.5:"2-1/2",
};

const r4 = x => parseFloat(parseFloat(x).toFixed(4));

export const toFrac = d => FRACS[Math.round(d * 64) / 64] || null;

export const NUM_DRILLS = {
  80:0.0135,79:0.0145,78:0.016,77:0.018,76:0.02,75:0.021,74:0.0225,73:0.024,72:0.025,71:0.026,70:0.028,69:0.0292,68:0.031,67:0.032,66:0.033,65:0.035,
  64:0.036,63:0.037,62:0.038,61:0.039,60:0.04,59:0.041,58:0.042,57:0.043,56:0.0465,55:0.052,54:0.055,53:0.0595,52:0.0635,51:0.067,50:0.07,49:0.073,
  48:0.076,47:0.0785,46:0.081,45:0.082,44:0.086,43:0.089,42:0.0935,41:0.096,40:0.098,39:0.0995,38:0.1015,37:0.104,36:0.1065,35:0.11,34:0.111,33:0.113,
  32:0.116,31:0.12,30:0.1285,29:0.136,28:0.1405,27:0.144,26:0.147,25:0.1495,24:0.152,23:0.154,22:0.157,21:0.159,20:0.161,19:0.166,18:0.1695,17:0.173,
  16:0.177,15:0.18,14:0.182,13:0.185,12:0.189,11:0.191,10:0.1935,9:0.196,8:0.199,7:0.201,6:0.204,5:0.2055,4:0.209,3:0.213,2:0.221,1:0.228,
};
export const LETTER_DRILLS = {
  A:0.234,B:0.238,C:0.242,D:0.246,E:0.25,F:0.257,G:0.261,H:0.266,I:0.272,J:0.277,K:0.281,L:0.29,M:0.295,N:0.302,O:0.316,P:0.323,Q:0.332,R:0.339,S:0.348,T:0.358,U:0.368,V:0.377,W:0.386,X:0.397,Y:0.404,Z:0.413,
};

export const descDec = x => { const s = String(r4(x)); return s.startsWith("0.") ? s.slice(1) : s; };
// 3-decimal version for LOC/REACH/KERF in descriptions
export const descDec3 = x => { const s = String(parseFloat(parseFloat(x).toFixed(3))); return s.startsWith("0.") ? s.slice(1) : s; };

// Detects whether an inch value is really a "nice" metric size (e.g. 8mm tool
// stored as 0.3150"), so it can be displayed as "8mm" instead of ".315".
// Numbers that already match a fraction or a standard drill size are excluded.
export function isLikelyMetric(inches) {
  if (!inches) return false;
  if (toFrac(inches)) return false;
  const tol = 0.0005;
  for (const d of Object.values(NUM_DRILLS)) if (Math.abs(inches - d) <= tol) return false;
  for (const d of Object.values(LETTER_DRILLS)) if (Math.abs(inches - d) <= tol) return false;
  const mm = inches * 25.4;
  const nearestMetric = Math.round(mm / 0.05) * 0.05;
  return Math.abs(mm - nearestMetric) <= 0.0004 * 25.4;
}
export function metricDiamStr(inches) {
  const mm = Math.round(inches * 25.4 / 0.05) * 0.05;
  return `${parseFloat(mm.toFixed(2))}mm`;
}

export function smartDiam(inches, inputWasMm) {
  if (!inches) return "";
  const tol = 0.0005;
  for (const [n, d] of Object.entries(NUM_DRILLS)) if (Math.abs(inches - d) <= tol) return `#${n} (${descDec(d)})`;
  for (const [l, d] of Object.entries(LETTER_DRILLS)) if (Math.abs(inches - d) <= tol) return `${l} (${descDec(d)})`;
  if (inputWasMm) {
    const mm = parseFloat((inches * 25.4).toFixed(3));
    const mmStr = mm % 1 === 0 ? String(mm) : String(parseFloat(mm.toFixed(2)));
    return `${mmStr}mm (${descDec(inches)})`;
  }
  if (!inputWasMm && isLikelyMetric(inches)) {
    return `${metricDiamStr(inches)} (${descDec(inches)})`;
  }
  const frac = toFrac(inches); if (frac) return `${frac} (${descDec(inches)})`;
  return descDec(inches);
}

export function buildDesc(f, inputWasMm = false) {
  const d = parseFloat(f.diameter) || 0,
    loc = parseFloat(f.loc) || 0,
    fl = f.flutes || "",
    cr = parseFloat(f.cornerRadius) || 0,
    ang = f.tipAngle || "",
    mat = f.material || "carbide",
    dStr = smartDiam(d, inputWasMm),
    loc3 = descDec3(loc),
    tsc = THROUGH_COOLANT_VALUES.has(f.coolant || "") ? " TSC" : "";
  // Tip/point angle suffix shared by drill, spot drill, chamfer mill, dovetail, center drill, counter sink
  const angStr = ang ? ` ${parseFloat(parseFloat(ang).toFixed(2))}DEG` : "";

  switch (f.toolType) {
    case "flat end mill":
      return `${dStr} ${fl}FL EM ${loc3}LOC${tsc}`.trim();
    case "ball end mill":
      return `${dStr} BALL ${fl}FL ${loc3}LOC${tsc}`.trim();
    case "bull nose end mill": {
      const crStr = cr > 0 ? ` R${parseFloat(cr.toFixed(3))}` : "";
      return `${dStr} BULL${crStr} ${fl}FL ${loc3}LOC${tsc}`.trim();
    }
    case "rough end mill":
      return `${dStr} ROUGH EM ${loc3}LOC${tsc}`.trim();
    case "drill": {
      const carbStr = mat === "carbide" ? " CARB" : "";
      return `${dStr}${angStr}${carbStr} DRILL${tsc}`.trim();
    }
    case "spot drill":
      return `${dStr} SPOT DRILL${angStr}${tsc}`.trim();
    case "chamfer mill":
      return `${dStr} CHAMFER${angStr}${tsc}`.trim();
    case "face mill":
      return `${dStr} FACE MILL${tsc}`.trim();
    case "tap": {
      const subWord = f.tapSubType === "form" ? "FORM" : "CUT";
      const classStr = f.tapClass ? ` ${f.tapClass}` : "";
      const hand = f.cuttingDirection === "Left Hand" ? " LH" : "";
      const sti = f.isSTI ? " STI" : "";
      const tapSize = f.pitch || "";
      if (!tapSize) return `${subWord} TAP${classStr}${hand}${sti}${tsc}`.trim();
      return `${tapSize} ${subWord} TAP${classStr}${hand}${sti}${tsc}`.trim();
    }
    case "thread mill": {
      const tmAngStr = f.threadProfileAngle
        ? ` ${parseFloat(parseFloat(f.threadProfileAngle).toFixed(2))}DEG`
        : "";
      const tpiStr = f.tpiMin && f.tpiMax
        ? ` ${f.tpiMin}-${f.tpiMax}TPI`
        : f.tpiMax
        ? ` ${f.tpiMax}TPI`
        : "";
      const reachVal = parseFloat(f.shoulderLen) || 0;
      const reachStr = reachVal > 0 ? ` ${descDec3(reachVal)}REACH` : "";
      return `${dStr}${tmAngStr}${tpiStr} THREAD MILL${reachStr}${tsc}`.trim();
    }
    case "slot/key cutter": {
      const kerfStr = loc > 0 ? ` ${descDec3(loc)} KERF` : "";
      return `${dStr} SLOT CUTTER${kerfStr}${tsc}`.trim();
    }
    case "dovetail":
      return `${dStr} DOVETAIL${angStr} ${fl}FL${tsc}`.trim();
    case "boring head":
      return `${dStr} BORING HEAD${tsc}`.trim();
    case "boring bar":
      return `${dStr} BORING BAR${tsc}`.trim();
    case "tapered mill": {
      const taperVal = parseFloat(f.taperAngle) || 0;
      const taStr = taperVal > 0 ? ` ${parseFloat(taperVal.toFixed(2))}DEG` : "";
      return `${dStr} TAPERED EM${taStr} ${fl}FL ${loc3}LOC${tsc}`.trim();
    }
    case "radius mill": {
      const crStr = cr > 0 ? ` R${parseFloat(cr.toFixed(3))}` : "";
      return `${dStr} RADIUS${crStr} ${fl}FL ${loc3}LOC${tsc}`.trim();
    }
    case "form mill":
      return `${dStr} FORM ${fl}FL ${loc3}LOC${tsc}`.trim();
    case "lollipop mill": {
      const crStr = cr > 0 ? ` R${parseFloat(cr.toFixed(3))}` : "";
      return `${dStr} LOLLIPOP${crStr} ${fl}FL ${loc3}LOC${tsc}`.trim();
    }
    case "circle segment barrel": return `${dStr} CIRC SEG BARREL${tsc}`.trim();
    case "circle segment lens":   return `${dStr} CIRC SEG LENS${tsc}`.trim();
    case "circle segment oval":   return `${dStr} CIRC SEG OVAL${tsc}`.trim();
    case "circle segment taper":  return `${dStr} CIRC SEG TAPER${tsc}`.trim();
    case "center drill":
      return `${dStr} CENTER DRILL${angStr}${tsc}`.trim();
    case "reamer":
      return `${dStr} ${fl}FL REAMER${tsc}`.trim();
    case "counter bore":
      return `${dStr} CBORE${tsc}`.trim();
    case "counter sink":
      return `${dStr} CSINK${angStr}${tsc}`.trim();
    case "turning general": {
      const insertShape = f.insertType ? f.insertType.toUpperCase() : "";
      const insertSz = f.insertSize ? ` ${f.insertSize.toUpperCase()}` : "";
      if (insertShape) return `${insertShape}${insertSz} TURNING INSERT${tsc}`.trim();
      return `TURNING INSERT${d > 0 ? ` ${dStr}` : ""}${tsc}`.trim();
    }
    default:
      return `${dStr} ${(f.toolType || "").toUpperCase()}${tsc}`.trim();
  }
}
