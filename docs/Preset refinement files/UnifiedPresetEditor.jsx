import { useState, useEffect, useRef } from "react";

/* ═══════════════════════════════════════════════════════════════════════════
   UNIFIED PRESET EDITOR — UI/UX mockup for Claude Code integration

   Merges the old two-page flow (PresetPanel EditCard + StrategyPicker modal)
   into ONE full-width inline editor. Key decisions locked with Dan:

   1. Editor pops out inline below the preset card row (same as today) but
      takes FULL WIDTH — no more 2/3 + dead space.
   2. Every numeric field is a SLIDER + NUMBER INPUT side by side.
   3. Driving vs driven (CloudNC-style): the app's existing fx state maps
      1:1 — 'manual' = driving (bright), 'formula' = driven (dimmed, follows,
      shows fx badge). Grabbing a driven slider or typing in its input flips
      it to driving and dims its partner. NO new calc logic — this is a skin
      over the existing handleNumChange cascade in PresetPanel.jsx.
   4. Slider min/max ranges are PLACEHOLDERS (see SLIDER_RANGES). Real
      ranges (tool/material limits) are deferred — Dan said "for later".
   5. Small Bore lives in FEEDRATES (it's feed compensation) but still locks
      the Strategy section's bucket to Finishing — cross-section lock note
      shown in both places.
   6. Strategy quick groups are inline; the full strategy list is a popout
      ("All strategies…"). Same selection logic as StrategyPickerUI.jsx.
   7. Section contrast: each section is a raised card (surface2) on a darker
      page, 1px border, colored uppercase label. No more blending.

   Claude Code notes:
   - Tool-type gating (isTap / isDrillFamily / isTurning / isMilling) is NOT
     re-mocked here — mockup assumes milling. Keep the existing gating from
     PresetPanel.jsx EditCard; it decides which clusters render.
   - Slider component should live in src/components/LinkedSlider.jsx and
     replace NField everywhere in the editor. Keep NField for any non-editor
     use. fx badge, shift-hover formula tooltip, and precision handling from
     NField carry over.
   - Design tokens here approximate the app's CSS vars — use the real vars.
   - STRATEGIES / QUICK_GROUPS: static constant file
     (src/schema/camStrategies.js). confirmed:false IDs still unverified —
     Fusion silently drops unrecognized IDs. Do not ship unverified IDs
     without checking a real export.
   ═══════════════════════════════════════════════════════════════════════ */

// ── Design tokens (approximate — Claude Code: use real app CSS vars) ───────
const T = {
  page: "#0d0d0f",       // page behind everything (darkest)
  surface: "#17171a",    // editor shell
  surface2: "#1e1e22",   // section cards — visibly raised off the shell
  raise: "#28282e",      // interactive rest state
  inputBg: "#121215",
  border: "#303036",
  borderSoft: "#26262b",
  text: "#e4e4e6",
  muted: "#8b8b93",
  veryMuted: "#4a4a52",
  blue: "#3d7fe6",
  blueD: "#141d2a",
  blueB: "#253a5e",
  rough: "#d98a2b",
  roughD: "#241705",
  roughB: "#4a3010",
  finish: "#2bb3a3",
  finishD: "#062220",
  finishB: "#124440",
  amber: "#c98a28",
  amberD: "#1e1208",
  amberB: "#3e2808",
  red: "#e05252",
  redD: "#1e0a0a",
  redB: "#3e1414",
  violet: "#9b87e6",
  violetD: "#1c1730",
  violetB: "#3a2e5e",
  mono: "'JetBrains Mono','Fira Mono',monospace",
  sans: "'Space Grotesk',system-ui,sans-serif",
};

/* ═══ STRATEGY DATA — unchanged from StrategyPickerUI.jsx ═══════════════════
   confirmed:true = ID string seen in a real Fusion JSON export.
   confirmed:false = name UI-verified, internal ID inferred — VERIFY. */
const STRATEGIES = [
  { id: "adaptive2d", name: "2D Adaptive Clearing", group: "2D", confirmed: true },
  { id: "pocket2d", name: "2D Pocket", group: "2D", confirmed: true },
  { id: "face", name: "Face", group: "2D", confirmed: false },
  { id: "contour2d", name: "2D Contour", group: "2D", confirmed: true },
  { id: "slot", name: "Slot", group: "2D", confirmed: false },
  { id: "trace", name: "Trace", group: "2D", confirmed: false },
  { id: "thread", name: "Thread", group: "2D", confirmed: false },
  { id: "bore", name: "Bore", group: "2D", confirmed: true },
  { id: "circular", name: "Circular", group: "2D", confirmed: false },
  { id: "engrave", name: "Engrave", group: "2D", confirmed: false },
  { id: "chamfer2d", name: "2D Chamfer", group: "2D", confirmed: true },
  { id: "adaptive", name: "Adaptive Clearing", group: "3D", confirmed: true },
  { id: "pocket", name: "Pocket Clearing", group: "3D", confirmed: false },
  { id: "threeplustwoclearing", name: "3+2 Clearing", group: "3D", confirmed: false },
  { id: "steepandshallow", name: "Steep and Shallow", group: "3D", confirmed: false },
  { id: "flat", name: "Flat", group: "3D", confirmed: false },
  { id: "wall", name: "Wall", group: "3D", confirmed: false },
  { id: "parallel", name: "Parallel", group: "3D", confirmed: false },
  { id: "scallop", name: "Scallop", group: "3D", confirmed: false },
  { id: "contour", name: "Contour", group: "3D", confirmed: false },
  { id: "ramp", name: "Ramp", group: "3D", confirmed: false },
  { id: "pencil", name: "Pencil", group: "3D", confirmed: false },
  { id: "horizontal", name: "Horizontal", group: "3D", confirmed: false },
  { id: "spiral", name: "Spiral", group: "3D", confirmed: false },
  { id: "radial", name: "Radial", group: "3D", confirmed: false },
  { id: "morphedspiral", name: "Morphed Spiral", group: "3D", confirmed: false },
  { id: "project", name: "Project", group: "3D", confirmed: false },
  { id: "blend", name: "Blend", group: "3D", confirmed: false },
  { id: "morph", name: "Morph", group: "3D", confirmed: false },
  { id: "corner", name: "Corner", group: "3D", confirmed: false },
  { id: "flow", name: "Flow", group: "3D", confirmed: false },
  { id: "deburr", name: "Deburr", group: "3D", confirmed: false },
  { id: "geodesic", name: "Geodesic", group: "3D", confirmed: false },
  { id: "drill", name: "Drill", group: "Drilling", confirmed: false },
  { id: "rotarypocket", name: "Rotary Pocket", group: "Multi-Axis", confirmed: false },
  { id: "multiaxisclearing", name: "Multi-Axis Clearing", group: "Multi-Axis", confirmed: false },
  { id: "swarf", name: "Swarf", group: "Multi-Axis", confirmed: false },
  { id: "advancedswarf", name: "Advanced Swarf", group: "Multi-Axis", confirmed: false },
  { id: "multiaxiscontour", name: "Multi-Axis Contour", group: "Multi-Axis", confirmed: false },
  { id: "rotaryparallel", name: "Rotary Parallel", group: "Multi-Axis", confirmed: false },
  { id: "rotarycontour", name: "Rotary Contour", group: "Multi-Axis", confirmed: false },
  { id: "multiaxisfinishing", name: "Multi-Axis Finishing", group: "Multi-Axis", confirmed: false },
];

const QUICK_GROUPS = [
  { key: "adaptive", label: "Adaptive", members: ["adaptive2d", "adaptive"], suggestBucket: null },
  { key: "facing", label: "Facing", members: ["face", "flat", "horizontal"], suggestBucket: null },
  { key: "rough3d", label: "Rough 3D Surfacing", members: ["adaptive", "threeplustwoclearing", "contour", "parallel", "scallop", "multiaxisclearing"], suggestBucket: "roughing" },
  { key: "finish3d", label: "Finish 3D Surfacing", members: ["contour", "parallel", "scallop", "pencil", "spiral", "morphedspiral", "morph", "radial", "blend", "flow", "wall", "steepandshallow", "corner", "geodesic", "multiaxisfinishing", "swarf", "advancedswarf"], suggestBucket: "finishing" },
  { key: "engrave", label: "Engrave", members: ["engrave", "project"], suggestBucket: null },
];
const quickGroupsContaining = (id) => QUICK_GROUPS.filter(g => g.members.includes(id));
const AUTO_LINK_PAIR = ["adaptive2d", "adaptive"];
const SMALL_BORE_STRATEGIES = ["bore", "contour2d", "contour"];
// Single strategies common enough to sit out on the surface next to the
// quick groups instead of being buried behind "All strategies…". These don't
// belong to any group — they're their own thing. Dan reaches for both a lot.
const PINNED_STRATEGIES = ["contour2d", "bore"];
const MILLING_COLUMNS = [["2D"], ["3D"], ["Drilling", "Multi-Axis"]];

const INTENSITIES = [
  { key: "light", label: "Light", dot: 4 },
  { key: "normal", label: "Normal", dot: 6 },
  { key: "aggressive", label: "Aggressive", dot: 9 },
];

function nameModifier(bucket, intensity, smallBore) {
  if (smallBore) return "Small Bore";
  if (intensity === "normal") return null;
  if (bucket === "roughing") return intensity === "aggressive" ? "Fast" : "Light";
  return intensity === "light" ? "Fine" : "Fast";
}

function bucketColors(bucket) {
  return bucket === "roughing"
    ? { fg: T.rough, bg: T.roughD, bd: T.roughB }
    : { fg: T.finish, bg: T.finishD, bd: T.finishB };
}

// ── Bore compensation — SHARED util (src/utils/boreCompensation.js) ────────
function boreCompensation(toolDia, boreDia) {
  const D = parseFloat(boreDia);
  const d = parseFloat(toolDia);
  if (!D || !d) return null;
  if (D <= d) return { error: "Bore must be larger than the tool" };
  const centerCircle = D - d;
  return { centerCircle, ratio: D / centerCircle, factor: centerCircle / D };
}

