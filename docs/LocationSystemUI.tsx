import { useState, useRef, useEffect } from "react";

const T = {
  bg: "#111", surface: "#1c1c1c", raise: "#242424", border: "#2e2e2e",
  text: "#e2e2e2", muted: "#666", veryMuted: "#3a3a3a",
  blue: "#3d7fe6", blueD: "#141d2a", blueB: "#253a5e",
  green: "#3a9e5a", greenD: "#0f1e12", greenB: "#1e4028",
  orange: "#c98a28", orangeD: "#1e1208", orangeB: "#3e2808",
  mono: "'JetBrains Mono','Fira Mono',monospace",
  sans: "'Space Grotesk',system-ui,sans-serif",
};

const base = {
  input: {
    background: "#141414", border: `1px solid ${T.border}`, borderRadius: "6px",
    padding: "8px 10px", color: T.text, fontSize: "13px",
    width: "100%", boxSizing: "border-box", outline: "none", fontFamily: T.sans,
  },
  select: {
    background: "#141414", border: `1px solid ${T.border}`, borderRadius: "6px",
    padding: "8px 30px 8px 10px", color: T.text, fontSize: "13px",
    width: "100%", outline: "none", fontFamily: T.sans,
    appearance: "none", WebkitAppearance: "none", cursor: "pointer",
  },
};

function Select({ value, onChange, options, disabled }) {
  return (
    <div style={{ position: "relative" }}>
      <select
        style={{ ...base.select, opacity: disabled ? 0.35 : 1, cursor: disabled ? "not-allowed" : "pointer" }}
        value={value} onChange={onChange} disabled={disabled}
      >
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      <span style={{ position: "absolute", right: "10px", top: "50%", transform: "translateY(-50%)", pointerEvents: "none", color: T.muted, fontSize: "10px" }}>▼</span>
    </div>
  );
}

function Input({ value, onChange, placeholder, disabled, mono, style }) {
  return (
    <input
      style={{ ...base.input, fontFamily: mono ? T.mono : T.sans, opacity: disabled ? 0.35 : 1, ...style }}
      value={value} onChange={onChange} placeholder={placeholder} disabled={disabled}
    />
  );
}

function Toggle({ on, set }) {
  return (
    <button onClick={() => set(!on)} style={{
      width: "32px", height: "18px", borderRadius: "9px", flexShrink: 0,
      background: on ? T.blue : "#2a2a2a", position: "relative",
      cursor: "pointer", border: "none", transition: "background 0.15s",
    }}>
      <div style={{ position: "absolute", top: "3px", left: on ? "15px" : "3px", width: "12px", height: "12px", borderRadius: "6px", background: on ? "#fff" : "#555", transition: "left 0.15s" }} />
    </button>
  );
}

function Lbl({ children }) {
  return <div style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.09em", textTransform: "uppercase", color: T.muted, marginBottom: "5px" }}>{children}</div>;
}

function Badge({ color, children }) {
  const map = { g: [T.greenD, T.green, T.greenB], o: [T.orangeD, T.orange, T.orangeB], b: [T.blueD, T.blue, T.blueB] };
  const [bg, fg, bd] = map[color];
  return <span style={{ fontSize: "10px", padding: "2px 7px", borderRadius: "10px", fontWeight: 700, background: bg, color: fg, border: `1px solid ${bd}`, whiteSpace: "nowrap" }}>{children}</span>;
}

const ZONE_TYPES    = [["Building","Building"],["Floor","Floor"],["Area","Area"],["Department","Department"],["Zone","Zone"],["custom","Custom…"]];
const STATION_TYPES = [["Cabinet","Cabinet"],["Machine","Machine"],["Rack","Rack"],["Department","Department"],["Station","Station"],["custom","Custom…"]];
const DRAWER_TYPES  = [["Drawer","Drawer"],["Shelf","Shelf"],["Level","Level"],["Row","Row"],["Section","Section"],["custom","Custom…"]];
const IDENT_TYPES   = [["number","Number (1, 2, 3…)"],["letter","Letter (A, B, C…)"],["custom","Custom label"]];
const DELIM_OPTIONS = [["-","– dash"],[".",". dot"],["/","/ slash"],["|","| pipe"],["_","_ underscore"],[" ","  space"],["","none"]];

function buildPreview(sys) {
  const L = sys.levels; const D = sys.delimiters;
  function seg(level, num, let_) {
    if (!level.on) return null;
    if (level.identFormat === "custom") return level.customIdent || "…";
    if (level.identFormat === "letter") return let_;
    return num;
  }
  const binNum = L.bin.fixed ? (L.bin.fixedVal || "1000") : String(L.bin.start);
  const segs = [
    L.zone.on    ? { key: "zone",    val: seg(L.zone,    "1","A") } : null,
    L.station.on ? { key: "station", val: seg(L.station, "1","A") } : null,
    L.drawer.on  ? { key: "drawer",  val: seg(L.drawer,  "1","A") } : null,
    { key: "bin", val: binNum },
  ].filter(Boolean);
  const dk = (a, b) => a[0] + b[0];
  return segs.map((s, i) => s.val + (i < segs.length - 1 ? (D[dk(s.key, segs[i+1].key)] ?? "-") : "")).join("") || "—";
}