/* ═══ SLIDER RANGES ═════════════════════════════════════════════════════════
   These are DEFAULT bounds, not hard limits. Real limits (tool + material)
   are a future feature — Dan deferred it. Keep them in this one object so
   swapping to computed ranges later is one function change.

   softMax: hold the handle pinned at the right end for ~half a second and
   the ceiling starts climbing, taking the value with it. Feedrate and chip
   load defaults cover the normal case; the rare high-feed job pushes past
   without a settings trip. Non-feed fields (RPM, SFM, ramp angle) have hard
   ceilings.

   RPM default max is 16000. Claude Code: when a machine is selected, map
   this to that machine's max spindle speed (already on the machine record
   in the app). Fall back to 16000 when no machine is set.
   ═══════════════════════════════════════════════════════════════════════ */
const SLIDER_RANGES = {
  n:              { min: 0, max: 16000, step: 10 },
  v_c:            { min: 0, max: 1500, step: 5 },
  n_ramp:         { min: 0, max: 16000, step: 10 },
  f_z:            { min: 0, max: 0.02, step: 0.0001, softMax: true },
  v_f:            { min: 0, max: 225, step: 0.5, softMax: true },
  v_f_leadIn:     { min: 0, max: 225, step: 0.5, softMax: true },
  v_f_leadOut:    { min: 0, max: 225, step: 0.5, softMax: true },
  v_f_transition: { min: 0, max: 225, step: 0.5, softMax: true },
  v_f_plunge:     { min: 0, max: 225, step: 0.5, softMax: true },
  f_n:            { min: 0, max: 0.05, step: 0.0001 },
  v_f_ramp:       { min: 0, max: 225, step: 0.5, softMax: true },
  ramp_angle:     { min: 0, max: 20, step: 0.5 },
};

const FIELD_PRECISION = { n: 0, v_c: 1, n_ramp: 0, f_z: 4, v_f: 2, v_f_leadIn: 2, v_f_leadOut: 2, v_f_transition: 2, v_f_plunge: 2, f_n: 4, v_f_ramp: 2, ramp_angle: 1 };
// Fields that must ALWAYS show their full decimal places, trailing zeros and
// all — a chip load reading "0.001" instead of "0.0010" makes a machinist
// re-read it. Everything else strips trailing zeros as before.
const FIXED_DECIMALS = new Set(["f_z", "f_n"]);
const round = (f, v) => parseFloat(Number(v || 0).toFixed(FIELD_PRECISION[f] ?? 4));

// Speeds/feeds math — mirror of src/utils/speedsAndFeedsCalc.js (inch mode)
const rpmToSFM = (n, d) => (n * Math.PI * d) / 12;
const sfmToRPM = (sfm, d) => (d > 0 ? (sfm * 12) / (Math.PI * d) : 0);
const fptToIPM = (fz, n, z) => fz * n * z;
const ipmToFPT = (ipm, n, z) => (n > 0 && z > 0 ? ipm / (n * z) : 0);
const iprToIPM = (fn, n) => fn * n;
const ipmToIPR = (ipm, n) => (n > 0 ? ipm / n : 0);

// ── Tiny shared bits ───────────────────────────────────────────────────────
const base = {
  input: {
    background: T.inputBg, border: `1px solid ${T.border}`, borderRadius: "6px",
    padding: "7px 9px", color: T.text, fontSize: "13px", width: "100%",
    boxSizing: "border-box", outline: "none", fontFamily: T.sans,
  },
};

function SectionLabel({ children, color = T.blue, right }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
      <span style={{ fontSize: "12.5px", fontWeight: 800, letterSpacing: "0.09em", textTransform: "uppercase", color }}>{children}</span>
      <div style={{ flex: 1, height: "1px", background: T.borderSoft }} />
      {right}
    </div>
  );
}

// Section card — the visual grouping fix. Raised surface + real border.
function Section({ label, color, right, children, style }) {
  return (
    <div style={{
      background: T.surface2, border: `1px solid ${T.border}`,
      borderRadius: "10px", padding: "14px 16px", ...style,
    }}>
      <SectionLabel color={color} right={right}>{label}</SectionLabel>
      {children}
    </div>
  );
}

function FGroup({ label, children }) {
  return (
    <div>
      <div style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: T.muted, marginBottom: "5px" }}>{label}</div>
      {children}
    </div>
  );
}

// fx badge — lit when a field is driven by its partner. The slot is always
// rendered (transparent when off) so labels don't shift as drivers flip.
function FxBadge({ on }) {
  return (
    <span style={{
      fontFamily: T.mono, fontSize: "8px", fontWeight: 800,
      border: `1px solid ${on ? T.blueB : "transparent"}`,
      color: on ? T.blue : "transparent",
      background: on ? T.blueD : "transparent",
      borderRadius: "3px", padding: "0 3px", flexShrink: 0,
    }}>fx</span>
  );
}

function SmallBoreIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ display: "block" }}>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="15.2" cy="12" r="4.5" fill="currentColor" />
    </svg>
  );
}

function GroupIcon({ size = 13, color }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" style={{ display: "block", flexShrink: 0 }}>
      <rect x="1" y="1" width="8" height="8" rx="1.5" fill={color} opacity="0.35" />
      <rect x="6" y="6" width="9" height="9" rx="1.5" fill={color} />
    </svg>
  );
}

function InfoTip({ children, width = 270 }) {
  const [open, setOpen] = useState(false);
  return (
    <span style={{ position: "relative", display: "inline-flex" }}>
      <button
        onClick={e => { e.stopPropagation(); setOpen(o => !o); }}
        style={{
          width: "15px", height: "15px", borderRadius: "8px",
          border: `1px solid ${open ? T.blueB : T.border}`,
          background: open ? T.blueD : "transparent",
          color: open ? T.blue : T.muted,
          fontSize: "9px", fontWeight: 800, cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
          padding: 0, fontFamily: T.sans, flexShrink: 0,
        }}
      >i</button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 90 }} />
          <div style={{
            position: "absolute", bottom: "calc(100% + 7px)", left: "50%",
            transform: "translateX(-50%)", zIndex: 91,
            background: "#0a0a0a", border: `1px solid ${T.blueB}`,
            borderRadius: "7px", padding: "9px 11px",
            fontSize: "11px", color: T.text, lineHeight: 1.65,
            width: `${width}px`, boxShadow: "0 6px 24px rgba(0,0,0,0.7)",
            fontWeight: 400, textAlign: "left",
          }}>{children}</div>
        </>
      )}
    </span>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   LINKED SLIDER — the CloudNC-style control

   Driving vs driven shows ONLY on the slider track, and only gently: a
   driven track fades to ~55%. The label, the fx badge, and the number all
   stay full brightness — a driven value is still a number you have to read,
   and dimming the title just makes the row look disabled.

   Grabbing a driven track or typing in its input promotes it to driving —
   the parent's existing handleNumChange cascade does the flip.

   SOFT MAX (feedrate + chip load): hold the handle pinned at the right end
   and after ~half a second the ceiling starts climbing, dragging the value
   up with it. The handle stays at the end and the number keeps rising —
   like leaning on a feed override. Release and the ceiling snaps back down
   to the default unless the value still needs the extra room, so dragging
   back DOWN gets its fine resolution back instead of being stuck scrubbing
   a 400-wide track to find 12 in/min.

   Because the track silently rescales, that rescale is announced: »» drifts
   across while the ceiling is growing, «« when it contracts. They fade out
   a moment after you let go. Growing was already obvious (the number
   climbs); shrinking was not — the handle just jumped and nothing said why.

   Column widths are FIXED (not compact-dependent) so every slider in a
   section lines up: labels flush left, tracks the same length, number boxes
   in one straight column.

   Claude Code: extract as src/components/LinkedSlider.jsx. Accent is a prop
   so sections can tint. Native spinners suppressed via .td-noSpin — the
   slider is the increment control.
   ═══════════════════════════════════════════════════════════════════════ */
const SOFT_MAX_DELAY = 500;   // ms holding at the edge before the ceiling moves
const SOFT_MAX_TICK  = 160;   // ms between growth steps
const SOFT_MAX_RATE  = 1.05;  // ceiling multiplier per step
const SCALE_HINT_LINGER = 700; // ms the chevrons stay after the last change

// Chevrons shown over the track while its scale is changing. Drifting in the
// direction of the change reads faster than a static icon — the eye catches
// the motion without having to parse the glyph.
//
// White with a dark halo, NOT the accent: when the ceiling is growing the
// handle is pinned right and the bar is fully filled with the accent, so
// accent-on-accent chevrons were invisible exactly when they were needed.
//
// lastDir keeps the glyphs on screen through the fade-out. Rendering off the
// live dir alone made them blink out instantly instead of fading.
function ScaleHint({ dir }) {
  const [lastDir, setLastDir] = useState(null);
  useEffect(() => { if (dir) setLastDir(dir); }, [dir]);
  const d = dir || lastDir;
  if (!d) return null;
  const grow = d === "grow";
  return (
    <div style={{
      position: "absolute", inset: 0, display: "flex",
      alignItems: "center", justifyContent: "center",
      gap: "2px", pointerEvents: "none",
      opacity: dir ? 1 : 0, transition: "opacity 0.3s ease-out",
    }}>
      {[0, 1, 2].map(i => (
        <span
          key={i}
          style={{
            fontFamily: T.mono, fontSize: "18px", fontWeight: 800,
            color: "#fff", lineHeight: 1,
            textShadow: "0 1px 4px rgba(0,0,0,0.95), 0 0 9px rgba(0,0,0,0.8)",
            animation: `td-drift-${grow ? "r" : "l"} 0.7s ease-out ${i * 0.08}s infinite`,
          }}
        >{grow ? "›" : "‹"}</span>
      ))}
    </div>
  );
}

function LinkedSlider({ field, label, value, unit, fxState, onChange, accent = T.blue, compact = false }) {
  const range = SLIDER_RANGES[field] || { min: 0, max: 100, step: 1 };
  const trackRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dynMax, setDynMax] = useState(range.max);
  const [atEdge, setAtEdge] = useState(false);
  // 'grow' | 'shrink' | null — drives the chevron overlay. Self-clearing.
  const [hint, setHint] = useState(null);

  const driven = fxState === "formula";
  const num = Number(value) || 0;
  const ratio = Math.min(1, Math.max(0, (num - range.min) / (dynMax - range.min)));

  // Chevrons clear themselves a beat after the last scale change, so holding
  // at the edge keeps them lit and letting go fades them out.
  useEffect(() => {
    if (!hint) return;
    const t = setTimeout(() => setHint(null), SCALE_HINT_LINGER);
    return () => clearTimeout(t);
  }, [hint, dynMax]);

  /* The ceiling follows the value in both directions:
     - grow to fit any value above it (a driven field can be pushed past the
       default by its partner — better to widen than to pin the handle at the
       end and lie about where the value sits)
     - shrink back to the default once the value fits under it again

     Shrink timing was the tricky part. It used to wait for the drag to END
     (`!dragging`), so dragging left showed nothing until you let go — the
     chevron lagged the motion. But shrinking mid-drag is only dangerous when
     the handle is right at the edge being rescaled; there it would jump under
     your cursor. Dragging left you're far from the right edge, so it's safe
     to shrink live. Gate: shrink live once the value sits comfortably below
     the default (ratio-against-default < 0.85), otherwise wait for release. */
  const stretchedByUser = useRef(false);
  const belowDefault = num <= range.max * 0.85;
  useEffect(() => {
    if (num > dynMax) { setDynMax(Math.ceil(num / range.step) * range.step); return; }
    const canShrink = dynMax > range.max && num <= range.max && (!dragging || belowDefault);
    if (canShrink) {
      setDynMax(range.max);
      // Only announce the snap-back if the user is the one who stretched it.
      if (stretchedByUser.current) setHint("shrink");
      stretchedByUser.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [num, dragging]);

  // Soft-max growth while held at the edge. onChangeRef avoids a stale
  // closure inside the interval.
  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
  useEffect(() => {
    if (!(range.softMax && dragging && atEdge)) return;
    let iv;
    const start = setTimeout(() => {
      iv = setInterval(() => {
        setDynMax(m => {
          const nm = round(field, m * SOFT_MAX_RATE);
          onChangeRef.current(nm);
          return nm;
        });
        stretchedByUser.current = true;
        setHint("grow");
      }, SOFT_MAX_TICK);
    }, SOFT_MAX_DELAY);
    return () => { clearTimeout(start); if (iv) clearInterval(iv); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range.softMax, dragging, atEdge, field]);

  function pointerRatio(clientX) {
    const rect = trackRef.current.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  }
  function handlePointer(clientX) {
    const r = pointerRatio(clientX);
    setAtEdge(r >= 0.999);
    const raw = range.min + r * (dynMax - range.min);
    onChange(round(field, Math.round(raw / range.step) * range.step));
  }

  /* Wheel nudging. Two gestures, both meaning "move this slider sideways":
     - a horizontal wheel (deltaX) — the tilt/scroll wheel on the mouse
     - shift + vertical wheel (deltaY) — the OS remaps vertical to horizontal
       while shift is held, the standard "scroll sideways" convention
     One notch = one step. Ctrl/Cmd is left alone so browser zoom still works.

     Claude Code: this needs a NON-passive listener (preventDefault on wheel),
     which React's onWheel can't guarantee — attach it with addEventListener
     in a useEffect, passive:false. Inline onWheel here is fine for the mockup
     but will log passive-listener warnings and won't reliably stop the page
     from scrolling. Direction sign is intentional: horizontal wheels vary by
     OS/mouse, so if right-scroll moves the value DOWN for you, flip the
     deltaX sign (make it a per-user setting rather than guessing). */
  function handleWheel(e) {
    const horizontal = e.deltaX;
    const shifted = e.shiftKey ? e.deltaY : 0;
    const axis = Math.abs(horizontal) >= Math.abs(shifted) ? horizontal : shifted;
    if (!axis || e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    const dir = axis > 0 ? 1 : -1;
    const next = round(field, (Number(value) || 0) + dir * range.step);
    // Respect the current ceiling; wheel doesn't trigger soft-max growth.
    onChange(Math.max(range.min, Math.min(dynMax, next)));
  }

  const prec = FIELD_PRECISION[field] ?? 4;
  const displayed = focused
    ? (value ?? "")
    : value == null || value === ""
      ? ""
      : FIXED_DECIMALS.has(field)
        ? Number(value).toFixed(prec)   // keep trailing zeros: 0.0010
        : round(field, value);

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "132px 1fr 108px",
      alignItems: "center", gap: "12px",
      padding: compact ? "3px 0" : "5px 0",
    }}>
      {/* Label + fx badge — NEVER dimmed */}
      <div style={{ display: "flex", alignItems: "center", gap: "6px", minWidth: 0 }}>
        <span style={{
          fontSize: compact ? "11.5px" : "12px", fontWeight: 700, color: T.text,
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        }}>{label}</span>
        <FxBadge on={driven} />
      </div>

      {/* Track — the only thing that dims */}
      <div
        ref={trackRef}
        onPointerDown={e => {
          e.currentTarget.setPointerCapture(e.pointerId);
          setDragging(true);
          handlePointer(e.clientX);
        }}
        onPointerMove={e => { if (dragging) handlePointer(e.clientX); }}
        onPointerUp={() => { setDragging(false); setAtEdge(false); }}
        onPointerCancel={() => { setDragging(false); setAtEdge(false); }}
        onWheel={handleWheel}
        style={{
          position: "relative", height: compact ? "22px" : "26px",
          display: "flex", alignItems: "center",
          cursor: dragging ? "grabbing" : "grab", touchAction: "none",
          opacity: driven ? 0.55 : 1,
          transition: "opacity 0.15s",
        }}
      >
        <div style={{ position: "absolute", left: 0, right: 0, height: "4px", borderRadius: "2px", background: T.raise }} />
        <div style={{
          position: "absolute", left: 0, width: `${ratio * 100}%`,
          height: "4px", borderRadius: "2px", background: accent,
          transition: dragging ? "none" : "width 0.12s ease-out",
        }} />
        <div style={{
          position: "absolute", left: `calc(${ratio * 100}% - ${compact ? 6 : 7}px)`,
          width: compact ? "12px" : "14px", height: compact ? "12px" : "14px",
          borderRadius: "50%", background: accent,
          border: `2px solid ${T.surface2}`,
          boxShadow: dragging
            ? (atEdge && range.softMax ? `0 0 0 4px ${accent}66` : `0 0 0 3px ${accent}44`)
            : "0 1px 3px rgba(0,0,0,0.5)",
          transition: dragging ? "none" : "left 0.12s ease-out",
        }} />
        {/* Announces the silent rescale — see SOFT MAX notes above */}
        <ScaleHint dir={hint} />
      </div>

      {/* Number input + unit — left-justified so the decimal point sits in the
          same place whether the value reads 7.82 or 0.0008. */}
      <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
        <input
          className="td-noSpin"
          type="number"
          step={range.step}
          value={displayed}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={e => onChange(e.target.value === "" ? null : parseFloat(e.target.value))}
          style={{
            ...base.input, padding: "4px 6px",
            fontFamily: T.mono, fontSize: compact ? "11.5px" : "12.5px",
            fontWeight: 700, color: T.text,
            textAlign: "left", width: 0, flex: 1, minWidth: "54px",
          }}
        />
        <span style={{ fontSize: "9.5px", color: T.muted, width: "34px", flexShrink: 0 }}>{unit}</span>
      </div>
    </div>
  );
}

/* ── FACTOR SLIDER — stepdown / stepover ───────────────────────────────────
   Stepdown and stepover are decided as a PERCENTAGE of a reference dimension
   (flute length, diameter), so the slider drives the percentage and reads
   out as one — 86%, not 0.86. Never above 100%.

   Two ways in, and they're a driving/driven pair like every other linked
   field here: drag or type the percentage (1% steps) and the inch value
   follows with an fx badge; type the inch value straight in ("just give me
   0.02") and the percentage follows instead. Whichever you touched last is
   the driver. Never above 100%.

   Claude Code:
   - Fusion stores ABSOLUTES (draft.stepdown / draft.stepover), not factors
     or percentages. Percent is a UI convenience only — convert on save.
     The 0.86-vs-86 conversion lives in this component; don't leak percent
     into the data model.
   - This replaces StepField in the editor. Column widths match LinkedSlider
     so both sections line up.
   ═══════════════════════════════════════════════════════════════════════ */