// ── Animated live preview badge ────────────────────────────────────────────
function LivePreview({ value }) {
  const [pop, setPop] = useState(false);
  const [hover, setHover] = useState(false);
  const prev = useRef(value);

  useEffect(() => {
    if (value !== prev.current) {
      prev.current = value;
      setPop(true);
      const t = setTimeout(() => setPop(false), 350);
      return () => clearTimeout(t);
    }
  }, [value]);

  return (
    <div
      style={{ position: "relative" }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {/* The preview box */}
      <div style={{
        background: T.blueD,
        border: `1px solid ${pop ? "#5a9fff" : T.blueB}`,
        borderRadius: "7px",
        padding: "5px 12px",
        display: "flex",
        alignItems: "center",
        gap: "6px",
        transform: pop ? "scale(1.06)" : "scale(1)",
        transition: "transform 0.15s ease-out, border-color 0.15s, box-shadow 0.15s",
        boxShadow: pop ? `0 0 10px rgba(61,127,230,0.4)` : "none",
        cursor: "default",
      }}>
        {/* Small "LIVE" dot */}
        <div style={{
          width: "6px", height: "6px", borderRadius: "3px",
          background: pop ? "#6bdfff" : T.blue,
          transition: "background 0.15s",
          flexShrink: 0,
        }} />
        <span style={{
          fontFamily: T.mono, fontSize: "14px", fontWeight: 700,
          color: pop ? "#9ecfff" : T.blue,
          transition: "color 0.15s",
          letterSpacing: "0.02em",
        }}>
          {value}
        </span>
      </div>

      {/* Hover tooltip */}
      {hover && (
        <div style={{
          position: "absolute", bottom: "calc(100% + 6px)", left: "50%",
          transform: "translateX(-50%)",
          background: "#0a0e18", border: `1px solid ${T.blueB}`,
          borderRadius: "5px", padding: "3px 8px",
          fontSize: "10px", color: T.blue, fontWeight: 600, whiteSpace: "nowrap",
          pointerEvents: "none",
          letterSpacing: "0.06em",
        }}>
          LIVE PREVIEW
        </div>
      )}
    </div>
  );
}

// ── Editable system name ───────────────────────────────────────────────────
function EditableName({ value, onChange }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef(null);

  function startEdit(e) {
    e.stopPropagation();
    setDraft(value);
    setEditing(true);
    // focus on next tick after render
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function commit() {
    if (draft.trim()) onChange(draft.trim());
    setEditing(false);
  }

  function handleKey(e) {
    if (e.key === "Enter") commit();
    if (e.key === "Escape") { setEditing(false); }
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        style={{
          background: "#141414", border: `1px solid ${T.blueB}`, borderRadius: "6px",
          padding: "4px 8px", color: T.text, fontSize: "14px", fontWeight: 700,
          fontFamily: T.sans, outline: "none", width: "180px",
        }}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={handleKey}
        onClick={e => e.stopPropagation()}
      />
    );
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
      <span style={{ fontWeight: 700, fontSize: "14px" }}>{value}</span>
      {/* ✏️ placeholder — Claude Code: replace with <Pencil size={13}> from lucide-react */}
      <button
        onClick={startEdit}
        title="Edit name"
        style={{
          background: "none", border: "none", cursor: "pointer",
          color: T.muted, padding: "2px", display: "flex", alignItems: "center",
          borderRadius: "4px", lineHeight: 1,
          fontSize: "12px",
        }}
      >
        {/* TODO: Claude Code — replace this ✏️ with <Pencil size={13} /> from lucide-react */}
        ✏️
      </button>
    </div>
  );
}

// ── Level block ────────────────────────────────────────────────────────────
function LevelBlock({ title, optional, active, onToggle, children }) {
  return (
    <div style={{ border: `1px solid ${active ? T.blueB : T.border}`, borderRadius: "8px", padding: "12px", background: active ? "#13192a" : "#111", transition: "border-color 0.15s" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
        {optional
          ? <Toggle on={active} set={onToggle} />
          : <div style={{ width: "32px", height: "18px", display: "flex", alignItems: "center" }}>
              <div style={{ width: "8px", height: "8px", borderRadius: "2px", background: T.blue }} />
            </div>
        }
        <span style={{ fontSize: "11px", fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: active ? T.blue : T.muted }}>
          {title}
        </span>
        {optional && <span style={{ fontSize: "10px", color: T.veryMuted }}>optional</span>}
      </div>
      <div style={{ opacity: active ? 1 : 0.3, pointerEvents: active ? "auto" : "none" }}>
        {children}
      </div>
    </div>
  );
}

// ── Delimiter row (always visible, grayed when inactive) ───────────────────
function DelimRow({ label, value, onChange, active }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "4px 0", opacity: active ? 1 : 0.22 }}>
      <div style={{ flex: 1, height: "1px", background: active ? "#2a3a5a" : T.border }} />
      <span style={{ fontSize: "10px", color: T.muted, whiteSpace: "nowrap" }}>{label}</span>
      <div style={{ width: "110px", position: "relative" }}>
        <select
          style={{ ...base.select, padding: "4px 24px 4px 8px", fontSize: "11px" }}
          value={value} onChange={e => onChange(e.target.value)} disabled={!active}
        >
          {DELIM_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <span style={{ position: "absolute", right: "8px", top: "50%", transform: "translateY(-50%)", pointerEvents: "none", color: T.muted, fontSize: "9px" }}>▼</span>
      </div>
      <div style={{ flex: 1, height: "1px", background: active ? "#2a3a5a" : T.border }} />
    </div>
  );
}

// ── Option pills (for station/zone) ───────────────────────────────────────
function OptionPills({ items, onRemove, onAdd, placeholder }) {
  const [val, setVal] = useState("");
  function add() { if (val.trim()) { onAdd(val.trim()); setVal(""); } }
  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "5px", marginBottom: "7px", minHeight: "22px" }}>
        {items.length === 0
          ? <span style={{ fontSize: "11px", color: T.veryMuted }}>None added yet</span>
          : items.map((item, i) => (
              <span key={i} style={{ background: T.blueD, border: `1px solid ${T.blueB}`, borderRadius: "4px", padding: "2px 8px", fontSize: "12px", fontFamily: T.mono, display: "inline-flex", alignItems: "center", gap: "5px" }}>
                {item}
                <button style={{ background: "none", border: "none", color: T.muted, cursor: "pointer", padding: 0, lineHeight: 1 }} onClick={() => onRemove(i)}>×</button>
              </span>
            ))
        }
      </div>
      <div style={{ display: "flex", gap: "6px" }}>
        <input style={{ ...base.input, flex: 1 }} value={val} onChange={e => setVal(e.target.value)} onKeyDown={e => e.key === "Enter" && add()} placeholder={placeholder} />
        <button onClick={add} style={{ padding: "7px 12px", borderRadius: "6px", fontSize: "12px", fontWeight: 600, cursor: "pointer", border: "none", background: T.raise, color: T.text, fontFamily: T.sans, flexShrink: 0 }}>Add</button>
      </div>
    </div>
  );
}