function FactorSlider({ label, enabled, onToggle, factor, onFactorChange, refDim, refLabel, lenUnit, accent = T.blue }) {
  const trackRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [inchDraft, setInchDraft] = useState(null);
  // Which side the user last drove. Percent leads by default — it's the
  // decision a machinist actually makes; inches are what falls out.
  const [driver, setDriver] = useState("pct");

  const f = Math.min(1, Math.max(0, Number(factor) || 0));
  const pct = Math.round(f * 100);
  const abs = refDim > 0 ? f * refDim : 0;

  function pctFromPointer(clientX) {
    const rect = trackRef.current.getBoundingClientRect();
    const r = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return Math.round(r * 100);
  }
  const setPct = (p) => { setDriver("pct"); onFactorChange(Math.min(1, Math.max(0, (Number(p) || 0) / 100))); };
  const setInch = (v) => {
    const inches = Number(v) || 0;
    setDriver("inch");
    if (refDim > 0) onFactorChange(Math.min(1, Math.max(0, inches / refDim)));
  };

  return (
    <div style={{ opacity: enabled ? 1 : 0.45, transition: "opacity 0.15s" }}>
      <div style={{
        display: "grid", gridTemplateColumns: "132px 1fr 108px",
        alignItems: "center", gap: "12px",
      }}>
        {/* Label column — matches LinkedSlider's label column exactly */}
        <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", fontWeight: 700, cursor: "pointer", minWidth: 0 }}>
          <input type="checkbox" checked={enabled} onChange={e => onToggle(e.target.checked)} />
          <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
          <FxBadge on={driver === "inch"} />
        </label>

        {/* Track */}
        <div
          ref={trackRef}
          onPointerDown={e => {
            if (!enabled) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            setDragging(true);
            setPct(pctFromPointer(e.clientX));
          }}
          onPointerMove={e => { if (dragging) setPct(pctFromPointer(e.clientX)); }}
          onPointerUp={() => setDragging(false)}
          onWheel={e => {
            if (!enabled) return;
            // Same gesture rules as LinkedSlider — see its handleWheel note.
            // One notch = 1%. Claude Code: non-passive listener needed here too.
            const axis = Math.abs(e.deltaX) >= Math.abs(e.shiftKey ? e.deltaY : 0) ? e.deltaX : (e.shiftKey ? e.deltaY : 0);
            if (!axis || e.ctrlKey || e.metaKey) return;
            e.preventDefault();
            setPct(Math.max(0, Math.min(100, pct + (axis > 0 ? 1 : -1))));
          }}
          style={{
            position: "relative", height: "26px", display: "flex", alignItems: "center",
            cursor: enabled ? (dragging ? "grabbing" : "grab") : "not-allowed", touchAction: "none",
            opacity: driver === "inch" ? 0.55 : 1, transition: "opacity 0.15s",
          }}
        >
          <div style={{ position: "absolute", left: 0, right: 0, height: "4px", borderRadius: "2px", background: T.raise }} />
          <div style={{ position: "absolute", left: 0, width: `${pct}%`, height: "4px", borderRadius: "2px", background: accent, transition: dragging ? "none" : "width 0.12s ease-out" }} />
          <div style={{
            position: "absolute", left: `calc(${pct}% - 7px)`,
            width: "14px", height: "14px", borderRadius: "50%", background: accent,
            border: `2px solid ${T.surface2}`,
            boxShadow: dragging ? `0 0 0 3px ${accent}44` : "0 1px 3px rgba(0,0,0,0.5)",
            transition: dragging ? "none" : "left 0.12s ease-out",
          }} />
        </div>

        {/* Percent — in LinkedSlider's number column */}
        <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
          <input
            className="td-noSpin"
            type="number" step="1" min="0" max="100"
            value={pct}
            disabled={!enabled}
            onChange={e => setPct(e.target.value)}
            style={{
              ...base.input, padding: "4px 6px", fontFamily: T.mono, fontSize: "12.5px",
              fontWeight: 700, color: T.text, textAlign: "left", width: 0, flex: 1, minWidth: "54px",
            }}
          />
          <span style={{ fontSize: "9.5px", color: T.muted, width: "34px", flexShrink: 0 }}>%</span>
        </div>
      </div>

      {/* Inch entry — same column geometry, second line. Same weight as the
          percent: it's a real value you type into, not a readout. */}
      <div style={{
        display: "grid", gridTemplateColumns: "132px 1fr 108px",
        alignItems: "center", gap: "12px", marginTop: "3px",
      }}>
        <span style={{ display: "flex", alignItems: "center", gap: "6px", paddingLeft: "22px", minWidth: 0 }}>
          <span style={{ fontSize: "11px", color: T.muted, whiteSpace: "nowrap" }}>of {refLabel}</span>
          <FxBadge on={driver === "pct"} />
        </span>
        <span style={{ fontFamily: T.mono, fontSize: "10px", color: T.veryMuted }}>
          {refDim > 0 ? `${refDim.toFixed(4)} ${lenUnit}` : "—"}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
          <input
            className="td-noSpin"
            type="number" step="0.001" min="0" max={refDim}
            value={inchDraft !== null ? inchDraft : abs.toFixed(4)}
            disabled={!enabled}
            onFocus={() => setInchDraft(abs.toFixed(4))}
            onBlur={() => setInchDraft(null)}
            onChange={e => { setInchDraft(e.target.value); setInch(e.target.value); }}
            style={{
              ...base.input, padding: "4px 6px", fontFamily: T.mono, fontSize: "12.5px",
              fontWeight: 700, color: T.text, textAlign: "left", width: 0, flex: 1, minWidth: "54px",
            }}
          />
          <span style={{ fontSize: "9.5px", color: T.muted, width: "34px", flexShrink: 0 }}>{lenUnit}</span>
        </div>
      </div>
    </div>
  );
}

// ── MRR — material removal rate ────────────────────────────────────────────
// The volume of metal coming off per minute: radial width × axial depth ×
// feed. It's the payoff number for the whole Passes section — the reason you
// push stepdown and stepover at all — so it earns a bold readout that reacts
// live as either slider moves.
//   ae = stepover (radial width of cut, in)
//   ap = stepdown (axial depth of cut, in)
//   vf = cutting feedrate (in/min)
//   MRR = ae × ap × vf   →   in³/min
function computeMRR(ae, ap, vf) {
  const a = Number(ae) || 0, p = Number(ap) || 0, f = Number(vf) || 0;
  return a * p * f;
}

function MRRIndicator({ ae, ap, vf, accent }) {
  const mrr = computeMRR(ae, ap, vf);
  const live = mrr > 0;
  const a = (Number(ae) || 0).toFixed(4);
  const p = (Number(ap) || 0).toFixed(4);
  const f = (Number(vf) || 0).toFixed(1);

  return (
    <div
      title={`radial width ${a} in  ×  axial depth ${p} in  ×  feed ${f} in/min`}
      style={{
        display: "flex", alignItems: "center", gap: "10px",
        background: "#101013", border: `1px solid ${live ? accent + "44" : T.border}`,
        borderRadius: "9px", padding: "9px 13px",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.15 }}>
        <span style={{ fontSize: "11px", fontWeight: 800, letterSpacing: "0.09em", color: T.text }}>MRR</span>
        <span style={{ fontSize: "9px", color: T.veryMuted, whiteSpace: "nowrap" }}>removal rate</span>
      </div>

      <div style={{ flex: 1 }} />

      <span style={{ fontFamily: T.mono, fontSize: "24px", fontWeight: 800, color: live ? accent : T.veryMuted, lineHeight: 1 }}>
        {live ? mrr.toFixed(3) : "—"}
      </span>
      <span style={{ fontFamily: T.mono, fontSize: "11px", color: T.muted }}>in³/min</span>
    </div>
  );
}

// ── Bucket toggle + intensity (ported from StrategyPickerUI) ───────────────
function BucketToggle({ value, onChange, locked }) {
  const opts = [{ key: "roughing", label: "Rough" }, { key: "finishing", label: "Finish" }];
  return (
    <div style={{
      display: "inline-flex", background: "#0d0d0d",
      border: `1px solid ${T.border}`, borderRadius: "8px",
      padding: "3px", gap: "3px", opacity: locked ? 0.55 : 1,
    }}>
      {opts.map(o => {
        const active = value === o.key;
        const c = bucketColors(o.key);
        return (
          <button
            key={o.key}
            onClick={() => !locked && onChange(o.key)}
            style={{
              padding: "6px 16px", borderRadius: "6px", fontSize: "12.5px", fontWeight: 700,
              cursor: locked ? "not-allowed" : "pointer", fontFamily: T.sans,
              border: `1px solid ${active ? c.bd : "transparent"}`,
              background: active ? c.bg : "transparent",
              color: active ? c.fg : T.muted,
              transition: "all 0.14s",
            }}
          >{o.label}</button>
        );
      })}
    </div>
  );
}

/* Intensity — height-matched to BucketToggle so they read as one row.
   The dots and their labels now share a line each instead of the label strip
   hanging below a tall track, which was pure dead space. Text size is
   unchanged; only the empty vertical padding is gone. */
function IntensityMeter({ value, bucket, onChange }) {
  const c = bucketColors(bucket);
  const idx = INTENSITIES.findIndex(i => i.key === value);
  const trackRef = useRef(null);
  const [dragging, setDragging] = useState(false);

  function zoneFromPointer(clientX) {
    const rect = trackRef.current.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    if (ratio < 1 / 3) return "light";
    if (ratio < 2 / 3) return "normal";
    return "aggressive";
  }
  function handlePointer(e) {
    const zone = zoneFromPointer(e.clientX);
    if (zone !== value) onChange(zone);
  }

  return (
    <div style={{ minWidth: "210px" }}>
      <div
        ref={trackRef}
        onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); setDragging(true); handlePointer(e); }}
        onPointerMove={e => { if (dragging) handlePointer(e); }}
        onPointerUp={() => setDragging(false)}
        style={{ position: "relative", height: "22px", display: "flex", alignItems: "center", padding: "0 6px", cursor: dragging ? "grabbing" : "grab", touchAction: "none" }}
      >
        <div style={{ position: "absolute", left: "16px", right: "16px", height: "3px", borderRadius: "2px", background: T.raise }} />
        <div style={{ position: "absolute", left: "16px", width: `calc((100% - 32px) * ${idx / (INTENSITIES.length - 1)})`, height: "3px", borderRadius: "2px", background: c.fg, transition: "width 0.14s ease-out" }} />
        <div style={{ position: "relative", display: "flex", justifyContent: "space-between", width: "100%", pointerEvents: "none" }}>
          {INTENSITIES.map((i, n) => {
            const active = i.key === value;
            const passed = n <= idx;
            return (
              <span key={i.key} style={{ width: "20px", height: "20px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span style={{
                  width: active ? `${i.dot + 6}px` : `${i.dot}px`,
                  height: active ? `${i.dot + 6}px` : `${i.dot}px`,
                  borderRadius: "50%", background: passed ? c.fg : T.veryMuted,
                  border: active ? `2px solid ${T.surface2}` : "none",
                  boxShadow: active ? `0 0 0 2px ${c.fg}` : "none",
                  transition: "all 0.14s ease-out",
                }} />
              </span>
            );
          })}
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", padding: "0 2px", marginTop: "-1px" }}>
        {INTENSITIES.map(i => (
          <span key={i.key} style={{ fontSize: "10px", lineHeight: 1.1, fontWeight: i.key === value ? 700 : 500, color: i.key === value ? c.fg : T.muted, width: "56px", textAlign: "center", transition: "color 0.15s" }}>{i.label}</span>
        ))}
      </div>
    </div>
  );
}

function ModifierBadge({ modifier, colors }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      width: "84px", height: "19px", flexShrink: 0,
      borderRadius: "10px", fontFamily: T.mono, fontSize: "10px", fontWeight: 700,
      background: modifier ? colors.bg : "transparent",
      border: `1px solid ${modifier ? colors.bd : "transparent"}`,
      color: modifier ? colors.fg : "transparent",
      visibility: modifier ? "visible" : "hidden",
    }}>{modifier || "—"}</span>
  );
}

function StrategyPill({ strategy, bucket, onRemove }) {
  const c = bucketColors(bucket);
  return (
    <span style={{
      background: c.bg, border: `1px solid ${c.bd}`, borderRadius: "5px",
      padding: "3px 8px", fontSize: "12px", color: c.fg,
      display: "inline-flex", alignItems: "center", gap: "6px", fontFamily: T.sans,
    }}>
      <span style={{ width: "7px", height: "7px", borderRadius: "1px", background: c.fg, flexShrink: 0 }} />
      {strategy.name}
      {!strategy.confirmed && <span title="Strategy ID unverified" style={{ color: T.amber, fontSize: "11px", fontWeight: 700 }}>!</span>}
      {onRemove && (
        <button onClick={onRemove} style={{ background: "none", border: "none", color: c.fg, opacity: 0.6, cursor: "pointer", padding: 0, lineHeight: 1, fontSize: "13px" }}>×</button>
      )}
    </span>
  );
}

function QuickGroupButton({ group, selected, onClick }) {
  const memberCount = group.members.length;
  const selectedCount = group.members.filter(id => selected.has(id)).length;
  const full = selectedCount === memberCount;
  const partial = selectedCount > 0 && !full;
  const tint = group.suggestBucket ? bucketColors(group.suggestBucket) : { fg: T.violet, bg: T.violetD, bd: T.violetB };

  return (
    <button
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: "7px",
        padding: "7px 12px", borderRadius: "10px",
        cursor: "pointer", fontFamily: T.sans,
        border: `1.5px solid ${full || partial ? tint.bd : T.border}`,
        background: full ? tint.bg : partial ? "#1a1a1e" : "#18181c",
        borderStyle: partial ? "dashed" : "solid",
        transition: "all 0.14s",
      }}
    >
      <GroupIcon size={13} color={full ? tint.fg : T.muted} />
      <span style={{ fontSize: "12px", fontWeight: 700, color: full ? tint.fg : T.text }}>{group.label}</span>
      <span style={{ fontSize: "10px", fontFamily: T.mono, color: full ? tint.fg : T.muted, opacity: full ? 1 : 0.8 }}>
        {selectedCount}/{memberCount}
      </span>
    </button>
  );
}

// A single common strategy, toggled directly — no group math. Styled a hair
// narrower than a group button and with a dot instead of the group glyph, so
// the two read as different kinds of thing sitting side by side.
function PinnedStrategyButton({ strategy, selected, bucket, onClick }) {
  const on = selected.has(strategy.id);
  const c = bucketColors(bucket);
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: "7px",
        padding: "7px 12px", borderRadius: "10px", cursor: "pointer", fontFamily: T.sans,
        border: `1.5px solid ${on ? c.bd : T.border}`,
        background: on ? c.bg : "#18181c",
        transition: "all 0.14s",
      }}
    >
      <span style={{ width: "8px", height: "8px", borderRadius: "2px", background: on ? c.fg : T.muted, flexShrink: 0 }} />
      <span style={{ fontSize: "12px", fontWeight: 700, color: on ? c.fg : T.text }}>{strategy.name}</span>
      {!strategy.confirmed && <span title="ID unverified" style={{ color: T.amber, fontSize: "11px", fontWeight: 700 }}>!</span>}
    </button>
  );
}