// ── Shared level type + identifier fields ──────────────────────────────────
function LevelFields({ level, types, updateLevel }) {
  const typeName = level.levelType === "custom" ? (level.customTypeName || "Custom") : level.levelType;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
      <div>
        <Lbl>Level type</Lbl>
        <Select value={level.levelType} onChange={e => updateLevel({ levelType: e.target.value })} options={types} />
        {level.levelType === "custom" && (
          <Input value={level.customTypeName} onChange={e => updateLevel({ customTypeName: e.target.value })} placeholder="Type name" style={{ marginTop: "6px" }} />
        )}
      </div>
      <div>
        <Lbl>Identifier</Lbl>
        <Select value={level.identFormat} onChange={e => updateLevel({ identFormat: e.target.value })} options={IDENT_TYPES} />
        {level.identFormat === "custom" && (
          <Input value={level.customIdent} onChange={e => updateLevel({ customIdent: e.target.value })} placeholder="e.g. LC" mono style={{ marginTop: "6px" }} />
        )}
      </div>
      {level.identFormat !== "custom" && (
        <div style={{ gridColumn: "1 / -1" }}>
          <Lbl>{typeName}s in this shop</Lbl>
          <OptionPills
            items={level.options}
            onRemove={i => updateLevel({ options: level.options.filter((_, j) => j !== i) })}
            onAdd={v => updateLevel({ options: [...level.options, v] })}
            placeholder={`Add ${typeName.toLowerCase()}…`}
          />
        </div>
      )}
    </div>
  );
}

function proShopHint(mode, fixedVal) {
  if (mode === "number_only") return '"LC-140" → "140"';
  if (mode === "fixed") return `Always → "${fixedVal || "?"}"`;
  if (mode === "full") return "Exports as-is";
  return "";
}

// ── Tooltip helper ────────────────────────────────────────────────────────
function Tooltip({ text, children }) {
  const [show, setShow] = useState(false);
  return (
    <div style={{ position: "relative", display: "inline-flex" }}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      {children}
      {show && (
        <div style={{
          position: "absolute", bottom: "calc(100% + 6px)", left: "50%",
          transform: "translateX(-50%)", zIndex: 10,
          background: "#0d0d0d", border: `1px solid ${T.border}`,
          borderRadius: "6px", padding: "8px 10px",
          fontSize: "11px", color: T.text, lineHeight: "1.5",
          width: "240px", pointerEvents: "none",
          boxShadow: "0 4px 16px rgba(0,0,0,0.6)",
        }}>
          {text}
        </div>
      )}
    </div>
  );
}

// ── Normalization step ────────────────────────────────────────────────────
// In the real app, analysis reads tool_metadata.json and parses location strings
// against this system's pattern. Here we simulate the result.
const MOCK_ANALYSIS = {
  lc:    { matched: 237, nextBin: 246, unmatched: ["LC 84", "LC14", "LC -158"], noLocation: 3 },
  drill: { matched: 8,   nextBin: null, unmatched: ["1000A"], noLocation: 3 },
};