// ── Fine-tune popout — the full strategy list, now a modal only ────────────
function StrategyListPopout({ selected, onToggle, bucket, onClose }) {
  const [query, setQuery] = useState("");
  const c = bucketColors(bucket);
  const q = query.trim().toLowerCase();
  const filtered = q ? STRATEGIES.filter(s => s.name.toLowerCase().includes(q) || s.id.toLowerCase().includes(q)) : STRATEGIES;
  const byGroup = {};
  filtered.forEach(s => { (byGroup[s.group] = byGroup[s.group] || []).push(s); });

  return (
    <div
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.72)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: "20px", zIndex: 100,
      }}
    >
      <div style={{
        background: T.surface, border: `1px solid ${T.border}`, borderRadius: "12px",
        width: "100%", maxWidth: "820px", maxHeight: "88vh",
        display: "flex", flexDirection: "column", overflow: "hidden",
      }}>
        <div style={{ padding: "14px 16px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: "10px" }}>
          <span style={{ fontSize: "14px", fontWeight: 700 }}>All Strategies</span>
          <span style={{ fontSize: "10px", color: T.amber }}>! = ID unverified</span>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={{ background: "none", border: "none", color: T.muted, cursor: "pointer", fontSize: "18px", lineHeight: 1, padding: "2px" }}>×</button>
        </div>
        <div style={{ padding: "10px 16px", borderBottom: `1px solid ${T.border}` }}>
          <input
            autoFocus
            style={base.input} value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search strategies…"
          />
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: "0 18px", alignItems: "start" }}>
            {MILLING_COLUMNS.map((col, i) => (
              <div key={i}>
                {col.map(g => byGroup[g] && (
                  <div key={g} style={{ marginBottom: "14px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "7px", marginBottom: "6px" }}>
                      <span style={{ fontSize: "10px", fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: T.blue }}>{g}</span>
                      {g === "Drilling" && <span style={{ fontSize: "9px", color: T.amber }}>incomplete</span>}
                      <div style={{ flex: 1, height: "1px", background: T.borderSoft }} />
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
                      {byGroup[g].map(s => {
                        const on = selected.has(s.id);
                        const isAutoLink = AUTO_LINK_PAIR.includes(s.id);
                        const memberOf = quickGroupsContaining(s.id);
                        return (
                          <button
                            key={s.id}
                            onClick={() => onToggle(s.id)}
                            style={{
                              display: "flex", alignItems: "center", gap: "7px",
                              padding: "7px 11px", borderRadius: "14px",
                              cursor: "pointer", textAlign: "left",
                              background: on ? c.bg : "#18181c",
                              border: `1px solid ${on ? c.bd : T.border}`,
                              fontFamily: T.sans, width: "100%",
                              transition: "background 0.12s, border-color 0.12s",
                            }}
                          >
                            <span style={{ fontSize: "12px", fontWeight: on ? 600 : 500, color: on ? c.fg : "#a5a5a5", flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.name}</span>
                            {isAutoLink && <span title="Auto-links with its 2D/3D twin" style={{ fontSize: "10px", color: on ? c.fg : T.blue, fontWeight: 700, flexShrink: 0 }}>⇄</span>}
                            {!isAutoLink && memberOf.length > 0 && (
                              <span title={`Part of: ${memberOf.map(g2 => g2.label).join(", ")}`} style={{ width: "6px", height: "6px", borderRadius: "3px", background: T.violet, flexShrink: 0 }} />
                            )}
                            {!s.confirmed && <span title="ID unverified" style={{ color: T.amber, fontSize: "10px", fontWeight: 700, flexShrink: 0 }}>!</span>}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
          {filtered.length === 0 && (
            <div style={{ fontSize: "12px", color: T.muted, padding: "20px", textAlign: "center" }}>No strategies match "{query}"</div>
          )}
        </div>
        <div style={{ padding: "10px 16px", borderTop: `1px solid ${T.border}`, display: "flex", justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{
            padding: "8px 16px", borderRadius: "6px", fontSize: "12px", fontWeight: 600,
            cursor: "pointer", border: "none", background: T.blue, color: "#fff", fontFamily: T.sans,
          }}>Done</button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   SMALL BORE ROW — lives INSIDE the Feedrates section.

   It compensates chip load, so it sits directly under the cutting-feed
   cluster. Two FIXED rows that always occupy the same height — no popping
   open downward as you type. Everything fits across at normal width.

   Compensation applies LIVE: change the bore Ø or the start fz and the
   compensated fz is pushed straight through the normal cascade, so cutting
   feed follows and its slider dims like any other edit. No Apply button.

   Still locks the Strategy section's bucket to Finishing (cross-lock).

   Claude Code:
   - boreCompensation() + SmallBoreIcon are the SHARED util — one source,
     reused anywhere bore comp appears. Don't duplicate the math.
   - `baseFz` is the uncompensated start value and must PERSIST on the
     preset (new field, e.g. f_z_base) — otherwise reopening a saved
     small-bore preset re-compensates an already-compensated fz and the
     feed collapses a little more every open. This mockup keeps it in
     local state only.
   - The live-apply effect fires on baseFz / boreDia / active only. Do NOT
     add draft.f_z to its deps or dragging the fz slider fights the effect.
   ═══════════════════════════════════════════════════════════════════════ */
function SmallBoreRow({ tool, rpm, active, available, onToggle, boreDia, setBoreDia, baseFz, setBaseFz, actualFz, onCompute, bucketC }) {
  const comp = boreCompensation(tool.diameter, boreDia);
  const flutes = tool.flutes || 1;
  const baseFzNum = parseFloat(baseFz) || 0;
  const currentVf = rpm * flutes * baseFzNum;
  const compFz = comp && !comp.error ? baseFzNum * comp.factor : null;
  const compVf = compFz !== null ? rpm * flutes * compFz : null;
  const minorEffect = comp && !comp.error && comp.factor > 0.8;
  const live = active && comp && !comp.error;

  /* Override detection — the user reached up and moved the feed slider after
     compensation landed. Small bore doesn't fight them, but it stops
     claiming credit for a number it didn't produce: the compensated value
     is shown struck through and the value actually in effect is flagged
     amber. Tolerance is half a display step, not zero, so float dust from
     the cascade doesn't trip it. */
  const suggested = live ? round("f_z", compFz) : null;
  const inEffect = actualFz == null ? null : round("f_z", actualFz);
  const overridden = live && inEffect !== null && Math.abs(inEffect - suggested) > 0.00005;
  const effVf = overridden ? rpm * flutes * inEffect : compVf;

  // Live apply — push compensated fz through the cascade as values change.
  useEffect(() => {
    if (live) onCompute(round("f_z", compFz));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, baseFz, boreDia]);

  const cell = { display: "flex", alignItems: "center", gap: "5px" };
  const tag = { fontSize: "9.5px", color: T.muted, letterSpacing: "0.05em", fontWeight: 700 };

  return (
    <div style={{ marginTop: "12px", paddingTop: "12px", borderTop: `1px dashed ${T.border}` }}>
      {/* Row 1 — toggle, geometry, explainer */}
      <div style={{ display: "flex", alignItems: "center", gap: "14px", flexWrap: "wrap", minHeight: "34px" }}>
        <button
          onClick={() => available && onToggle(!active)}
          disabled={!available}
          style={{
            display: "flex", alignItems: "center", gap: "8px",
            padding: "5px 12px 5px 9px", borderRadius: "8px",
            border: `1px solid ${active ? bucketC.bd : T.border}`,
            background: active ? bucketC.bg : "transparent",
            color: active ? bucketC.fg : T.muted,
            cursor: available ? "pointer" : "not-allowed",
            opacity: available ? 1 : 0.4,
            fontFamily: T.sans, fontSize: "12.5px", fontWeight: 700,
            transition: "all 0.14s", flexShrink: 0,
          }}
        >
          <SmallBoreIcon size={19} />
          Small bore
        </button>

        <div style={{ display: "flex", alignItems: "center", gap: "14px", opacity: active ? 1 : 0.35, flexWrap: "wrap" }}>
          <div style={cell}>
            <span style={tag}>TOOL</span>
            <span style={{ fontFamily: T.mono, fontSize: "12.5px", color: T.text }}>Ø{tool.diameter}</span>
          </div>
          <div style={cell}>
            <span style={tag}>BORE</span>
            <span style={{ fontFamily: T.mono, fontSize: "12px", color: T.muted }}>Ø</span>
            <input
              className="td-noSpin"
              style={{ ...base.input, width: "74px", fontFamily: T.mono, padding: "4px 7px", fontSize: "12.5px", textAlign: "left" }}
              value={boreDia} onChange={e => setBoreDia(e.target.value)}
              disabled={!active} placeholder="0.485"
            />
            <span style={{ fontSize: "9.5px", color: T.muted }}>in</span>
          </div>
          <div style={cell}>
            <span style={tag}>COMP</span>
            <span style={{ fontFamily: T.mono, fontSize: "13.5px", fontWeight: 700, color: live ? T.blue : T.veryMuted }}>
              {live ? `${(comp.factor * 100).toFixed(1)}%` : "—"}
            </span>
            {live && (
              <InfoTip width={280}>
                Tool center orbits{" "}
                <span style={{ fontFamily: T.mono, color: T.blue }}>Ø{comp.centerCircle.toFixed(3)}</span>
                {" "}while the cutting edge sweeps{" "}
                <span style={{ fontFamily: T.mono, color: T.blue }}>Ø{parseFloat(boreDia).toFixed(3)}</span>.
                {" "}Both share the same angular velocity, so the edge travels{" "}
                <span style={{ fontFamily: T.mono, color: T.amber, fontWeight: 700 }}>{comp.ratio.toFixed(2)}×</span>
                {" "}farther per revolution.
                <br /><br />
                CAM programs feedrate at the tool center, so the edge sees {comp.ratio.toFixed(2)}× the programmed chip load.
                <br /><br />
                <span style={{ color: T.muted }}>Arc compensation only — radial chip thinning partially offsets this and is left to your judgment.</span>
              </InfoTip>
            )}
          </div>
        </div>

        <div style={{ flex: 1, minWidth: "4px" }} />

        {/* Status slot — always reserved, so the row height never changes */}
        <span style={{ fontSize: "10px", color: !available ? T.muted : minorEffect ? T.amber : T.veryMuted, textAlign: "right" }}>
          {!available
            ? "Requires Bore or Contour strategy"
            : active && comp?.error
              ? <span style={{ color: T.red }}>{comp.error}</span>
              : minorEffect
                ? "Minor at this ratio — may not be needed"
                : "\u00A0"}
        </span>
      </div>

      {/* Row 2 — the before → after readout. Always present, dimmed when off.
          Turns amber when the feed in effect isn't what compensation asked
          for, so an override is never silent. */}
      <div style={{
        marginTop: "8px", background: overridden ? T.amberD : "#101013",
        border: `1px solid ${overridden ? T.amberB : T.border}`,
        borderRadius: "7px", padding: "8px 12px",
        display: "flex", alignItems: "center", gap: "20px", flexWrap: "wrap",
        opacity: live ? 1 : 0.3, transition: "opacity 0.15s, background 0.15s, border-color 0.15s",
      }}>
        <div style={cell}>
          <span style={tag}>FZ START</span>
          <input
            className="td-noSpin"
            type="number" step="0.0001"
            style={{ ...base.input, width: "78px", fontFamily: T.mono, fontSize: "12px", padding: "3px 6px", textAlign: "left" }}
            value={baseFz} onChange={e => setBaseFz(e.target.value)}
            disabled={!active} placeholder="0.0008"
          />
          <span style={{ color: T.muted, fontSize: "11px" }}>→</span>
          <span style={{
            fontFamily: T.mono, fontSize: "13px", fontWeight: 700,
            color: overridden ? T.veryMuted : T.text,
            textDecoration: overridden ? "line-through" : "none",
          }}>{live ? compFz.toFixed(4) : "—"}</span>
          {overridden && (
            <span style={{ fontFamily: T.mono, fontSize: "13px", fontWeight: 700, color: T.amber }}>
              {inEffect.toFixed(4)}
            </span>
          )}
          <span style={{ fontSize: "9.5px", color: T.muted }}>in</span>
        </div>

        <div style={cell}>
          <span style={tag}>FEED</span>
          <span style={{ fontFamily: T.mono, fontSize: "12px", color: T.veryMuted }}>{currentVf.toFixed(2)}</span>
          <span style={{ color: T.muted, fontSize: "11px" }}>→</span>
          <span style={{ fontFamily: T.mono, fontSize: "13px", fontWeight: 700, color: overridden ? T.amber : T.text }}>
            {live ? effVf.toFixed(2) : "—"}
          </span>
          <span style={{ fontSize: "9.5px", color: T.muted }}>in/min</span>
        </div>

        <div style={{ flex: 1, minWidth: "4px" }} />

        {overridden ? (
          <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{
              fontSize: "9.5px", fontWeight: 800, letterSpacing: "0.06em",
              color: T.amber, background: "#00000055",
              border: `1px solid ${T.amberB}`, borderRadius: "4px", padding: "2px 6px",
            }}>OVERRIDDEN</span>
            <button
              onClick={() => onCompute(suggested)}
              style={{
                padding: "3px 9px", borderRadius: "5px", fontSize: "10px", fontWeight: 700,
                cursor: "pointer", border: `1px solid ${T.amberB}`, background: "transparent",
                color: T.amber, fontFamily: T.sans, whiteSpace: "nowrap",
              }}
            >Restore {suggested.toFixed(4)}</button>
          </span>
        ) : (
          <span style={{ fontSize: "10px", color: T.veryMuted }}>Applied live to feed per tooth above</span>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE UNIFIED EDITOR
   ═══════════════════════════════════════════════════════════════════════ */
const DEMO_TOOL = { diameter: 0.375, flutes: 4, fluteLength: 0.9 };

// fx defaults mirror PresetPanel DEFAULT_FX (milling variant: plunge manual)
const DEFAULT_FX = {
  n: "manual", v_c: "formula", n_ramp: "formula",
  f_z: "manual", v_f: "formula",
  v_f_leadIn: "formula", v_f_leadOut: "formula", v_f_transition: "formula",
  v_f_plunge: "manual", f_n: "formula",
  v_f_ramp: "manual", ramp_angle: "manual",
};

function UnifiedEditor({ preset, tool, onSave, onCancel }) {
  // ── Values + fx state ─────────────────────────────────────────────────────
  const [draft, setDraft] = useState(() => ({ ...preset }));
  const [fx, setFx] = useState({ ...DEFAULT_FX });
  const [name, setName] = useState(preset.name);

  // ── Strategy state (from StrategyPickerUI) ────────────────────────────────
  const [bucket, setBucket] = useState(preset.bucket || "roughing");
  const [intensity, setIntensity] = useState(preset.intensity || "normal");
  const [selected, setSelected] = useState(new Set(preset.strategies || []));
  const [smallBore, setSmallBore] = useState(preset.smallBore || false);
  const [boreDia, setBoreDia] = useState(preset.smallBoreDiameter || "");
  // Uncompensated chip load the small-bore comp works from.
  // Claude Code: this must persist on the preset (see SmallBoreRow notes).
  const [baseFz, setBaseFz] = useState(preset.f_z);
  const [listOpen, setListOpen] = useState(false);

  // Passes & Linking — stored as factors here, written back as absolutes.
  const [stepdownOn, setStepdownOn] = useState(true);
  const [stepdownF, setStepdownF] = useState(0.9);
  const [stepoverOn, setStepoverOn] = useState(true);
  const [stepoverF, setStepoverF] = useState(0.08);

  const d = tool.diameter, z = tool.flutes;

  /* ── The cascade — same shape as PresetPanel handleNumChange ─────────────
     Claude Code: do NOT reimplement. Wire LinkedSlider.onChange straight
     into the existing handleNumChange. This mockup copy exists only so the
     demo behaves. */
  function change(field, value) {
    const nd = { ...draft, [field]: value };
    const nfx = { ...fx, [field]: "manual" };
    let n = draft.n ?? 0;

    if (field === "n") {
      n = value ?? 0;
      nd.v_c = round("v_c", rpmToSFM(n, d)); nfx.v_c = "formula";
      if (fx.n_ramp !== "manual") { nd.n_ramp = round("n_ramp", n); nfx.n_ramp = "formula"; }
    } else if (field === "v_c") {
      n = round("n", sfmToRPM(value ?? 0, d));
      nd.n = n; nfx.n = "formula";
      if (fx.n_ramp !== "manual") { nd.n_ramp = n; nfx.n_ramp = "formula"; }
    }

    if (field === "f_z") { nd.v_f = round("v_f", fptToIPM(value ?? 0, n, z)); nfx.v_f = "formula"; }
    else if (field === "v_f") { nd.f_z = round("f_z", ipmToFPT(value ?? 0, n, z)); nfx.f_z = "formula"; }
    else if (field === "n" || field === "v_c") {
      if (fx.f_z === "manual") { nd.v_f = round("v_f", fptToIPM(draft.f_z ?? 0, n, z)); nfx.v_f = "formula"; }
      else { nd.f_z = round("f_z", ipmToFPT(draft.v_f ?? 0, n, z)); nfx.f_z = "formula"; }
    }

    if (field === "f_n") { nd.v_f_plunge = round("v_f_plunge", iprToIPM(value ?? 0, n)); nfx.v_f_plunge = "formula"; }
    else if (field === "v_f_plunge") { nd.f_n = round("f_n", ipmToIPR(value ?? 0, n)); nfx.f_n = "formula"; }
    else if (field === "n" || field === "v_c") {
      if (fx.f_n === "manual") { nd.v_f_plunge = round("v_f_plunge", iprToIPM(draft.f_n ?? 0, n)); nfx.v_f_plunge = "formula"; }
      else { nd.f_n = round("f_n", ipmToIPR(draft.v_f_plunge ?? 0, n)); nfx.f_n = "formula"; }
    }

    const vf = nd.v_f ?? draft.v_f ?? 0;
    if (nfx.v_f_leadIn !== "manual") nd.v_f_leadIn = round("v_f_leadIn", vf);
    if (nfx.v_f_leadOut !== "manual") nd.v_f_leadOut = round("v_f_leadOut", vf);
    if (nfx.v_f_transition !== "manual") nd.v_f_transition = round("v_f_transition", vf);

    setDraft(nd);
    setFx(nfx);
  }

  // ── Strategy derived state ────────────────────────────────────────────────
  const smallBoreAvailable = SMALL_BORE_STRATEGIES.some(id => selected.has(id));
  const smallBoreOn = smallBore && smallBoreAvailable;
  let effectiveBucket = bucket;
  let lockReason = null;
  if (smallBoreOn) { effectiveBucket = "finishing"; lockReason = "Small bore"; }
  const locked = lockReason !== null;
  const c = bucketColors(effectiveBucket);
  const modifier = nameModifier(effectiveBucket, intensity, smallBoreOn);
  const selectedList = STRATEGIES.filter(s => selected.has(s.id));

  function toggle(id) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else {
        next.add(id);
        if (AUTO_LINK_PAIR.includes(id)) AUTO_LINK_PAIR.forEach(m => next.add(m));
      }
      return next;
    });
  }

  function toggleQuickGroup(group, additive) {
    const memberIds = group.members;
    const wasFull = memberIds.every(id => selected.has(id));
    setSelected(prev => {
      const next = new Set(prev);
      if (!additive) {
        [...next].forEach(id => {
          const groups = quickGroupsContaining(id);
          if (groups.length > 0 && !groups.some(g => g.key === group.key)) next.delete(id);
        });
      }
      if (wasFull) memberIds.forEach(id => next.delete(id));
      else memberIds.forEach(id => next.add(id));
      return next;
    });
    if (!wasFull && group.suggestBucket && !smallBoreOn) setBucket(group.suggestBucket);
  }

  return (
    <div style={{
      background: T.surface, border: `1px solid ${T.blueB}`, borderRadius: "14px",
      padding: "16px", boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
    }}>
      {/* ── Header — name, live modifier, save ─────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "14px", flexWrap: "wrap" }}>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Preset name"
          style={{ ...base.input, flex: 1, minWidth: "220px", fontSize: "15px", fontWeight: 700, padding: "9px 12px" }}
        />
        <ModifierBadge modifier={modifier} colors={c} />
        <span style={{ fontFamily: T.mono, fontSize: "11px", color: T.muted }}>
          Ø{tool.diameter} · {tool.flutes}FL
        </span>
        <button onClick={() => onSave({
          ...draft, name,
          bucket: effectiveBucket, intensity, strategies: [...selected],
          smallBore: smallBoreOn, smallBoreDiameter: smallBoreOn ? boreDia : null,
          f_z_base: baseFz,
          // Fusion stores absolutes, not factors — convert on the way out.
          "use-stepdown": stepdownOn, stepdown: stepdownOn ? round("f_z", stepdownF * tool.fluteLength) : null,
          "use-stepover": stepoverOn, stepover: stepoverOn ? round("f_z", stepoverF * tool.diameter) : null,
        })} style={{
          padding: "9px 18px", borderRadius: "7px", fontSize: "13px", fontWeight: 700,
          cursor: "pointer", border: "none", background: T.blue, color: "#fff", fontFamily: T.sans,
        }}>✓ Save</button>
        <button onClick={onCancel} style={{
          padding: "9px 12px", borderRadius: "7px", fontSize: "13px",
          cursor: "pointer", border: `1px solid ${T.border}`, background: "transparent", color: T.muted, fontFamily: T.sans,
        }}>×</button>
      </div>

      {/* ── Row 1: Setup — Material | Assembly & Machine ────────────────────
             The old "Operation" dropdown lived here; it's gone. Operation is
             now the Rough/Finish toggle in the Strategy section, so this row
             is purely "what and where" — leaving the name honest. ────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "10px", marginBottom: "10px" }}>
        <Section label="Material" color={T.violet}>
          <FGroup label="CAM preset">
            {/* Opens the existing CamPresetPicker modal — unchanged.
                Claude Code: the metal/plastic "Filter by type" select is gone
                from the UI on purpose. material.category is still written to
                the draft (Fusion's export needs it) — keep setting it from
                materialCategory(query) when a CAM preset is picked, exactly
                as the picker's onSelect already does. Just don't show it. */}
            <button style={{
              ...base.input, textAlign: "left", cursor: "pointer",
              display: "flex", alignItems: "center", gap: "7px",
            }}>
              <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#e8c547", flexShrink: 0 }} />
              <span style={{ flex: 1 }}>SS 316L</span>
              <span style={{ color: T.muted }}>▾</span>
            </button>
          </FGroup>
        </Section>

        <Section label="Assembly & Machine" color={T.violet}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
            <FGroup label="Assembly (holder + OOH)">
              <select style={{ ...base.input, cursor: "pointer" }} defaultValue="a">
                <option value="a">30-SK13 · 1.350 in</option>
                <option value="b">30-SK10 · 1.100 in</option>
              </select>
            </FGroup>
            <FGroup label="Machine">
              <select style={{ ...base.input, cursor: "pointer" }} defaultValue="">
                <option value="">— None —</option>
                <option>M300X3</option><option>M300Xd1</option><option>R650</option>
              </select>
            </FGroup>
          </div>
        </Section>
      </div>

      {/* ── Row 2: Strategy — replaces the old Operation dropdown + separate
             picker modal. Bucket + intensity + quick groups all inline. ────── */}
      <Section
        label="Strategy"
        color={c.fg}
        style={{ marginBottom: "10px" }}
        right={
          <button onClick={() => setListOpen(true)} style={{
            padding: "4px 10px", borderRadius: "6px", fontSize: "11px", fontWeight: 600,
            cursor: "pointer", border: `1px solid ${T.border}`, background: T.raise, color: T.text, fontFamily: T.sans,
          }}>All strategies…</button>
        }
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: "22px", flexWrap: "wrap", marginBottom: "12px" }}>
          <div>
            <FGroup label="Operation">
              <BucketToggle value={effectiveBucket} onChange={setBucket} locked={locked} />
            </FGroup>
            {/* Always rendered — visibility toggles so rows don't shift */}
            <div style={{ fontSize: "10px", marginTop: "5px", color: T.muted, visibility: lockReason ? "visible" : "hidden" }}>
              Locked by {lockReason || "—"} (in Feedrates)
            </div>
          </div>
          <div style={{ flex: 1, minWidth: "220px", maxWidth: "340px" }}>
            <FGroup label="Intensity">
              <IntensityMeter value={intensity} bucket={effectiveBucket} onChange={setIntensity} />
            </FGroup>
          </div>
        </div>

        <FGroup label="Quick groups — click selects one, shift-click combines">
          <div style={{ display: "flex", flexWrap: "wrap", gap: "7px", marginBottom: "10px", alignItems: "center" }}>
            {QUICK_GROUPS.map(g => (
              <QuickGroupButton key={g.key} group={g} selected={selected} onClick={e => toggleQuickGroup(g, e.shiftKey)} />
            ))}
            {/* Divider — pinned singles are a different kind of pick than groups */}
            <span style={{ width: "1px", alignSelf: "stretch", background: T.border, margin: "2px 2px" }} />
            {PINNED_STRATEGIES.map(id => {
              const s = STRATEGIES.find(x => x.id === id);
              return s && (
                <PinnedStrategyButton
                  key={id} strategy={s} selected={selected}
                  bucket={effectiveBucket} onClick={() => toggle(id)}
                />
              );
            })}
          </div>
        </FGroup>

        <div style={{ display: "flex", flexWrap: "wrap", gap: "5px", minHeight: "24px" }}>
          {selectedList.length === 0 ? (
            <span style={{ fontSize: "11px", color: T.veryMuted }}>No strategies selected — Fusion may reject this preset</span>
          ) : (
            selectedList.map(s => <StrategyPill key={s.id} strategy={s} bucket={effectiveBucket} onRemove={() => toggle(s.id)} />)
          )}
        </div>
      </Section>

      {/* ── Row 3: Speed + Passes & Linking side by side ────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "10px", marginBottom: "10px" }}>
        <Section label="Speed" color={T.blue}>
          <LinkedSlider field="n" label="Spindle speed" unit="RPM" value={draft.n} fxState={fx.n} onChange={v => change("n", v)} />
          <LinkedSlider field="v_c" label="Surface speed" unit="SFM" value={draft.v_c} fxState={fx.v_c} onChange={v => change("v_c", v)} />
          <LinkedSlider field="n_ramp" label="Ramp spindle" unit="RPM" value={draft.n_ramp} fxState={fx.n_ramp} onChange={v => change("n_ramp", v)} />
        </Section>

        <Section label="Passes & Linking" color={T.blue}>
          <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            <FactorSlider
              label="Stepdown"
              enabled={stepdownOn} onToggle={setStepdownOn}
              factor={stepdownF} onFactorChange={setStepdownF}
              refDim={tool.fluteLength} refLabel="flute length"
              lenUnit="in"
            />
            <FactorSlider
              label="Stepover"
              enabled={stepoverOn} onToggle={setStepoverOn}
              factor={stepoverF} onFactorChange={setStepoverF}
              refDim={tool.diameter} refLabel="diameter"
              lenUnit="in"
            />
            {/* MRR = radial width × axial depth × feed. Uses the ABSOLUTE step
                values (0 when a step is toggled off) and the live cutting
                feedrate, so it moves as you drag any of the three. */}
            <MRRIndicator
              ae={stepoverOn ? stepoverF * tool.diameter : 0}
              ap={stepdownOn ? stepdownF * tool.fluteLength : 0}
              vf={draft.v_f}
              accent={c.fg}
            />
          </div>
        </Section>
      </div>

      {/* ── Row 4: Feedrates — the slider showcase + Small Bore ─────────────── */}
      <Section label="Feedrates" color={c.fg} style={{ marginBottom: "10px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: "6px 28px" }}>
          {/* Cutting cluster */}
          <div>
            <div style={{ fontSize: "9px", fontWeight: 800, letterSpacing: "0.1em", color: T.muted, marginBottom: "4px" }}>CUTTING</div>
            <LinkedSlider field="f_z" label="Feed per tooth" unit="in" value={draft.f_z} fxState={fx.f_z} onChange={v => change("f_z", v)} accent={c.fg} />
            <LinkedSlider field="v_f" label="Cutting feedrate" unit="in/min" value={draft.v_f} fxState={fx.v_f} onChange={v => change("v_f", v)} accent={c.fg} />
            <LinkedSlider field="v_f_leadIn" label="Lead-in" unit="in/min" value={draft.v_f_leadIn} fxState={fx.v_f_leadIn} onChange={v => change("v_f_leadIn", v)} accent={c.fg} compact />
            <LinkedSlider field="v_f_leadOut" label="Lead-out" unit="in/min" value={draft.v_f_leadOut} fxState={fx.v_f_leadOut} onChange={v => change("v_f_leadOut", v)} accent={c.fg} compact />
            <LinkedSlider field="v_f_transition" label="Transition" unit="in/min" value={draft.v_f_transition} fxState={fx.v_f_transition} onChange={v => change("v_f_transition", v)} accent={c.fg} compact />
          </div>
          {/* Plunge + ramp cluster */}
          <div>
            <div style={{ fontSize: "9px", fontWeight: 800, letterSpacing: "0.1em", color: T.muted, marginBottom: "4px" }}>PLUNGE & RAMP</div>
            <LinkedSlider field="v_f_plunge" label="Plunge feedrate" unit="in/min" value={draft.v_f_plunge} fxState={fx.v_f_plunge} onChange={v => change("v_f_plunge", v)} accent={c.fg} />
            <LinkedSlider field="f_n" label="Feed per rev" unit="in/rev" value={draft.f_n} fxState={fx.f_n} onChange={v => change("f_n", v)} accent={c.fg} />
            <LinkedSlider field="v_f_ramp" label="Ramp feedrate" unit="in/min" value={draft.v_f_ramp} fxState={fx.v_f_ramp} onChange={v => change("v_f_ramp", v)} accent={c.fg} compact />
            <LinkedSlider field="ramp_angle" label="Ramp angle" unit="°" value={draft.ramp_angle} fxState={fx.ramp_angle} onChange={v => change("ramp_angle", v)} accent={c.fg} compact />
          </div>
        </div>

        {/* Small bore — HERE, because it compensates the chip load above.
            Compensation applies live through the normal cascade, so cutting
            feed follows and dims exactly like any other edit. */}
        <SmallBoreRow
          tool={tool} rpm={draft.n ?? 0}
          active={smallBoreOn} available={smallBoreAvailable}
          onToggle={setSmallBore} boreDia={boreDia} setBoreDia={setBoreDia}
          baseFz={baseFz} setBaseFz={setBaseFz}
          actualFz={draft.f_z}
          onCompute={v => change("f_z", v)} bucketC={c}
        />
      </Section>

      {/* ── Row 5: Footer — Coolant + Jobs, compact ─────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "10px" }}>
        <Section label="Coolant" color={T.muted}>
          <select style={{ ...base.input, cursor: "pointer" }} defaultValue="flood">
            <option value="flood">Flood</option>
            <option value="mist">Mist</option>
            <option value="air">Air blast</option>
            <option value="tsc">Through-spindle</option>
            <option value="none">None</option>
          </select>
        </Section>
        <Section label="Jobs" color={T.muted}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontSize: "12px", color: T.muted }}>Jobs (0)</span>
            <button style={{
              padding: "4px 10px", borderRadius: "6px", fontSize: "11px", fontWeight: 600,
              cursor: "pointer", border: `1px solid ${T.border}`, background: T.raise, color: T.text, fontFamily: T.sans,
            }}>+ Link job</button>
            <span style={{ fontSize: "10px", color: T.veryMuted }}>PresetJobsBlock unchanged</span>
          </div>
        </Section>
      </div>

      {listOpen && (
        <StrategyListPopout
          selected={selected}
          onToggle={toggle}
          bucket={effectiveBucket}
          onClose={() => setListOpen(false)}
        />
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   DEMO HARNESS — collapsed card row + editor open full width below.
   Claude Code: the card row is PresetPanel's existing CollapsedCard list —
   unchanged. Only the editor below it is new.
   ═══════════════════════════════════════════════════════════════════════ */
const DEMO_PRESET = {
  id: 1, name: "SS316L 1.350 30-SK13 Rough",
  bucket: "roughing", intensity: "normal",
  strategies: ["adaptive2d", "adaptive"],
  smallBore: false, smallBoreDiameter: null,
  n: 2445, v_c: 240, n_ramp: 2445,
  f_z: 0.0008, v_f: 7.82,
  v_f_leadIn: 7.82, v_f_leadOut: 7.82, v_f_transition: 7.82,
  v_f_plunge: 50, f_n: 0.0205,
  v_f_ramp: 6, ramp_angle: 2,
};

function MiniCard({ name, editing }) {
  return (
    <div style={{
      background: T.surface2, border: `1px solid ${editing ? T.blueB : T.border}`,
      borderRadius: "10px", padding: "10px 12px", minWidth: "170px",
      opacity: editing ? 1 : 0.7,
    }}>
      <div style={{ fontSize: "12px", fontWeight: 700, color: editing ? T.blue : T.text, marginBottom: "6px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{name}</div>
      <div style={{ fontFamily: T.mono, fontSize: "10px", color: T.muted, lineHeight: 1.7 }}>
        2445 rpm · 7.82 in/min<br />0.0008 fz · Flood
      </div>
      <div style={{ marginTop: "8px", fontSize: "10px", fontWeight: 700, color: editing ? T.blue : T.veryMuted }}>
        {editing ? "Editing…" : "Edit"}
      </div>
    </div>
  );
}

export default function App() {
  const [saved, setSaved] = useState(null);
  return (
    <div style={{ background: T.page, minHeight: "100vh", fontFamily: T.sans, color: T.text, padding: "22px 20px", maxWidth: "1100px", margin: "0 auto" }}>
      {/* Native spinner arrows removed — the slider is the increment control,
          and the arrows stole horizontal space from the number itself.
          Claude Code: fold this into the app's global input styles. */}
      <style>{`
        .td-noSpin::-webkit-outer-spin-button,
        .td-noSpin::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
        .td-noSpin[type=number] { -moz-appearance: textfield; appearance: textfield; }
        .td-noSpin::placeholder { color: ${T.veryMuted}; opacity: 1; }

        @keyframes td-drift-r {
          0%   { opacity: 0; transform: translateX(-5px); }
          40%  { opacity: 1; }
          100% { opacity: 0; transform: translateX(5px); }
        }
        @keyframes td-drift-l {
          0%   { opacity: 0; transform: translateX(5px); }
          40%  { opacity: 1; }
          100% { opacity: 0; transform: translateX(-5px); }
        }
        @media (prefers-reduced-motion: reduce) {
          @keyframes td-drift-r { 0%, 100% { opacity: 0.9; transform: none; } }
          @keyframes td-drift-l { 0%, 100% { opacity: 0.9; transform: none; } }
        }
      `}</style>
      <div style={{ marginBottom: "14px" }}>
        <h2 style={{ margin: "0 0 4px", fontSize: "18px", fontWeight: 700 }}>Speeds &amp; Feeds — Unified Editor</h2>
        <p style={{ margin: 0, fontSize: "12.5px", color: T.muted }}>
          One panel: setup, strategy, sliders, small bore. Drag any slider — its partner follows and dims. Grab the dimmed one to take it over.
        </p>
      </div>

      {/* Collapsed card row (existing UI, shown for context) */}
      <div style={{ display: "flex", gap: "10px", marginBottom: "12px", overflowX: "auto", paddingBottom: "4px" }}>
        <MiniCard name="AL6061 1.100 30-SK10 Rough" />
        <MiniCard name="SS316L 1.350 30-SK13 Rough" editing />
        <MiniCard name="Ti Finish 30-SK13" />
      </div>

      <UnifiedEditor
        preset={DEMO_PRESET}
        tool={DEMO_TOOL}
        onSave={p => setSaved(p)}
        onCancel={() => setSaved(null)}
      />

      {saved && (
        <div style={{ marginTop: "12px", background: T.finishD, border: `1px solid ${T.finishB}`, borderRadius: "8px", padding: "10px 12px", fontSize: "11px", color: T.finish, fontFamily: T.mono }}>
          Saved: {saved.name} · {saved.bucket} · {saved.strategies.length} strategies · fz {saved.f_z}
        </div>
      )}
    </div>
  );
}