function NormalizationStep({ sys, onUpdate }) {
  const [phase, setPhase] = useState(sys.normalized ? "done" : "idle"); // idle | analyzing | preview | done
  const analysis = MOCK_ANALYSIS[sys.id] || { matched: 0, nextBin: null, unmatched: [], noLocation: 0 };

  function runAnalysis() {
    setPhase("analyzing");
    setTimeout(() => setPhase("preview"), 900); // simulate async scan
  }

  function commit() {
    onUpdate({ ...sys, normalized: true });
    setPhase("done");
  }

  function reset() {
    onUpdate({ ...sys, normalized: false });
    setPhase("idle");
  }

  const tooltipText = "Scans your tool library and matches each tool's current location text to this system's pattern. Once complete, this app owns location data — ProShop imports won't overwrite it, and next-available bin suggestions become accurate.";

  return (
    <div style={{ marginTop: "16px", borderTop: `1px solid ${T.border}`, paddingTop: "16px" }}>

      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
        <span style={{ fontSize: "12px", fontWeight: 700, color: T.text }}>Location Normalization</span>
        <Tooltip text={tooltipText}>
          <span style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            width: "16px", height: "16px", borderRadius: "8px",
            background: T.raise, border: `1px solid ${T.border}`,
            fontSize: "10px", color: T.muted, cursor: "default", fontWeight: 700,
          }}>?</span>
        </Tooltip>
        {phase === "done" && <Badge color="g">Complete</Badge>}
        {phase === "idle" && <Badge color="o">Not run</Badge>}
        {phase === "preview" && <Badge color="b">Ready to commit</Badge>}
      </div>

      {/* Idle state */}
      {phase === "idle" && (
        <div>
          <p style={{ fontSize: "12px", color: T.muted, margin: "0 0 10px" }}>
            Scan the tool library to match existing location text to this system. Shows matched tools, next available bin, and anything that doesn't fit.
          </p>
          <button
            onClick={runAnalysis}
            style={{ padding: "8px 16px", borderRadius: "6px", fontSize: "12px", fontWeight: 600, cursor: "pointer", border: `1px solid ${T.blueB}`, background: T.blueD, color: T.blue, fontFamily: T.sans }}
          >
            Analyze library →
          </button>
        </div>
      )}

      {/* Analyzing */}
      {phase === "analyzing" && (
        <div style={{ display: "flex", alignItems: "center", gap: "10px", fontSize: "12px", color: T.muted }}>
          <div style={{ width: "14px", height: "14px", borderRadius: "7px", border: `2px solid ${T.blueB}`, borderTopColor: T.blue, animation: "spin 0.7s linear infinite" }} />
          Scanning tool library…
        </div>
      )}

      {/* Preview — show results before committing */}
      {phase === "preview" && (
        <div>
          {/* Matched */}
          <div style={{ background: T.greenD, border: `1px solid ${T.greenB}`, borderRadius: "7px", padding: "10px 12px", marginBottom: "8px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "6px" }}>
              <span style={{ fontSize: "13px", fontWeight: 700, color: T.green }}>
                {analysis.matched} tools matched this system
              </span>
              {analysis.nextBin !== null
                ? <span style={{ fontSize: "11px", color: T.green }}>Next available bin: <span style={{ fontFamily: T.mono, fontWeight: 700 }}>{analysis.nextBin}</span></span>
                : <span style={{ fontSize: "11px", color: T.green }}>Fixed value — no counter needed</span>
              }
            </div>
          </div>
          <div style={{ fontSize: "11px", color: T.muted, marginBottom: "10px" }}>
            Tools that don't match this pattern will appear in the unmatched list below all systems.
          </div>
          <div style={{ display: "flex", gap: "8px" }}>
            <button onClick={commit} style={{ padding: "8px 16px", borderRadius: "6px", fontSize: "12px", fontWeight: 600, cursor: "pointer", border: "none", background: T.blue, color: "#fff", fontFamily: T.sans }}>
              Normalize {analysis.matched} tools
            </button>
            <button onClick={() => setPhase("idle")} style={{ padding: "8px 12px", borderRadius: "6px", fontSize: "12px", fontWeight: 600, cursor: "pointer", border: `1px solid ${T.border}`, background: "transparent", color: T.muted, fontFamily: T.sans }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Done */}
      {phase === "done" && (
        <div>
          <div style={{ background: T.greenD, border: `1px solid ${T.greenB}`, borderRadius: "7px", padding: "10px 12px", marginBottom: "10px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "6px" }}>
              <span style={{ fontSize: "12px", color: T.green }}>
                {analysis.matched} tools assigned · this app owns location data
              </span>
              {analysis.nextBin !== null &&
                <span style={{ fontSize: "12px", color: T.green }}>Next bin: <span style={{ fontFamily: T.mono, fontWeight: 700 }}>{analysis.nextBin}</span></span>
              }
            </div>
          </div>
          <button onClick={reset} style={{ fontSize: "11px", color: T.muted, background: "none", border: "none", cursor: "pointer", padding: 0, fontFamily: T.sans }}>
            Reset normalization
          </button>
        </div>
      )}
    </div>
  );
}

// ── System card ────────────────────────────────────────────────────────────
function SystemCard({ sys, onUpdate, onDelete }) {
  const [open, setOpen] = useState(sys.id === "lc");
  function upd(level, patch) { onUpdate({ ...sys, levels: { ...sys.levels, [level]: { ...sys.levels[level], ...patch } } }); }
  function updD(key, val) { onUpdate({ ...sys, delimiters: { ...sys.delimiters, [key]: val } }); }
  const L = sys.levels; const D = sys.delimiters;
  const preview = buildPreview(sys);

  return (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: "10px", marginBottom: "8px", overflow: "hidden" }}>

      {/* ── HEADER ── */}
      <div
        style={{ padding: "12px 16px", display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", cursor: "pointer", background: open ? "#1e1e1e" : "transparent" }}
        onClick={() => setOpen(o => !o)}
      >
        {/* Editable name (click pencil to edit) */}
        <EditableName value={sys.name} onChange={name => onUpdate({ ...sys, name })} />

        {/* Badges */}
        {sys.normalized && <Badge color="g">Normalized</Badge>}
        {sys.allowDuplicates && <Badge color="b">Dupes OK</Badge>}

        {/* Spacer — pushes preview to the right, collapses when wrapping */}
        <div style={{ flex: 1, minWidth: "12px" }} />

        {/* Animated live preview — only here, nowhere else */}
        <LivePreview value={preview} />

        <span style={{ color: T.veryMuted, fontSize: "11px", flexShrink: 0 }}>{open ? "▲" : "▼"}</span>
      </div>

      {/* ── BODY ── */}
      {open && (
        <div style={{ padding: "16px", borderTop: `1px solid ${T.border}` }}>

          {/* Quick toggles */}
          <div style={{ display: "flex", alignItems: "center", gap: "20px", marginBottom: "14px", flexWrap: "wrap" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", fontSize: "13px" }}>
              <Toggle on={sys.allowDuplicates} set={v => onUpdate({ ...sys, allowDuplicates: v })} />
              Allow duplicate locations
            </label>
          </div>

          {/* ProShop export — all on one row */}
          <div style={{ marginBottom: "16px" }}>
            <Lbl>ProShop location export</Lbl>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
              <div style={{ width: "210px", flexShrink: 0 }}>
                <Select
                  value={sys.proShopExport}
                  onChange={e => onUpdate({ ...sys, proShopExport: e.target.value })}
                  options={[["number_only","Number only (strip labels)"],["full","Full location string"],["fixed","Fixed value"]]}
                />
              </div>
              {sys.proShopExport === "fixed" && (
                <input
                  style={{ ...base.input, fontFamily: T.mono, width: "90px" }}
                  value={sys.fixedExport}
                  onChange={e => onUpdate({ ...sys, fixedExport: e.target.value })}
                  placeholder="e.g. 1000"
                />
              )}
              <span style={{ fontSize: "11px", color: T.muted }}>{proShopHint(sys.proShopExport, sys.fixedExport)}</span>
            </div>
          </div>

          <div style={{ borderTop: `1px solid ${T.border}`, margin: "14px 0" }} />
          <div style={{ fontSize: "11px", color: T.muted, marginBottom: "12px" }}>
            Configure levels from zone (broadest) down to bin. Delimiter controls appear between each level, grayed out when the adjacent level is inactive.
          </div>

          {/* Zone */}
          <LevelBlock title="Zone" optional active={L.zone.on} onToggle={v => upd("zone", { on: v })}>
            <LevelFields level={L.zone} types={ZONE_TYPES} updateLevel={p => upd("zone", p)} />
          </LevelBlock>

          <DelimRow label="zone → station" value={D.zs} onChange={v => updD("zs", v)} active={L.zone.on && L.station.on} />

          {/* Station */}
          <LevelBlock title="Station" optional active={L.station.on} onToggle={v => upd("station", { on: v })}>
            <LevelFields level={L.station} types={STATION_TYPES} updateLevel={p => upd("station", p)} />
          </LevelBlock>

          <DelimRow label="station → drawer" value={D.sd} onChange={v => updD("sd", v)} active={L.station.on && L.drawer.on} />

          {/* Drawer */}
          <LevelBlock title="Drawer" optional active={L.drawer.on} onToggle={v => upd("drawer", { on: v })}>
            <LevelFields level={L.drawer} types={DRAWER_TYPES} updateLevel={p => upd("drawer", p)} />
          </LevelBlock>

          <DelimRow label="drawer → bin" value={D.db} onChange={v => updD("db", v)} active={L.drawer.on} />

          {/* Bin */}
          <LevelBlock title="Bin" optional={false} active={true}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
              <div>
                <Lbl>Mode</Lbl>
                <Select
                  value={L.bin.fixed ? "fixed" : "increment"}
                  onChange={e => upd("bin", { fixed: e.target.value === "fixed" })}
                  options={[["increment","Auto-increment"],["fixed","Fixed value"]]}
                />
              </div>
              <div>
                <Lbl>{L.bin.fixed ? "Fixed value" : "Start at"}</Lbl>
                <Input
                  value={L.bin.fixed ? L.bin.fixedVal : String(L.bin.start)}
                  onChange={e => L.bin.fixed ? upd("bin", { fixedVal: e.target.value }) : upd("bin", { start: parseInt(e.target.value) || 1 })}
                  placeholder="1000" mono
                />
              </div>
            </div>
          </LevelBlock>

          {/* ── NORMALIZATION STEP ── */}
          <NormalizationStep sys={sys} onUpdate={onUpdate} />

          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "16px" }}>
            <button onClick={onDelete} style={{ padding: "7px 14px", borderRadius: "6px", fontSize: "12px", fontWeight: 600, cursor: "pointer", border: "none", background: "#2a1010", color: "#d04040", fontFamily: T.sans }}>
              Delete system
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Picker tab ─────────────────────────────────────────────────────────────
function PickerTab({ systems }) {
  const [sysId, setSysId] = useState(systems[0]?.id || "");
  const [vals, setVals] = useState({ zone: "", station: "", drawer: "", bin: "" });
  const sys = systems.find(s => s.id === sysId);
  const nextBin = sys ? (sys.levels.bin.fixed ? sys.levels.bin.fixedVal || "1000" : String(sys.levels.bin.start + 7)) : "";
  function setV(k, v) { setVals(p => ({ ...p, [k]: v })); }

  function pickerPreview() {
    if (!sys) return "—";
    const L = sys.levels; const D = sys.delimiters;
    const binDisp = vals.bin || nextBin;
    function seg(level, key) {
      if (!level.on) return null;
      if (level.identFormat === "custom") return level.customIdent || "…";
      return vals[key] || "";
    }
    const segs = [
      L.zone.on    ? { key: "zone",    val: seg(L.zone, "zone") }    : null,
      L.station.on ? { key: "station", val: seg(L.station, "station") } : null,
      L.drawer.on  ? { key: "drawer",  val: seg(L.drawer, "drawer") }  : null,
      { key: "bin", val: binDisp },
    ].filter(Boolean);
    const dk = (a, b) => a[0] + b[0];
    return segs.map((s, i) => s.val + (i < segs.length - 1 ? (D[dk(s.key, segs[i+1].key)] ?? "-") : "")).join("");
  }

  function pickerLevel(level, key) {
    if (!level.on) return null;
    const typeName = level.levelType === "custom" ? (level.customTypeName || "Custom") : level.levelType;
    return (
      <div style={{ background: "#13192a", border: `1px solid ${T.blueB}`, borderRadius: "6px", padding: "10px 12px" }}>
        <div style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: T.blue, marginBottom: "6px" }}>{typeName}</div>
        {level.identFormat === "custom"
          ? <div style={{ fontFamily: T.mono, fontSize: "15px", color: T.text }}>{level.customIdent || "—"} <span style={{ fontSize: "10px", color: T.muted }}>fixed</span></div>
          : <Select
              value={vals[key]}
              onChange={e => setV(key, e.target.value)}
              options={[["","— select —"], ...(level.options.length > 0 ? level.options : level.identFormat === "letter" ? ["A","B","C","D"] : ["1","2","3","4"]).map(o => [o, o])]}
            />
        }
      </div>
    );
  }

  return (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: "10px", padding: "16px" }}>
      <div style={{ fontSize: "13px", color: T.muted, marginBottom: "14px" }}>Assign a storage location to this tool.</div>
      <div style={{ marginBottom: "14px" }}>
        <Lbl>Location system</Lbl>
        <Select value={sysId} onChange={e => { setSysId(e.target.value); setVals({ zone: "", station: "", drawer: "", bin: "" }); }} options={systems.map(s => [s.id, s.name])} />
      </div>
      {sys && (
        <>
          <div style={{ marginBottom: "14px" }}>
            <LivePreview value={pickerPreview()} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            {pickerLevel(sys.levels.zone, "zone")}
            {pickerLevel(sys.levels.station, "station")}
            {pickerLevel(sys.levels.drawer, "drawer")}
            <div style={{ background: "#13192a", border: `1px solid ${T.blueB}`, borderRadius: "6px", padding: "10px 12px" }}>
              <div style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: T.blue, marginBottom: "6px" }}>Bin</div>
              {sys.levels.bin.fixed
                ? <div style={{ fontFamily: T.mono, fontSize: "20px", fontWeight: 700 }}>{sys.levels.bin.fixedVal || "1000"} <span style={{ fontSize: "10px", color: T.muted, fontWeight: 400 }}>fixed</span></div>
                : <>
                    <input style={{ ...base.input, fontFamily: T.mono, fontSize: "18px", fontWeight: 700, width: "140px" }} value={vals.bin} onChange={e => setV("bin", e.target.value)} placeholder={nextBin} />
                    <div style={{ fontSize: "10px", color: T.muted, marginTop: "4px" }}>Suggested next: <span style={{ fontFamily: T.mono }}>{nextBin}</span></div>
                  </>
              }
            </div>
          </div>
          {sys.allowDuplicates && <div style={{ background: T.orangeD, border: `1px solid ${T.orangeB}`, borderRadius: "6px", padding: "8px 12px", fontSize: "12px", color: T.orange, marginTop: "12px" }}>Duplicates allowed.</div>}
          <button style={{ marginTop: "14px", padding: "8px 16px", borderRadius: "6px", fontSize: "13px", fontWeight: 600, cursor: "pointer", border: "none", background: T.blue, color: "#fff", fontFamily: T.sans }}>Set location</button>
        </>
      )}
    </div>
  );
}

// ── Initial data ───────────────────────────────────────────────────────────
const INITIAL = [
  {
    id: "lc", name: "LC Cabinet", normalized: true, allowDuplicates: false,
    proShopExport: "number_only", fixedExport: "",
    delimiters: { zs: "-", sd: "-", db: "-", zd: "-", sb: "-", zb: "-" },
    levels: {
      zone:    { on: false, levelType: "Building",  customTypeName: "", identFormat: "number", customIdent: "", options: [] },
      station: { on: false, levelType: "Cabinet",   customTypeName: "", identFormat: "number", customIdent: "", options: [] },
      drawer:  { on: true,  levelType: "Drawer",    customTypeName: "", identFormat: "custom", customIdent: "LC", options: [] },
      bin:     { fixed: false, start: 1000, fixedVal: "" },
    }
  },
  {
    id: "drill", name: "Drill Index", normalized: false, allowDuplicates: true,
    proShopExport: "fixed", fixedExport: "1000",
    delimiters: { zs: "-", sd: "-", db: "-", zd: "-", sb: "-", zb: "-" },
    levels: {
      zone:    { on: false, levelType: "Building", customTypeName: "", identFormat: "number", customIdent: "", options: [] },
      station: { on: false, levelType: "Cabinet",  customTypeName: "", identFormat: "number", customIdent: "", options: [] },
      drawer:  { on: false, levelType: "Drawer",   customTypeName: "", identFormat: "letter", customIdent: "", options: [] },
      bin:     { fixed: true, start: 1000, fixedVal: "1000" },
    }
  },
];

// ── Library-level unmatched panel ─────────────────────────────────────────
// Mock data — in the real app this is derived from scanning tool_metadata.json
const TOTAL_TOOLS = 259;
const MOCK_UNMATCHED_TOOLS = [
  { id: "FTL-A1B2C3", desc: "3/8 3FL EM 1LOC",              location: "LC 84"    },
  { id: "FTL-D4E5F6", desc: "1/4 BULL R.03 3FL 1LOC",       location: "LC14"     },
  { id: "FTL-G7H8I9", desc: "1/8 CHAMFER 90DEG",            location: "LC -158"  },
  { id: "FTL-J0K1L2", desc: ".488 11-32TPI THREAD MILL .5REACH", location: "1000A" },
  { id: "FTL-M3N4O5", desc: "0.500 BORING HEAD",            location: "SHELF-3"  },
  { id: "FTL-P6Q7R8", desc: "#29 118DEG CARB DRILL",         location: "BIN C"    },
  { id: "FTL-S9T0U1", desc: "1/2 SPOT DRILL 90DEG",         location: ""         },
  { id: "FTL-V2W3X4", desc: "M8x1.25 FORM TAP 6H",          location: ""         },
  { id: "FTL-Y5Z6A7", desc: "2.5 FACE MILL HAAS 45DEG",     location: ""         },
];

function LibraryUnmatchedPanel({ systems }) {
  const [showTable, setShowTable] = useState(false);
  const normalizedSystems = systems.filter(s => s.normalized);

  if (normalizedSystems.length === 0) return null;

  // Calculate assigned count from normalized systems
  const assigned = normalizedSystems.reduce((sum, s) => {
    const mock = MOCK_ANALYSIS[s.id];
    return sum + (mock ? mock.matched : 0);
  }, 0);

  const unassigned = TOTAL_TOOLS - assigned;
  const withLocation  = MOCK_UNMATCHED_TOOLS.filter(t => t.location).length;
  const withoutLocation = MOCK_UNMATCHED_TOOLS.filter(t => !t.location).length;
  const allClear = unassigned === 0;

  return (
    <div style={{
      marginTop: "8px",
      background: T.surface,
      border: `1px solid ${allClear ? T.greenB : T.orangeB}`,
      borderRadius: "10px",
      padding: "16px",
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "10px", marginBottom: "12px", flexWrap: "wrap" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
            <span style={{ fontSize: "12px", fontWeight: 700, color: T.text }}>Library Location Status</span>
            <Tooltip text="Shows how many tools across your entire library have been assigned to a location system. Tools that didn't match any system need attention — either create a new system to catch them, or fix their location text manually.">
              <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: "16px", height: "16px", borderRadius: "8px", background: T.raise, border: `1px solid ${T.border}`, fontSize: "10px", color: T.muted, cursor: "default", fontWeight: 700 }}>?</span>
            </Tooltip>
          </div>
          <div style={{ fontSize: "11px", color: T.muted }}>{TOTAL_TOOLS} total tools</div>
        </div>

        {/* Count summary */}
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <div style={{ background: T.greenD, border: `1px solid ${T.greenB}`, borderRadius: "6px", padding: "6px 12px", textAlign: "center" }}>
            <div style={{ fontSize: "18px", fontWeight: 700, color: T.green, fontFamily: T.mono }}>{assigned}</div>
            <div style={{ fontSize: "10px", color: T.green, letterSpacing: "0.05em" }}>ASSIGNED</div>
          </div>
          <div style={{ background: unassigned > 0 ? T.orangeD : T.greenD, border: `1px solid ${unassigned > 0 ? T.orangeB : T.greenB}`, borderRadius: "6px", padding: "6px 12px", textAlign: "center" }}>
            <div style={{ fontSize: "18px", fontWeight: 700, color: unassigned > 0 ? T.orange : T.green, fontFamily: T.mono }}>{unassigned}</div>
            <div style={{ fontSize: "10px", color: unassigned > 0 ? T.orange : T.green, letterSpacing: "0.05em" }}>UNASSIGNED</div>
          </div>
        </div>
      </div>

      {allClear ? (
        <div style={{ fontSize: "12px", color: T.green }}>All tools are assigned to a location system.</div>
      ) : (
        <>
          {/* Breakdown */}
          <div style={{ display: "flex", gap: "16px", marginBottom: "12px", flexWrap: "wrap" }}>
            {withLocation > 0 && (
              <div style={{ fontSize: "12px", color: T.muted }}>
                <span style={{ color: T.orange, fontWeight: 600 }}>{withLocation}</span> have location text that didn't match any system
              </div>
            )}
            {withoutLocation > 0 && (
              <div style={{ fontSize: "12px", color: T.muted }}>
                <span style={{ color: T.muted, fontWeight: 600 }}>{withoutLocation}</span> have no location set
              </div>
            )}
          </div>

          {/* Tip */}
          <div style={{ fontSize: "11px", color: T.muted, background: T.raise, border: `1px solid ${T.border}`, borderRadius: "6px", padding: "8px 10px", marginBottom: "12px" }}>
            Create additional location systems for unmatched tools, then normalize each one. After each pass, check this list — it shrinks as more tools get accounted for.
          </div>

          {/* Toggle table */}
          <button
            onClick={() => setShowTable(v => !v)}
            style={{ fontSize: "12px", color: T.blue, background: "none", border: "none", cursor: "pointer", padding: 0, fontFamily: T.sans, fontWeight: 600, display: "flex", alignItems: "center", gap: "4px" }}
          >
            {showTable ? "▲ Hide" : "▼ View"} {unassigned} unassigned tools
          </button>

          {/* Table */}
          {showTable && (
            <div style={{ marginTop: "10px", border: `1px solid ${T.border}`, borderRadius: "7px", overflow: "hidden" }}>
              {/* Table header */}
              <div style={{ display: "grid", gridTemplateColumns: "130px 1fr 100px", background: T.raise, padding: "7px 12px", gap: "10px" }}>
                {["Tool ID", "Description", "Location text"].map(h => (
                  <span key={h} style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: T.muted }}>{h}</span>
                ))}
              </div>
              {/* Rows */}
              {MOCK_UNMATCHED_TOOLS.map((tool, i) => (
                <div
                  key={tool.id}
                  style={{ display: "grid", gridTemplateColumns: "130px 1fr 100px", padding: "8px 12px", gap: "10px", borderTop: `1px solid ${T.border}`, background: i % 2 === 0 ? "transparent" : "#161616", alignItems: "center" }}
                >
                  <span style={{ fontFamily: T.mono, fontSize: "11px", color: T.blue }}>{tool.id}</span>
                  <span style={{ fontSize: "12px", color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tool.desc}</span>
                  <span style={{ fontFamily: T.mono, fontSize: "11px", color: tool.location ? T.orange : T.veryMuted }}>
                    {tool.location || "—"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Root ───────────────────────────────────────────────────────────────────
export default function App() {
  const [systems, setSystems] = useState(INITIAL);
  const [tab, setTab] = useState("systems");
  function updateSystem(id, updated) { setSystems(prev => prev.map(s => s.id === id ? updated : s)); }
  function deleteSystem(id) { setSystems(prev => prev.filter(s => s.id !== id)); }
  function addSystem() {
    setSystems(prev => [...prev, {
      id: `sys-${Date.now()}`, name: "New System", normalized: false, allowDuplicates: false,
      proShopExport: "number_only", fixedExport: "",
      delimiters: { zs: "-", sd: "-", db: "-", zd: "-", sb: "-", zb: "-" },
      levels: {
        zone:    { on: false, levelType: "Building", customTypeName: "", identFormat: "number", customIdent: "", options: [] },
        station: { on: false, levelType: "Cabinet",  customTypeName: "", identFormat: "number", customIdent: "", options: [] },
        drawer:  { on: false, levelType: "Drawer",   customTypeName: "", identFormat: "letter", customIdent: "", options: [] },
        bin:     { fixed: false, start: 1, fixedVal: "" },
      }
    }]);
  }
  const tabStyle = active => ({
    padding: "6px 14px", borderRadius: "6px", fontSize: "13px", fontWeight: 600,
    cursor: "pointer", border: "none", fontFamily: T.sans,
    background: active ? T.surface : "transparent", color: active ? T.text : T.muted,
  });
  return (
    <div style={{ background: T.bg, minHeight: "100vh", fontFamily: T.sans, color: T.text, padding: "24px 20px", maxWidth: "640px", margin: "0 auto" }}>
      <div style={{ marginBottom: "20px" }}>
        <h2 style={{ margin: "0 0 4px", fontSize: "18px", fontWeight: 700 }}>Location System</h2>
        <p style={{ margin: 0, fontSize: "13px", color: T.muted }}>Configure how tools are physically stored. Each system is independent.</p>
      </div>
      <div style={{ display: "flex", gap: "4px", background: "#0d0d0d", borderRadius: "8px", padding: "4px", width: "fit-content", marginBottom: "18px" }}>
        <button style={tabStyle(tab === "systems")} onClick={() => setTab("systems")}>Location Systems</button>
        <button style={tabStyle(tab === "picker")} onClick={() => setTab("picker")}>Assign Location</button>
      </div>
      {tab === "systems" ? (
        <>
          {systems.map(sys => <SystemCard key={sys.id} sys={sys} onUpdate={v => updateSystem(sys.id, v)} onDelete={() => deleteSystem(sys.id)} />)}
          <button onClick={addSystem} style={{ width: "100%", padding: "12px", borderRadius: "8px", fontSize: "13px", fontWeight: 600, cursor: "pointer", border: `1px dashed ${T.border}`, background: "transparent", color: T.muted, fontFamily: T.sans, marginTop: "4px" }}>
            + Add Location System
          </button>
          <LibraryUnmatchedPanel systems={systems} />
        </>
      ) : (
        <PickerTab systems={systems} />
      )}
    </div>
  );
}
