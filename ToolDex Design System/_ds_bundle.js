/* @ds-bundle: {"format":3,"namespace":"ToolDexDesignSystem_d6b872","components":[{"name":"Badge","sourcePath":"components/core/Badge.jsx"},{"name":"Button","sourcePath":"components/core/Button.jsx"},{"name":"Card","sourcePath":"components/core/Card.jsx"},{"name":"Chip","sourcePath":"components/core/Chip.jsx"},{"name":"IconButton","sourcePath":"components/core/IconButton.jsx"},{"name":"SegmentedToggle","sourcePath":"components/core/SegmentedToggle.jsx"},{"name":"DataBadge","sourcePath":"components/data/DataBadge.jsx"},{"name":"ToolCard","sourcePath":"components/data/ToolCard.jsx"},{"name":"ToolTypeIcon","sourcePath":"components/data/ToolTypeIcon.jsx"},{"name":"Banner","sourcePath":"components/feedback/Banner.jsx"},{"name":"Spinner","sourcePath":"components/feedback/Spinner.jsx"},{"name":"Toast","sourcePath":"components/feedback/Toast.jsx"},{"name":"ToastStack","sourcePath":"components/feedback/Toast.jsx"},{"name":"Input","sourcePath":"components/forms/Input.jsx"},{"name":"SearchBar","sourcePath":"components/forms/SearchBar.jsx"},{"name":"Select","sourcePath":"components/forms/Select.jsx"}],"sourceHashes":{"components/core/Badge.jsx":"d49ebf9d9214","components/core/Button.jsx":"5e5e8a4efcdc","components/core/Card.jsx":"26fe6ce04492","components/core/Chip.jsx":"4394c8010022","components/core/IconButton.jsx":"81fb5cff1874","components/core/SegmentedToggle.jsx":"1b47c0f10928","components/data/DataBadge.jsx":"48b5e2453814","components/data/ToolCard.jsx":"6777c1d0f910","components/data/ToolTypeIcon.jsx":"867979ed91f6","components/feedback/Banner.jsx":"8e5f96e9a05b","components/feedback/Spinner.jsx":"0d64315c2184","components/feedback/Toast.jsx":"03b69efe6986","components/forms/Input.jsx":"6a0c04ef641a","components/forms/SearchBar.jsx":"6135233b31a5","components/forms/Select.jsx":"e38152daff10","ui_kits/tooldex/app.jsx":"73388ef9be64","ui_kits/tooldex/data.js":"5c199c0f1c9f","ui_kits/tooldex/icons.jsx":"b6124c023dba"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.ToolDexDesignSystem_d6b872 = window.ToolDexDesignSystem_d6b872 || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/core/Badge.jsx
try { (() => {
// ToolDex — Badge
// Neutral meta badge for inline facts on cards (diameter, flute count, vendor).
// Variants add a blue or orange accent. For TYPED data (descriptions, IDs,
// machine #s) use DataBadge instead.

function Badge({
  variant = 'neutral',
  className = '',
  style,
  children
}) {
  const cls = ['meta-badge', variant === 'blue' ? 'meta-badge-blue' : variant === 'orange' ? 'meta-badge-orange' : '', className].filter(Boolean).join(' ');
  return /*#__PURE__*/React.createElement("span", {
    className: cls,
    style: style
  }, children);
}
Object.assign(__ds_scope, { Badge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Badge.jsx", error: String((e && e.message) || e) }); }

// components/core/Button.jsx
try { (() => {
// ToolDex — Button
// The action primitive. Variants map to intent; brand blue is "primary".
// Hover brightens, active nudges down 1px (functional, not bouncy).

function Button({
  variant = 'secondary',
  size = 'md',
  disabled = false,
  type = 'button',
  onClick,
  className = '',
  style,
  children
}) {
  const cls = ['btn', `btn-${variant}`, size === 'sm' ? 'btn-sm' : size === 'lg' ? 'btn-lg' : '', className].filter(Boolean).join(' ');
  return /*#__PURE__*/React.createElement("button", {
    type: type,
    className: cls,
    disabled: disabled,
    onClick: onClick,
    style: style
  }, children);
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Button.jsx", error: String((e && e.message) || e) }); }

// components/core/Card.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
// ToolDex — Card
// The base surface container. A plain bordered panel with the standard
// surface fill, hairline border, 8px radius and a subtle shadow.

function Card({
  as: Tag = 'div',
  className = '',
  style,
  children,
  ...rest
}) {
  return /*#__PURE__*/React.createElement(Tag, _extends({
    className: ['card', className].filter(Boolean).join(' '),
    style: style
  }, rest), children);
}
Object.assign(__ds_scope, { Card });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Card.jsx", error: String((e && e.message) || e) }); }

// components/core/Chip.jsx
try { (() => {
// ToolDex — Chip
// Pill-shaped filter/selection control. `filter` is the round facet chip;
// `type` is the larger tool-type chip that takes a leading icon. Active state
// is the brand blue tint.

function Chip({
  variant = 'filter',
  active = false,
  onClick,
  className = '',
  style,
  children
}) {
  const base = variant === 'type' ? 'type-chip' : 'chip';
  const cls = [base, active ? 'active' : '', className].filter(Boolean).join(' ');
  return /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: cls,
    onClick: onClick,
    style: style,
    "aria-pressed": active
  }, children);
}
Object.assign(__ds_scope, { Chip });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Chip.jsx", error: String((e && e.message) || e) }); }

// components/core/IconButton.jsx
try { (() => {
// ToolDex — IconButton
// 28×28 square icon-only control. Used in toolbars, card hover-actions, and
// view toggles. `active` gives the blue-tint selected treatment.

function IconButton({
  active = false,
  disabled = false,
  title,
  onClick,
  className = '',
  style,
  children
}) {
  const cls = ['icon-btn', active ? 'active' : '', className].filter(Boolean).join(' ');
  return /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: cls,
    disabled: disabled,
    title: title,
    onClick: onClick,
    style: style,
    "aria-label": title
  }, children);
}
Object.assign(__ds_scope, { IconButton });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/IconButton.jsx", error: String((e && e.message) || e) }); }

// components/core/SegmentedToggle.jsx
try { (() => {
// ToolDex — SegmentedToggle
// A connected group of mutually-exclusive options (unit pickers, mode
// switches, in/mm). The active option gets the blue tint.

function SegmentedToggle({
  options = [],
  value,
  onChange,
  className = '',
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: ['btn-toggle', className].filter(Boolean).join(' '),
    style: style,
    role: "group"
  }, options.map(opt => {
    const val = typeof opt === 'string' ? opt : opt.value;
    const label = typeof opt === 'string' ? opt : opt.label;
    return /*#__PURE__*/React.createElement("button", {
      key: val,
      type: "button",
      className: val === value ? 'active' : '',
      "aria-pressed": val === value,
      onClick: () => onChange && onChange(val)
    }, label);
  }));
}
Object.assign(__ds_scope, { SegmentedToggle });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/SegmentedToggle.jsx", error: String((e && e.message) || e) }); }

// components/data/DataBadge.jsx
try { (() => {
// ToolDex — DataBadge
// Color-coded chips that make a value recognizable by its DATA TYPE, even with
// no label beside it. Two of these kinds are NOT a single fixed color:
//   • holder  — color follows the HOLDER SIZE (each taper-collet-gauge has its
//               own color, consistent everywhere the holder appears)
//   • preset  — color follows the selected MATERIAL's ISO 513 group
// The fixed-color kinds: description (violet), proshop (amber), machine (green),
// location (indigo).

const CLASS = {
  description: 'description-badge',
  proshop: 'proshop-pill',
  holder: 'holder-pill',
  machine: 'machine-num-badge',
  location: 'location-tag',
  preset: 'preset-tag',
  'no-fusion': 'no-fusion-pill'
};

// ── Holder size → color ──────────────────────────────────────────────────────
// Canonical assignments. Keyed by the shop short-name (taper-collet-gauge).
const HOLDER_COLORS = {
  '30-SK13-60': 'var(--holder-30-sk13-60)',
  '30-SK13-90': 'var(--holder-30-sk13-90)',
  '30-SK13-120': 'var(--holder-30-sk13-120)',
  '30-SK13-150': 'var(--holder-30-sk13-150)',
  '30-SK20-60': 'var(--holder-30-sk20-60)',
  '30-SK20-90': 'var(--holder-30-sk20-90)',
  'DRILL CHUCK': 'var(--holder-drill-chuck)'
};

// Normalize a Fusion holder description ("NBT30-SK13C-60") to its short name
// ("30-SK13-60"): strip leading NBT, drop the C after an SK collet token.
function holderShortName(desc) {
  if (!desc) return '';
  return String(desc).trim().toUpperCase().replace(/^NBT/, '').replace(/(SK\d+)C(?=[^A-Z]|$)/g, '$1').trim();
}
function holderColor(name) {
  const short = holderShortName(name);
  return HOLDER_COLORS[short] || 'var(--holder-default)';
}

// ── Material → ISO group → color ─────────────────────────────────────────────
const ISO_COLORS = {
  P: 'var(--iso-p)',
  M: 'var(--iso-m)',
  K: 'var(--iso-k)',
  N: 'var(--iso-n)',
  S: 'var(--iso-s)',
  H: 'var(--iso-h)'
};

// Best-effort material string → ISO 513 group (matches the app's matchMaterial).
function materialIsoGroup(str) {
  if (!str) return null;
  const s = String(str).toUpperCase();
  if (s.includes('STAINLESS') || /\bSS\b|^SS\d/.test(s)) return 'M';
  if (s.includes('ALUM') || /\bAL\b|^AL\d/.test(s)) return 'N';
  if (s.includes('BRASS') || s.includes('BRONZE') || s.includes('COPPER')) return 'N';
  if (s.includes('TITAN') || /\bTI\b/.test(s)) return 'S';
  if (s.includes('CAST') || s.includes('IRON') && !s.includes('STEEL') || /\bCI\b/.test(s)) return 'K';
  if (s.includes('HARDEN') || /\bHRC\b/.test(s)) return 'H';
  if (/STEEL|MILD|LOW CARBON|ALLOY|\bP\d/.test(s)) return 'P';
  return null;
}
function DataBadge({
  kind = 'description',
  children,
  href,
  title,
  onClick,
  color,
  material,
  isoGroup,
  style
}) {
  const className = CLASS[kind] || 'meta-badge';
  let resolved = {
    ...(style || {})
  };

  // Machine # convention: prefix with T (T1, T2…) unless already prefixed.
  let content = children;
  if (kind === 'machine' && typeof children === 'string' && !/^t/i.test(children)) {
    content = `T${children}`;
  }

  // Holder: color by size (explicit color wins, else derive from the value).
  if (kind === 'holder') {
    resolved['--badge-color'] = color || holderColor(typeof children === 'string' ? children : '');
  }

  // Preset: color by material's ISO group.
  if (kind === 'preset') {
    const grp = isoGroup || materialIsoGroup(material);
    resolved['--badge-color'] = color || (grp ? ISO_COLORS[grp] : 'var(--iso-p)');
    content = /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("span", {
      className: "preset-dot",
      "aria-hidden": "true"
    }), children);
  }
  if (href) {
    return /*#__PURE__*/React.createElement("a", {
      className: className,
      href: href,
      title: title,
      style: resolved,
      target: "_blank",
      rel: "noopener noreferrer",
      onClick: onClick
    }, content);
  }
  return /*#__PURE__*/React.createElement("span", {
    className: className,
    title: title,
    style: resolved,
    onClick: onClick
  }, content);
}
Object.assign(__ds_scope, { DataBadge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/DataBadge.jsx", error: String((e && e.message) || e) }); }

// components/data/ToolTypeIcon.jsx
try { (() => {
// ToolDex — ToolTypeIcon
// Clean line-art silhouettes for each CNC tool type — the signature ToolDex
// iconography. 24×24 viewBox, stroke `currentColor` (tints to context), thin
// 0.4 strokes. The identity of each tool lives in its END/TIP geometry and
// flute style:
//   • End mills — helical flutes spiralling up the diameter; the BOTTOM corner
//     distinguishes them (flat = square 90°, bull = small radius, ball = full
//     hemisphere, radius = large corner).
//   • Drills/spot — pointed tip with cutting lips, steep 2-flute helix.
//   • Reamer — STRAIGHT flutes (vertical), chamfered start.
//   • Tap — square drive + angled thread profile.
//   • Turning — lathe holder + diamond insert.
// No fills/shading — pure outline so it stays crisp and tintable at any size.

// element helper (keyed for React arrays). op = stroke opacity for detail lines.
const P = (d, k, op) => /*#__PURE__*/React.createElement("path", {
  key: k,
  d: d,
  fill: "none",
  strokeOpacity: op == null ? 1 : op
});
const CIRC = (cx, cy, r, k) => /*#__PURE__*/React.createElement("circle", {
  key: k,
  cx: cx,
  cy: cy,
  r: r,
  fill: "none"
});
const ELL = (cx, cy, rx, ry, k) => /*#__PURE__*/React.createElement("ellipse", {
  key: k,
  cx: cx,
  cy: cy,
  rx: rx,
  ry: ry,
  fill: "none"
});

// Shared helical flutes for a full-width (x9→15) milling body, flat-ish bottom.
const MILL_FLUTES = ['M9 18.6 C10.6 18.7 12.2 17.4 13 16.2 C13.6 15.3 14.5 14.9 15 14.9', 'M9 15.6 C10.6 15.7 12.2 14.4 13 13.2 C13.6 12.3 14.5 11.9 15 11.9', 'M9 12.6 C10.6 12.7 12.2 11.4 13 10.2'];
const MILL_GASH = ['M9.6 18.9 C11 18.8 12.6 17.7 13.5 16.4', 'M9.6 15.9 C11 15.8 12.6 14.7 13.5 13.4'];
const millFlutes = pfx => [...MILL_FLUTES.map((d, i) => P(d, `${pfx}f${i}`)), ...MILL_GASH.map((d, i) => P(d, `${pfx}g${i}`, 0.45))];
function paths(type) {
  switch (type) {
    // ── End mills (distinguished by bottom corner) ───────────────────────────
    case 'flat end mill':
      return [P('M9 3 H15 V20.3 H9 Z', 'b'), ...millFlutes('flat')];
    case 'bull nose end mill':
      return [P('M9 3 V18.6 Q9 20.3 10.7 20.3 H13.3 Q15 20.3 15 18.6 V3 Z', 'b'), ...millFlutes('bull')];
    case 'radius mill':
      return [P('M9 3 V17.6 Q9 20.3 11.7 20.3 H12.3 Q15 20.3 15 17.6 V3 Z', 'b'), ...millFlutes('rad')];
    case 'ball end mill':
      return [P('M9 3 V15.5 A3 3 0 0 0 15 15.5 V3 Z', 'b'), P('M9 14 C10.6 13.9 12.2 12.6 13 11.4 C13.6 10.5 14.5 10.1 15 10.1', 'f0'), P('M9 11 C10.6 10.9 12.2 9.6 13 8.4', 'f1'), P('M9.6 14.3 C11 14.2 12.6 13.1 13.5 11.8', 'g0', 0.45), P('M9.5 16.6 Q12 13.9 14.5 16.6', 'tip', 0.5)];
    case 'tapered mill':
      return [P('M9 3 H15 V11 L13.4 20.3 H10.6 L9 11 Z', 'b'), P('M9 11 H15', 'd', 0.5), P('M9.5 18.6 C10.6 18.4 11.6 17.5 12.2 16.6', 'f0'), P('M9.6 15.3 C10.8 15.1 12 14.1 12.7 13.1', 'f1'), P('M9.7 12 C11 11.8 12.4 10.8 13.2 9.9', 'f2')];
    case 'chamfer mill':
      // engrave/chamfer — conical point
      return [P('M9 3 H15 V12.5 L12 20.2 L9 12.5 Z', 'b'), P('M9 12.5 H15', 'd'), P('M9 11 C10.6 11.1 12.2 9.8 13 8.6', 'f0'), P('M9 8 C10.6 8.1 12.2 6.8 13 5.6', 'f1'), P('M10 14.4 L12 19.2 M14 14.4 L12 19.2', 'edge', 0.55)];
    case 'lollipop mill':
      // undercutting — thin neck + spherical cutter
      return [P('M9.6 3 H14.4 V8 H9.6 Z', 's'), P('M11.3 8 V11.4 M12.7 8 V11.4', 'neck'), CIRC(12, 15, 3.5, 'ball'), P('M9.7 13.9 C11 16.6 13 16.6 14.3 13.9', 'f0', 0.6), P('M10.2 12.4 C11.2 14.6 12.8 14.6 13.8 12.4', 'f1', 0.45)];
    case 'dovetail':
      return [P('M9.6 3 H14.4 V10 H9.6 Z', 's'), P('M11.2 10 V12 M12.8 10 V12', 'neck'), P('M10 12 L7.7 19.6 H16.3 L14 12 Z', 'h'), P('M8.7 16 H15.3', 't', 0.55)];
    case 'slot/key cutter':
      // woodruff / keyseat — thin neck + wide disc
      return [P('M10.6 3 H13.4 V12.6 H10.6 Z', 's'), P('M6 12.6 H18 V16.4 H6 Z', 'disc'), P('M7.7 16.4 V17.7 M9.7 16.4 V17.7 M11.7 16.4 V17.7 M13.7 16.4 V17.7 M15.7 16.4 V17.7', 't', 0.6)];
    case 'form mill':
      // profiled / radius-form bottom
      return [P('M9 3 H15 V12.5 H9 Z', 'b'), P('M9 12.5 C9.8 12.5 10 16.4 12 13.4 C14 16.4 14.2 12.5 15 12.5', 'form'), P('M9 11 C10.6 11.1 12.2 9.8 13 8.6', 'f0', 0.6)];
    case 'thread mill':
      return [P('M9 3 H15 V20.2 H9 Z', 'b'), P('M9 9.6 H15 M9 12.2 H15 M9 14.8 H15 M9 17.4 H15 M9 20 H15', 'th', 0.7), P('M12 8 V20.2', 'c', 0.4)];

    // ── Circle-segment family ───────────────────────────────────────────────
    case 'circle segment barrel':
      return [P('M9 3 V8 Q6.4 14 9.2 20.3 H14.8 Q17.6 14 15 8 V3 Z', 'b'), P('M7.3 12 C10 11 14 11 16.7 12', 'f0', 0.6), P('M8 16 C10.2 15.2 13.8 15.2 16 16', 'f1', 0.45)];
    case 'circle segment lens':
      return [P('M10.6 3 H13.4 V8.5 H10.6 Z', 's'), P('M12 8.5 Q6.5 14 12 20.3 Q17.5 14 12 8.5 Z', 'l'), P('M12 9 V20', 'c', 0.5)];
    case 'circle segment oval':
      return [P('M10.6 3 H13.4 V8.5 H10.6 Z', 's'), ELL(12, 14.8, 3.4, 5.4, 'o'), P('M9.4 13 C10.8 12.3 13.2 12.3 14.6 13', 'f0', 0.5), P('M9.4 16.6 C10.8 17.3 13.2 17.3 14.6 16.6', 'f1', 0.45)];
    case 'circle segment taper':
      return [P('M10.6 3 H13.4 V8.5 H10.6 Z', 's'), P('M9.4 8.5 Q8.6 15 11 20.3 H13 Q15.4 15 14.6 8.5 Z', 'b'), P('M9.7 12.5 C11 12 13 12 14.3 12.5', 'f0', 0.5), P('M10 16.5 C11.1 16.1 12.9 16.1 14 16.5', 'f1', 0.45)];

    // ── Hole making ─────────────────────────────────────────────────────────
    case 'drill':
      // pointed tip, 2-flute steep helix
      return [P('M9 3 H15 V14.8 L12 20.4 L9 14.8 Z', 'b'), P('M9.2 13.8 C11 12.8 13 11.6 14.8 10.6', 'f0'), P('M9.2 10.2 C11 9.2 13 8 14.8 7', 'f1'), P('M9.6 13.9 C11 13 12.6 12 13.6 10.8', 'g0', 0.45), P('M10.1 16 L12 18.6 L13.9 16', 'lip', 0.6)];
    case 'center drill':
      // thick body steps to a thin pilot point
      return [P('M8.3 3 H15.7 V11 H8.3 Z', 'b'), P('M8.3 8 H15.7', 'd', 0.45), P('M10.4 11 V14.6 L12 18 L13.6 14.6 V11', 'p'), P('M10.8 15.3 L12 16.9 L13.2 15.3', 'lip', 0.6)];
    case 'spot drill':
      // short, wide-angle point
      return [P('M9 3 H15 V12.5 L12 19.5 L9 12.5 Z', 'b'), P('M9 12.5 H15', 'd', 0.5), P('M9 11 C10.6 11.1 12.2 9.8 13 8.6', 'f0'), P('M10.2 14.6 L12 18.3 L13.8 14.6', 'lip', 0.6)];
    case 'reamer':
      // STRAIGHT flutes, chamfered start
      return [P('M9 3 H15 V18.4 L13.8 20.3 H10.2 L9 18.4 Z', 'b'), P('M9 8 H15', 'd', 0.45), P('M10.2 8 V19.6 M11.4 8 V20 M12.6 8 V20 M13.8 8 V19.6', 'fl', 0.85)];
    case 'counter bore':
      // flat body + central pilot pin
      return [P('M9 3 H15 V16 H9 Z', 'b'), ...millFlutes('cb').slice(0, 2), P('M11 16 V20.3 H13 V16', 'pilot')];
    case 'counter sink':
      // conical countersink
      return [P('M10.5 3 H13.5 V9 H10.5 Z', 's'), P('M7.4 9 H16.6 L12 19.6 Z', 'cone'), P('M9.7 9 L12 19.6 M14.3 9 L12 19.6 M12 9 V19.6', 'f', 0.55)];

    // ── Tap ───────────────────────────────────────────────────────────────
    case 'tap':
      return [P('M10.3 2.5 H13.7 V5 H10.3 Z', 'sq'), P('M9.5 5.5 H14.5 V16.5 L12.7 20.3 H11.3 L9.5 16.5 Z', 'b'), P('M9.5 7.8 L14.5 9 M9.5 10.1 L14.5 11.3 M9.5 12.4 L14.5 13.6 M9.5 14.7 L14.5 15.9', 'th', 0.8)];

    // ── Boring ──────────────────────────────────────────────────────────────
    case 'boring head':
      // bar + offset cutting bit
      return [P('M10.6 3 V14', 'bar'), P('M7.5 9 H16.5 V13 H7.5 Z', 'head'), P('M9.5 13 V18 L7.6 18', 'arm'), P('M6.3 16.8 L8.4 17.9 L6.7 19.6 Z', 'bit')];

    // ── Turning (lathe holder + diamond insert) ──────────────────────────────
    case 'turning general':
      return [P('M6.5 12 H20 V18 H6.5 Z', 'shank'), P('M6.5 9.6 H11.5 V12', 'head'), P('M4.6 10.6 L8.5 8.3 L11 11.1 L7.1 13.4 Z', 'insert')];
    default:
      return [P('M9 3 H15 V20.3 H9 Z', 'b'), ...millFlutes('def')];
  }
}
function ToolTypeIcon({
  type,
  size = 24,
  strokeWidth = 0.4,
  className = '',
  style
}) {
  return /*#__PURE__*/React.createElement("svg", {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: strokeWidth,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    className: className,
    style: style,
    "aria-hidden": "true"
  }, paths(type));
}
Object.assign(__ds_scope, { ToolTypeIcon });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/ToolTypeIcon.jsx", error: String((e && e.message) || e) }); }

// components/data/ToolCard.jsx
try { (() => {
// ToolDex — ToolCard
// The core library object. Grid (default) and list variants. Composes
// ToolTypeIcon + DataBadge + meta badges. Quick-actions slot reveals on hover.

function fmt(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = parseFloat(v);
  return isNaN(n) ? v : n.toFixed(4).replace(/\.?0+$/, '');
}
function ToolCard({
  tool = {},
  variant = 'grid',
  onOpen,
  actions
}) {
  const {
    tool_type,
    type,
    description,
    location,
    proshop_id,
    machine_tool_number,
    diameter,
    number_of_flutes,
    flute_length,
    vendor,
    coating,
    preferred_machine,
    unit = 'in'
  } = tool;
  const ttype = tool_type || type || 'flat end mill';
  const label = (ttype || '').replace(/\b\w/g, c => c.toUpperCase());
  const hasMachine = machine_tool_number !== null && machine_tool_number !== undefined && machine_tool_number !== '';
  const typeRow = /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      flex: 1,
      minWidth: 0,
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "tool-card-type"
  }, label), location && /*#__PURE__*/React.createElement(__ds_scope.DataBadge, {
    kind: "location",
    title: "Location",
    style: {
      fontSize: 10,
      padding: '1px 6px'
    }
  }, location), proshop_id && /*#__PURE__*/React.createElement(__ds_scope.DataBadge, {
    kind: "proshop",
    title: "ProShop ID",
    style: {
      fontSize: 10,
      padding: '1px 7px'
    }
  }, proshop_id));
  const badges = /*#__PURE__*/React.createElement("div", {
    className: "tool-card-meta"
  }, hasMachine && /*#__PURE__*/React.createElement(__ds_scope.DataBadge, {
    kind: "machine",
    title: "Machine Tool #"
  }, String(machine_tool_number)), fmt(diameter) && /*#__PURE__*/React.createElement("span", {
    className: "meta-badge"
  }, /*#__PURE__*/React.createElement("span", {
    className: "dia"
  }, "\u2300"), " ", fmt(diameter), " ", unit), number_of_flutes && /*#__PURE__*/React.createElement("span", {
    className: "meta-badge"
  }, number_of_flutes, "FL"), fmt(flute_length) && /*#__PURE__*/React.createElement("span", {
    className: "meta-badge"
  }, fmt(flute_length), "LOC"), vendor && /*#__PURE__*/React.createElement("span", {
    className: "meta-badge truncate",
    style: {
      maxWidth: 120
    }
  }, vendor), coating && /*#__PURE__*/React.createElement("span", {
    className: "meta-badge"
  }, coating), preferred_machine && /*#__PURE__*/React.createElement("span", {
    className: "meta-badge meta-badge-blue"
  }, preferred_machine));
  if (variant === 'list') {
    return /*#__PURE__*/React.createElement("div", {
      className: "tool-row",
      onClick: onOpen
    }, /*#__PURE__*/React.createElement("span", {
      className: "tool-row-icon"
    }, /*#__PURE__*/React.createElement(__ds_scope.ToolTypeIcon, {
      type: ttype,
      size: 24
    })), /*#__PURE__*/React.createElement("div", {
      className: "tool-row-main"
    }, /*#__PURE__*/React.createElement("span", {
      className: "tool-row-title description-badge truncate",
      style: {
        display: 'inline-block',
        fontSize: 13
      }
    }, description || '—'), typeRow), badges, actions);
  }
  return /*#__PURE__*/React.createElement("div", {
    className: "tool-card",
    onClick: onOpen
  }, /*#__PURE__*/React.createElement("div", {
    className: "tool-card-header"
  }, /*#__PURE__*/React.createElement("span", {
    className: "tool-card-icon"
  }, /*#__PURE__*/React.createElement(__ds_scope.ToolTypeIcon, {
    type: ttype,
    size: 28
  })), typeRow, actions), /*#__PURE__*/React.createElement("div", {
    className: "tool-card-desc description-badge"
  }, description || '—'), badges);
}
Object.assign(__ds_scope, { ToolCard });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/ToolCard.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Banner.jsx
try { (() => {
// ToolDex — Banner
// Full-width inline notice for setup/status conditions (warning, info, error).
// Pair with a leading lucide icon and an optional action button on the right.

function Banner({
  tone = 'info',
  icon,
  action,
  className = '',
  style,
  children
}) {
  const cls = tone === 'warn' ? 'banner-warn' : tone === 'error' ? 'error-banner' : 'banner-info';
  return /*#__PURE__*/React.createElement("div", {
    className: [cls, className].filter(Boolean).join(' '),
    role: tone === 'info' ? 'status' : 'alert',
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      flexWrap: 'wrap',
      ...style
    }
  }, icon, /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      minWidth: 200
    }
  }, children), action);
}
Object.assign(__ds_scope, { Banner });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Banner.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Spinner.jsx
try { (() => {
// ToolDex — Spinner
// The single loading indicator. A blue-topped ring. Compose with a label for
// full-screen loading states.

function Spinner({
  size = 28,
  borderWidth = 3,
  className = '',
  style
}) {
  return /*#__PURE__*/React.createElement("span", {
    className: ['spinner', className].filter(Boolean).join(' '),
    style: {
      width: size,
      height: size,
      borderWidth,
      ...style
    },
    role: "status",
    "aria-label": "Loading"
  });
}
Object.assign(__ds_scope, { Spinner });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Spinner.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Toast.jsx
try { (() => {
// ToolDex — Toast
// Bottom-right transient notification. Colored left border + icon by type.
// Render <ToastStack> with an array; the host owns timing/dismissal.
// Icons are inline SVG (lucide silhouettes) — dependency-free.

const Check = () => /*#__PURE__*/React.createElement("svg", {
  width: "16",
  height: "16",
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: "2",
  strokeLinecap: "round",
  strokeLinejoin: "round"
}, /*#__PURE__*/React.createElement("path", {
  d: "M21.8 10A10 10 0 1 1 17 3.3"
}), /*#__PURE__*/React.createElement("path", {
  d: "m9 11 3 3L22 4"
}));
const Alert = () => /*#__PURE__*/React.createElement("svg", {
  width: "16",
  height: "16",
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: "2",
  strokeLinecap: "round",
  strokeLinejoin: "round"
}, /*#__PURE__*/React.createElement("circle", {
  cx: "12",
  cy: "12",
  r: "10"
}), /*#__PURE__*/React.createElement("line", {
  x1: "12",
  y1: "8",
  x2: "12",
  y2: "12"
}), /*#__PURE__*/React.createElement("line", {
  x1: "12",
  y1: "16",
  x2: "12.01",
  y2: "16"
}));
const Info = () => /*#__PURE__*/React.createElement("svg", {
  width: "16",
  height: "16",
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: "2",
  strokeLinecap: "round",
  strokeLinejoin: "round"
}, /*#__PURE__*/React.createElement("circle", {
  cx: "12",
  cy: "12",
  r: "10"
}), /*#__PURE__*/React.createElement("path", {
  d: "M12 16v-4"
}), /*#__PURE__*/React.createElement("path", {
  d: "M12 8h.01"
}));
const X = () => /*#__PURE__*/React.createElement("svg", {
  width: "14",
  height: "14",
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: "2",
  strokeLinecap: "round",
  strokeLinejoin: "round"
}, /*#__PURE__*/React.createElement("path", {
  d: "M18 6 6 18M6 6l12 12"
}));
const ICONS = {
  success: Check,
  error: Alert,
  info: Info
};
function Toast({
  type = 'info',
  message,
  onDismiss
}) {
  const Icon = ICONS[type] || Info;
  return /*#__PURE__*/React.createElement("div", {
    className: `toast toast-${type}`,
    role: "status"
  }, /*#__PURE__*/React.createElement("span", {
    className: "toast-icon",
    style: {
      display: 'inline-flex'
    }
  }, /*#__PURE__*/React.createElement(Icon, null)), /*#__PURE__*/React.createElement("span", {
    className: "toast-msg"
  }, message), onDismiss && /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "icon-btn",
    style: {
      width: 22,
      height: 22
    },
    onClick: onDismiss,
    "aria-label": "Dismiss"
  }, /*#__PURE__*/React.createElement(X, null)));
}
function ToastStack({
  toasts = [],
  onDismiss
}) {
  if (!toasts.length) return null;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'fixed',
      bottom: 20,
      right: 20,
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
      zIndex: 2000,
      maxWidth: 360
    }
  }, toasts.map(t => /*#__PURE__*/React.createElement(Toast, {
    key: t.id,
    type: t.type,
    message: t.message,
    onDismiss: onDismiss ? () => onDismiss(t.id) : undefined
  })));
}
Object.assign(__ds_scope, { Toast, ToastStack });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Toast.jsx", error: String((e && e.message) || e) }); }

// components/forms/Input.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
// ToolDex — Input
// Labeled text/number field. Inputs are recessed (sit below the surface) with
// an uppercase micro-label. Focus turns the border brand-blue.

function Input({
  label,
  required = false,
  error,
  hint,
  type = 'text',
  value,
  onChange,
  placeholder,
  disabled = false,
  className = '',
  style,
  ...rest
}) {
  const inputCls = ['field-input', error ? 'error' : '', className].filter(Boolean).join(' ');
  const input = /*#__PURE__*/React.createElement("input", _extends({
    type: type,
    className: inputCls,
    value: value,
    onChange: onChange,
    placeholder: placeholder,
    disabled: disabled,
    style: label ? undefined : style
  }, rest));
  if (!label) return input;
  return /*#__PURE__*/React.createElement("label", {
    className: "field-group",
    style: style
  }, /*#__PURE__*/React.createElement("span", {
    className: "field-label"
  }, label, required && /*#__PURE__*/React.createElement("span", {
    className: "required"
  }, "*")), input, error && /*#__PURE__*/React.createElement("span", {
    className: "field-error"
  }, error), hint && !error && /*#__PURE__*/React.createElement("span", {
    className: "text-xs text-sub"
  }, hint));
}
Object.assign(__ds_scope, { Input });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Input.jsx", error: String((e && e.message) || e) }); }

// components/forms/SearchBar.jsx
try { (() => {
// ToolDex — SearchBar
// The library's primary search affordance. A recessed bar with a leading
// magnifier and a clear button that appears once there's a query.
// Icons are inline SVG (lucide silhouettes) so the component is dependency-free.

const SearchIcon = ({
  size = 16
}) => /*#__PURE__*/React.createElement("svg", {
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: "2",
  strokeLinecap: "round",
  strokeLinejoin: "round",
  style: {
    flexShrink: 0
  }
}, /*#__PURE__*/React.createElement("circle", {
  cx: "11",
  cy: "11",
  r: "8"
}), /*#__PURE__*/React.createElement("path", {
  d: "m21 21-4.3-4.3"
}));
const XIcon = ({
  size = 15
}) => /*#__PURE__*/React.createElement("svg", {
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: "2",
  strokeLinecap: "round",
  strokeLinejoin: "round"
}, /*#__PURE__*/React.createElement("path", {
  d: "M18 6 6 18M6 6l12 12"
}));
function SearchBar({
  value = '',
  onChange,
  onClear,
  placeholder = 'Search…',
  autoFocus = false,
  className = '',
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: ['search-bar', className].filter(Boolean).join(' '),
    style: style
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--text-sub)',
      display: 'inline-flex'
    }
  }, /*#__PURE__*/React.createElement(SearchIcon, null)), /*#__PURE__*/React.createElement("input", {
    type: "text",
    value: value,
    placeholder: placeholder,
    autoFocus: autoFocus,
    onChange: e => onChange && onChange(e.target.value)
  }), value && /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "icon-btn",
    style: {
      width: 22,
      height: 22
    },
    "aria-label": "Clear search",
    onClick: () => {
      onChange && onChange('');
      onClear && onClear();
    }
  }, /*#__PURE__*/React.createElement(XIcon, null)));
}
Object.assign(__ds_scope, { SearchBar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/SearchBar.jsx", error: String((e && e.message) || e) }); }

// components/forms/Select.jsx
try { (() => {
// ToolDex — Select
// Native select restyled with a theme chevron. Labeled like Input.

function Select({
  label,
  required = false,
  value,
  onChange,
  options = [],
  disabled = false,
  className = '',
  style,
  children
}) {
  const sel = /*#__PURE__*/React.createElement("select", {
    className: ['field-input', className].filter(Boolean).join(' '),
    value: value,
    onChange: onChange,
    disabled: disabled,
    style: label ? undefined : style
  }, children || options.map(opt => {
    const val = typeof opt === 'string' ? opt : opt.value;
    const lbl = typeof opt === 'string' ? opt : opt.label;
    return /*#__PURE__*/React.createElement("option", {
      key: val,
      value: val
    }, lbl);
  }));
  if (!label) return sel;
  return /*#__PURE__*/React.createElement("label", {
    className: "field-group",
    style: style
  }, /*#__PURE__*/React.createElement("span", {
    className: "field-label"
  }, label, required && /*#__PURE__*/React.createElement("span", {
    className: "required"
  }, "*")), sel);
}
Object.assign(__ds_scope, { Select });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Select.jsx", error: String((e && e.message) || e) }); }

// ui_kits/tooldex/app.jsx
try { (() => {
// ToolDex UI kit — interactive screens. Composes the design-system bundle
// components. One file, well-factored; mounted by index.html.
const DS = window.ToolDexDesignSystem_d6b872;
const {
  Button,
  IconButton,
  SearchBar,
  ToolCard,
  ToolTypeIcon,
  DataBadge,
  Toast,
  Banner
} = DS;
const Ic = window.KitIcons;
const TOOLS = window.TOOLDEX_TOOLS;
const fmt = v => v == null || v === '' ? null : isNaN(parseFloat(v)) ? v : parseFloat(v).toFixed(4).replace(/\.?0+$/, '');
const TYPES = ['flat end mill', 'ball end mill', 'bull nose end mill', 'drill', 'spot drill', 'tap', 'reamer', 'chamfer mill', 'counter sink', 'face mill', 'thread mill'];
const SORTS = [{
  value: 'updated',
  label: 'Recently updated'
}, {
  value: 'diameter_asc',
  label: 'Diameter ↑'
}, {
  value: 'vendor',
  label: 'Vendor A–Z'
}, {
  value: 'description',
  label: 'Description A–Z'
}];

// ─── Top bar ─────────────────────────────────────────────────────────────────
function TopBar({
  tab,
  onTab,
  onRefresh,
  spinning
}) {
  const tabs = [['library', 'Library', Ic.Library], ['materials', 'Materials', Ic.Flask], ['vendors', 'Vendors', Ic.Building], ['settings', 'Settings', Ic.Settings]];
  return /*#__PURE__*/React.createElement("header", {
    className: "topbar"
  }, /*#__PURE__*/React.createElement("a", {
    className: "topbar-brand",
    onClick: () => onTab('library')
  }, /*#__PURE__*/React.createElement("img", {
    src: "../../assets/tooldex-mark.svg",
    alt: ""
  }), /*#__PURE__*/React.createElement("span", null, "Tool", /*#__PURE__*/React.createElement("b", null, "Dex"))), /*#__PURE__*/React.createElement("nav", {
    className: "topbar-tabs"
  }, tabs.map(([id, label, Icon]) => /*#__PURE__*/React.createElement("a", {
    key: id,
    className: `topbar-tab${tab === id ? ' active' : ''}`,
    onClick: () => onTab(id)
  }, /*#__PURE__*/React.createElement(Icon, {
    size: 14
  }), " ", label))), /*#__PURE__*/React.createElement("div", {
    className: "topbar-actions"
  }, /*#__PURE__*/React.createElement(IconButton, {
    title: "Re-download library from Autodesk",
    onClick: onRefresh
  }, /*#__PURE__*/React.createElement(Ic.Refresh, {
    size: 15,
    style: spinning ? {
      animation: 'spin 1s linear infinite'
    } : undefined
  }))));
}

// ─── Library view ────────────────────────────────────────────────────────────
function LibraryView({
  onOpen,
  notify
}) {
  const [q, setQ] = React.useState('');
  const [types, setTypes] = React.useState([]);
  const [view, setView] = React.useState('grid');
  const [sort, setSort] = React.useState('updated');
  const toggleType = (t, additive) => {
    setTypes(prev => {
      if (additive) return prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t];
      return prev.length === 1 && prev[0] === t ? [] : [t];
    });
  };
  let filtered = TOOLS.filter(t => {
    if (types.length && !types.includes(t.tool_type)) return false;
    if (q) {
      const hay = `${t.description} ${t.proshop_id} ${t.vendor} ${t.tool_type}`.toLowerCase();
      if (!hay.includes(q.toLowerCase())) return false;
    }
    return true;
  });
  filtered = [...filtered].sort((a, b) => {
    if (sort === 'diameter_asc') return (a.diameter || 0) - (b.diameter || 0);
    if (sort === 'vendor') return (a.vendor || '').localeCompare(b.vendor || '');
    if (sort === 'description') return (a.description || '').localeCompare(b.description || '');
    return 0;
  });
  const hasFilters = types.length || q;
  return /*#__PURE__*/React.createElement("div", {
    className: "landing-layout"
  }, /*#__PURE__*/React.createElement("aside", {
    className: "landing-sidebar"
  }, /*#__PURE__*/React.createElement("button", {
    className: "tool-sidebar-btn",
    onClick: () => notify('Opening Sync Job flow…', 'info'),
    title: "Sync proven speeds & feeds from a job back to the master library"
  }, /*#__PURE__*/React.createElement(Ic.GitMerge, {
    size: 22
  }), /*#__PURE__*/React.createElement("span", null, "Sync Job"))), /*#__PURE__*/React.createElement("div", {
    className: "landing-main"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      marginBottom: 16
    }
  }, /*#__PURE__*/React.createElement(SearchBar, {
    value: q,
    onChange: setQ,
    placeholder: `Search ${TOOLS.length} tools…  ( / to focus )`,
    style: {
      flex: 1
    }
  }), /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    onClick: () => notify('Add Tool flow…', 'info')
  }, /*#__PURE__*/React.createElement(Ic.Plus, {
    size: 16
  }), " Add Tool")), /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 16
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "section-header",
    style: {
      marginBottom: 8
    }
  }, "Tool Type ", /*#__PURE__*/React.createElement("span", {
    style: {
      textTransform: 'none',
      letterSpacing: 'normal',
      color: 'var(--text-faint)',
      fontWeight: 400
    }
  }, "\xB7 ", types.length > 1 ? `${types.length} selected` : 'shift-click to select multiple')), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexWrap: 'wrap',
      gap: 6
    }
  }, TYPES.map(t => /*#__PURE__*/React.createElement("button", {
    key: t,
    className: `type-chip${types.includes(t) ? ' active' : ''}`,
    onClick: e => toggleType(t, e.shiftKey)
  }, /*#__PURE__*/React.createElement(ToolTypeIcon, {
    type: t,
    size: 16
  }), " ", t.replace(/\b\w/g, c => c.toUpperCase()))))), /*#__PURE__*/React.createElement("div", {
    className: "results-toolbar",
    style: {
      marginBottom: 12
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "result-count"
  }, filtered.length === TOOLS.length ? `${TOOLS.length} tools` : `${filtered.length} of ${TOOLS.length} tools match`), hasFilters ? /*#__PURE__*/React.createElement(Button, {
    variant: "ghost",
    size: "sm",
    onClick: () => {
      setTypes([]);
      setQ('');
    }
  }, "Reset") : null, /*#__PURE__*/React.createElement("span", {
    className: "topbar-spacer"
  }), /*#__PURE__*/React.createElement("label", {
    className: "sort-control"
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      color: 'var(--text-sub)'
    }
  }, "Sort"), /*#__PURE__*/React.createElement("select", {
    className: "field-input",
    value: sort,
    onChange: e => setSort(e.target.value)
  }, SORTS.map(s => /*#__PURE__*/React.createElement("option", {
    key: s.value,
    value: s.value
  }, s.label)))), /*#__PURE__*/React.createElement("div", {
    className: "view-toggle"
  }, /*#__PURE__*/React.createElement(IconButton, {
    title: "Grid view",
    active: view === 'grid',
    onClick: () => setView('grid')
  }, /*#__PURE__*/React.createElement(Ic.Grid, {
    size: 15
  })), /*#__PURE__*/React.createElement(IconButton, {
    title: "List view",
    active: view === 'list',
    onClick: () => setView('list')
  }, /*#__PURE__*/React.createElement(Ic.List, {
    size: 15
  })))), filtered.length === 0 ? /*#__PURE__*/React.createElement("div", {
    className: "empty-state"
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--text-sub)'
    }
  }, "No tools match these filters.")) : view === 'list' ? /*#__PURE__*/React.createElement("div", {
    className: "tool-list"
  }, filtered.map(t => /*#__PURE__*/React.createElement(ToolCard, {
    key: t.id,
    tool: t,
    variant: "list",
    onOpen: () => onOpen(t.id),
    actions: /*#__PURE__*/React.createElement(RowActions, {
      notify: notify
    })
  }))) : /*#__PURE__*/React.createElement("div", {
    className: "tool-grid"
  }, filtered.map(t => /*#__PURE__*/React.createElement(ToolCard, {
    key: t.id,
    tool: t,
    onOpen: () => onOpen(t.id),
    actions: /*#__PURE__*/React.createElement(RowActions, {
      notify: notify
    })
  })))));
}
function RowActions({
  notify
}) {
  const stop = fn => e => {
    e.stopPropagation();
    fn();
  };
  return /*#__PURE__*/React.createElement("div", {
    className: "card-actions"
  }, /*#__PURE__*/React.createElement(IconButton, {
    title: "Edit",
    onClick: stop(() => notify('Edit tool…', 'info'))
  }, /*#__PURE__*/React.createElement(Ic.Pencil, {
    size: 13
  })), /*#__PURE__*/React.createElement(IconButton, {
    title: "Duplicate",
    onClick: stop(() => notify('Duplicated tool', 'success'))
  }, /*#__PURE__*/React.createElement(Ic.Copy, {
    size: 13
  })));
}

// ─── Tool detail view ──────────────────────────────────────────────────────
function ToolDetail({
  tool,
  onBack,
  notify
}) {
  const spec = (label, val) => val == null || val === '' ? null : /*#__PURE__*/React.createElement("div", {
    className: "detail-field",
    key: label
  }, /*#__PURE__*/React.createElement("span", {
    className: "detail-field-label"
  }, label), /*#__PURE__*/React.createElement("span", {
    className: "detail-field-value"
  }, val));
  return /*#__PURE__*/React.createElement("div", {
    style: {
      paddingBottom: 32
    }
  }, /*#__PURE__*/React.createElement("button", {
    className: "back-link",
    onClick: onBack
  }, /*#__PURE__*/React.createElement(Ic.ChevronLeft, {
    size: 16
  }), " Back to library"), /*#__PURE__*/React.createElement("div", {
    className: "detail-header"
  }, /*#__PURE__*/React.createElement("span", {
    className: "detail-header-icon"
  }, /*#__PURE__*/React.createElement(ToolTypeIcon, {
    type: tool.tool_type,
    size: 36
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "description-badge",
    style: {
      fontSize: 16
    }
  }, tool.description), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 8,
      marginTop: 8,
      flexWrap: 'wrap',
      alignItems: 'center'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      color: 'var(--text-sub)',
      textTransform: 'uppercase',
      letterSpacing: '0.05em'
    }
  }, tool.tool_type), tool.proshop_id && /*#__PURE__*/React.createElement(DataBadge, {
    kind: "proshop",
    href: "#"
  }, tool.proshop_id), tool.machine_tool_number != null && /*#__PURE__*/React.createElement(DataBadge, {
    kind: "machine"
  }, String(tool.machine_tool_number)), tool.location && /*#__PURE__*/React.createElement(DataBadge, {
    kind: "location"
  }, tool.location))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 6
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    size: "sm",
    onClick: () => notify('Edit tool…', 'info')
  }, /*#__PURE__*/React.createElement(Ic.Pencil, {
    size: 13
  }), " Edit"), /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    size: "sm",
    onClick: () => notify('Exported to ProShop CSV', 'success')
  }, /*#__PURE__*/React.createElement(Ic.Download, {
    size: 13
  }), " ProShop"))), /*#__PURE__*/React.createElement("div", {
    className: "detail-layout"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "panel open"
  }, /*#__PURE__*/React.createElement("div", {
    className: "panel-header"
  }, /*#__PURE__*/React.createElement("span", {
    className: "panel-header-icon"
  }, /*#__PURE__*/React.createElement(Ic.Settings, {
    size: 14
  })), /*#__PURE__*/React.createElement("span", {
    className: "panel-header-title"
  }, "Dimensions")), /*#__PURE__*/React.createElement("div", {
    className: "panel-body"
  }, /*#__PURE__*/React.createElement("div", {
    className: "detail-fields"
  }, spec('Diameter', fmt(tool.diameter) && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("span", {
    className: "dia"
  }, "\u2300"), " ", fmt(tool.diameter), " ", tool.unit)), spec('Flutes', tool.number_of_flutes), spec('LOC', fmt(tool.flute_length) && `${fmt(tool.flute_length)} ${tool.unit}`), spec('OAL', fmt(tool.overall_length) && `${fmt(tool.overall_length)} ${tool.unit}`), spec('Shank', fmt(tool.shank) && `${fmt(tool.shank)} ${tool.unit}`), spec('Corner R', fmt(tool.corner_radius)), spec('Point ∠', tool.point_angle && `${tool.point_angle}°`), spec('Coating', tool.coating), spec('Vendor', tool.vendor)))), /*#__PURE__*/React.createElement("div", {
    className: "panel open"
  }, /*#__PURE__*/React.createElement("div", {
    className: "panel-header"
  }, /*#__PURE__*/React.createElement("span", {
    className: "panel-header-icon"
  }, /*#__PURE__*/React.createElement(Ic.GitMerge, {
    size: 14
  })), /*#__PURE__*/React.createElement("span", {
    className: "panel-header-title"
  }, "Presets \xB7 Speeds & Feeds")), /*#__PURE__*/React.createElement("div", {
    className: "panel-body"
  }, /*#__PURE__*/React.createElement("div", {
    className: "preset-list"
  }, tool.presets.map((p, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8
    }
  }, /*#__PURE__*/React.createElement(DataBadge, {
    kind: "preset",
    material: p.material
  }, p.name), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      color: 'var(--text-faint)'
    }
  }, p.material))))))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "panel open"
  }, /*#__PURE__*/React.createElement("div", {
    className: "panel-header"
  }, /*#__PURE__*/React.createElement("span", {
    className: "panel-header-icon"
  }, /*#__PURE__*/React.createElement(Ic.Wrench, {
    size: 14
  })), /*#__PURE__*/React.createElement("span", {
    className: "panel-header-title"
  }, "Assemblies")), /*#__PURE__*/React.createElement("div", {
    className: "panel-body"
  }, tool.assemblies.map((a, i) => /*#__PURE__*/React.createElement("div", {
    className: "assembly-row",
    key: i
  }, /*#__PURE__*/React.createElement(DataBadge, {
    kind: "holder"
  }, a.holder_description), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13,
      fontWeight: 700,
      fontFamily: 'var(--font-mono)',
      whiteSpace: 'nowrap'
    }
  }, "OOH ", a.ooh.toFixed(3), " ", tool.unit))), /*#__PURE__*/React.createElement(Button, {
    variant: "ghost",
    size: "sm",
    style: {
      marginTop: 4
    },
    onClick: () => notify('Add assembly…', 'info')
  }, /*#__PURE__*/React.createElement(Ic.Plus, {
    size: 13
  }), " Add assembly"))))));
}

// ─── Login view ──────────────────────────────────────────────────────────────
function LoginView({
  onSignIn
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "login-wrap"
  }, /*#__PURE__*/React.createElement("div", {
    className: "login-card"
  }, /*#__PURE__*/React.createElement("img", {
    className: "login-mark",
    src: "../../assets/tooldex-mark.svg",
    alt: "ToolDex"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-display)',
      fontSize: 26,
      fontWeight: 700,
      letterSpacing: '-0.02em'
    }
  }, "Tool", /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--blue)'
    }
  }, "Dex")), /*#__PURE__*/React.createElement("p", {
    style: {
      color: 'var(--text-sub)',
      fontSize: 14,
      margin: '8px 0 24px',
      lineHeight: 1.6
    }
  }, "Your master cutting-tool library \u2014 every tool, holder, and proven speed & feed in one place."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 10
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    size: "lg",
    onClick: onSignIn,
    style: {
      justifyContent: 'center'
    }
  }, "Sign in with Autodesk"), /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    onClick: onSignIn,
    style: {
      justifyContent: 'center'
    }
  }, /*#__PURE__*/React.createElement(Ic.Upload, {
    size: 15
  }), " Browse a local library"), /*#__PURE__*/React.createElement(Button, {
    variant: "ghost",
    onClick: onSignIn,
    style: {
      justifyContent: 'center'
    }
  }, /*#__PURE__*/React.createElement(Ic.Flask, {
    size: 14
  }), " Explore demo data"))));
}

// ─── App orchestrator ──────────────────────────────────────────────────────
function App() {
  const [authed, setAuthed] = React.useState(false);
  const [tab, setTab] = React.useState('library');
  const [openId, setOpenId] = React.useState(null);
  const [spinning, setSpinning] = React.useState(false);
  const [toasts, setToasts] = React.useState([]);
  const notify = (message, type = 'info') => {
    const id = Date.now() + Math.random();
    setToasts(t => [...t, {
      id,
      message,
      type
    }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 2600);
  };
  const refresh = () => {
    setSpinning(true);
    setTimeout(() => {
      setSpinning(false);
      notify('Library up to date', 'success');
    }, 900);
  };
  const openTool = TOOLS.find(t => t.id === openId);
  let body;
  if (!authed) {
    body = /*#__PURE__*/React.createElement(LoginView, {
      onSignIn: () => setAuthed(true)
    });
  } else {
    let inner;
    if (tab !== 'library') {
      inner = /*#__PURE__*/React.createElement("div", {
        className: "page-content"
      }, /*#__PURE__*/React.createElement("div", {
        className: "card empty-state"
      }, /*#__PURE__*/React.createElement("div", {
        style: {
          color: 'var(--text-sub)'
        }
      }, "The ", /*#__PURE__*/React.createElement("b", {
        style: {
          color: 'var(--text)'
        }
      }, tab), " screen lives in the full product. This kit demonstrates the Library and Tool Detail flows.")));
    } else if (openTool) {
      inner = /*#__PURE__*/React.createElement("div", {
        className: "page-content"
      }, /*#__PURE__*/React.createElement(ToolDetail, {
        tool: openTool,
        onBack: () => setOpenId(null),
        notify: notify
      }));
    } else {
      inner = /*#__PURE__*/React.createElement(LibraryView, {
        onOpen: setOpenId,
        notify: notify
      });
    }
    body = /*#__PURE__*/React.createElement("div", {
      className: "app-shell"
    }, /*#__PURE__*/React.createElement(TopBar, {
      tab: tab,
      onTab: t => {
        setTab(t);
        setOpenId(null);
      },
      onRefresh: refresh,
      spinning: spinning
    }), inner);
  }
  return /*#__PURE__*/React.createElement(React.Fragment, null, body, /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'fixed',
      bottom: 20,
      right: 20,
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
      zIndex: 2000
    }
  }, toasts.map(t => /*#__PURE__*/React.createElement(Toast, {
    key: t.id,
    type: t.type,
    message: t.message,
    onDismiss: () => setToasts(x => x.filter(y => y.id !== t.id))
  }))));
}
ReactDOM.createRoot(document.getElementById('root')).render(/*#__PURE__*/React.createElement(App, null));
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/tooldex/app.jsx", error: String((e && e.message) || e) }); }

// ui_kits/tooldex/data.js
try { (() => {
// ToolDex UI kit — sample library data (fake, representative of a real shop).
// Field names mirror the product's tool schema so ToolCard/DataBadge read them.
window.TOOLDEX_TOOLS = [{
  id: 't1',
  tool_type: 'drill',
  description: 'PS D-53 5/16 Carbide Drill 1.693 LOC',
  proshop_id: 'D-53',
  machine_tool_number: 4,
  diameter: 0.3125,
  number_of_flutes: 2,
  flute_length: 1.693,
  vendor: 'Guhring',
  coating: 'TiAlN',
  location: 'CAB-2 · B3',
  unit: 'in',
  overall_length: 3.386,
  shank: 0.3125,
  point_angle: 140,
  assemblies: [{
    holder_description: 'NBT30-SK20C-60',
    ooh: 1.500
  }],
  presets: [{
    name: 'AL 1.500 30-SK20-60 - Drill',
    material: 'Aluminum'
  }, {
    name: 'SS 1.500 30-SK20-60 - Drill',
    material: '304 Stainless'
  }]
}, {
  id: 't2',
  tool_type: 'flat end mill',
  description: '1/2" 3FL AlTiN Rougher',
  proshop_id: 'A-12',
  machine_tool_number: 7,
  diameter: 0.5,
  number_of_flutes: 3,
  flute_length: 1.25,
  vendor: 'Helical',
  coating: 'AlTiN',
  preferred_machine: 'VF-2',
  location: 'CAB-1 · A2',
  unit: 'in',
  overall_length: 3.0,
  shank: 0.5,
  assemblies: [{
    holder_description: 'NBT30-SK13C-90',
    ooh: 1.625
  }],
  presets: [{
    name: 'AL 1.625 30-SK13-90 - Rough',
    material: 'Aluminum'
  }, {
    name: 'AL 1.625 30-SK13-90 - Finish',
    material: 'Aluminum'
  }, {
    name: 'P 1.625 30-SK13-90 - Rough',
    material: '4140 Alloy Steel'
  }]
}, {
  id: 't3',
  tool_type: 'ball end mill',
  description: '1/4" 4FL Ball — Finishing',
  proshop_id: 'B-07',
  machine_tool_number: 2,
  diameter: 0.25,
  number_of_flutes: 4,
  flute_length: 0.75,
  vendor: 'Harvey Tool',
  coating: 'AlTiN',
  location: 'CAB-1 · A5',
  unit: 'in',
  overall_length: 2.5,
  shank: 0.25,
  assemblies: [{
    holder_description: 'NBT30-SK13C-120',
    ooh: 2.000
  }],
  presets: [{
    name: 'SS 2.000 30-SK13-120 - Fine Finish',
    material: '316 Stainless'
  }, {
    name: 'TI 2.000 30-SK13-120 - Finish',
    material: 'Titanium'
  }]
}, {
  id: 't4',
  tool_type: 'tap',
  description: '1/4-20 Spiral Flute Tap',
  proshop_id: 'T-18',
  machine_tool_number: 11,
  diameter: 0.25,
  vendor: 'OSG',
  coating: 'Bright',
  location: 'CAB-3 · C1',
  unit: 'in',
  overall_length: 2.5,
  assemblies: [{
    holder_description: 'DRILL CHUCK',
    ooh: 1.250
  }],
  presets: [{
    name: 'AL 1.250 DRILL CHUCK - Tap',
    material: 'Aluminum'
  }]
}, {
  id: 't5',
  tool_type: 'face mill',
  description: '2" 5-Insert Face Mill',
  proshop_id: 'F-02',
  machine_tool_number: 1,
  diameter: 2.0,
  number_of_flutes: 5,
  vendor: 'Sandvik',
  location: 'SHELF · D',
  unit: 'in',
  overall_length: 1.75,
  assemblies: [{
    holder_description: 'NBT30-SK20C-90',
    ooh: 1.000
  }],
  presets: [{
    name: 'P 1.000 30-SK20-90 - Face',
    material: '1045 Steel'
  }, {
    name: 'K 1.000 30-SK20-90 - Face',
    material: 'Gray Cast Iron'
  }]
}, {
  id: 't6',
  tool_type: 'chamfer mill',
  description: '1/2" 90° Chamfer Mill',
  proshop_id: 'C-04',
  machine_tool_number: 6,
  diameter: 0.5,
  number_of_flutes: 4,
  vendor: 'Lakeshore',
  coating: 'TiN',
  location: 'CAB-1 · A3',
  unit: 'in',
  overall_length: 2.5,
  assemblies: [{
    holder_description: 'NBT30-SK13C-60',
    ooh: 1.375
  }],
  presets: [{
    name: 'AL 1.375 30-SK13-60 - Chamfer',
    material: 'Aluminum'
  }]
}, {
  id: 't7',
  tool_type: 'spot drill',
  description: '1/2" 90° Spot Drill',
  proshop_id: 'D-22',
  machine_tool_number: 5,
  diameter: 0.5,
  number_of_flutes: 2,
  vendor: 'Guhring',
  coating: 'TiAlN',
  location: 'CAB-2 · B1',
  unit: 'in',
  overall_length: 2.5,
  assemblies: [{
    holder_description: 'NBT30-SK20C-60',
    ooh: 1.200
  }],
  presets: [{
    name: 'P 1.200 30-SK20-60 - Spot',
    material: 'A36 Steel'
  }]
}, {
  id: 't8',
  tool_type: 'bull nose end mill',
  description: '3/8" Bull .060R 4FL',
  proshop_id: 'A-31',
  machine_tool_number: 8,
  diameter: 0.375,
  number_of_flutes: 4,
  flute_length: 1.0,
  vendor: 'Helical',
  coating: 'AlTiN',
  corner_radius: 0.06,
  location: 'CAB-1 · A2',
  unit: 'in',
  overall_length: 2.5,
  assemblies: [{
    holder_description: 'NBT30-SK13C-90',
    ooh: 1.500
  }],
  presets: [{
    name: 'AL 1.500 30-SK13-90 - Rough',
    material: 'Aluminum'
  }, {
    name: 'SS 1.500 30-SK13-90 - Rough',
    material: '304 Stainless'
  }]
}, {
  id: 't9',
  tool_type: 'reamer',
  description: '0.250 Chucking Reamer',
  proshop_id: 'R-09',
  machine_tool_number: 12,
  diameter: 0.25,
  number_of_flutes: 6,
  vendor: 'Guhring',
  location: 'CAB-3 · C2',
  unit: 'in',
  overall_length: 3.0,
  assemblies: [{
    holder_description: 'DRILL CHUCK',
    ooh: 1.500
  }],
  presets: [{
    name: 'P 1.500 DRILL CHUCK - Ream',
    material: '4140 Alloy Steel'
  }]
}, {
  id: 't10',
  tool_type: 'ball end mill',
  description: '1/8" 2FL Ball Micro',
  proshop_id: 'B-15',
  machine_tool_number: 3,
  diameter: 0.125,
  number_of_flutes: 2,
  flute_length: 0.5,
  vendor: 'Harvey Tool',
  coating: 'AlTiN',
  location: 'CAB-1 · A6',
  unit: 'in',
  overall_length: 1.5,
  assemblies: [{
    holder_description: 'NBT30-SK13C-150',
    ooh: 2.250
  }],
  presets: [{
    name: 'TI 2.250 30-SK13-150 - Fine Finish',
    material: 'Titanium'
  }]
}, {
  id: 't11',
  tool_type: 'counter sink',
  description: '82° Countersink 1/2"',
  proshop_id: 'CS-01',
  machine_tool_number: 9,
  diameter: 0.5,
  number_of_flutes: 3,
  vendor: 'KEO',
  location: 'CAB-2 · B4',
  unit: 'in',
  overall_length: 2.25,
  assemblies: [{
    holder_description: 'NBT30-SK13C-60',
    ooh: 1.100
  }],
  presets: [{
    name: 'AL 1.100 30-SK13-60 - C-Sink',
    material: 'Aluminum'
  }]
}, {
  id: 't12',
  tool_type: 'thread mill',
  description: '3/8-16 Single-Profile Thread Mill',
  proshop_id: 'TM-03',
  machine_tool_number: 10,
  diameter: 0.3,
  number_of_flutes: 3,
  vendor: 'Vargus',
  coating: 'TiAlN',
  location: 'CAB-3 · C3',
  unit: 'in',
  overall_length: 2.5,
  assemblies: [{
    holder_description: 'NBT30-SK13C-90',
    ooh: 1.400
  }],
  presets: [{
    name: 'SS 1.400 30-SK13-90 - Thread',
    material: '316 Stainless'
  }]
}];
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/tooldex/data.js", error: String((e && e.message) || e) }); }

// ui_kits/tooldex/icons.jsx
try { (() => {
// ToolDex UI kit — inline lucide icons (the app uses lucide-react). Stroke
// currentColor, 2px, rounded. Exported to window for the other kit scripts.
const I = (paths, vb = '24') => ({
  size = 16,
  strokeWidth = 2,
  style
} = {}) => React.createElement('svg', {
  width: size,
  height: size,
  viewBox: `0 0 ${vb} ${vb}`,
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  style
}, paths.map((d, i) => React.createElement('path', {
  key: i,
  d
})));
const IconCircle = (children, extra = []) => ({
  size = 16,
  strokeWidth = 2,
  style
} = {}) => React.createElement('svg', {
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  style
}, [React.createElement('circle', {
  key: 'c',
  cx: 12,
  cy: 12,
  r: 10
}), ...children]);
window.KitIcons = {
  Wrench: I(['M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.8 2.8-2-2 2.8-2.8z']),
  Library: I(['M12 7v14', 'M16 12h2', 'M16 8h2', 'M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z']),
  Flask: I(['M10 2v7.31', 'M14 9.3V1.99', 'M8.5 2h7', 'M14 9.3a6.5 6.5 0 1 1-4 0', 'M5.52 16h12.96']),
  Building: I(['M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z', 'M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2', 'M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2', 'M10 6h4', 'M10 10h4', 'M10 14h4', 'M10 18h4']),
  Settings: I(['M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z', 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z']),
  Refresh: I(['M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8', 'M21 3v5h-5', 'M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16', 'M8 16H3v5']),
  GitMerge: I(['M6 21V9', 'M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z', 'M18 18a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z', 'M6 9a9 9 0 0 0 9 9']),
  Plus: I(['M5 12h14', 'M12 5v14']),
  Grid: I(['M3 3h7v7H3z', 'M14 3h7v7h-7z', 'M14 14h7v7h-7z', 'M3 14h7v7H3z']),
  List: I(['M8 6h13', 'M8 12h13', 'M8 18h13', 'M3 6h.01', 'M3 12h.01', 'M3 18h.01']),
  ChevronLeft: I(['M15 18l-6-6 6-6']),
  Pencil: I(['M21.17 6.83a2.83 2.83 0 0 0-4-4L3 17v4h4z', 'M15 5l4 4']),
  Copy: I(['M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2', 'M4 16a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v0']),
  Download: I(['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'M7 10l5 5 5-5', 'M12 15V3']),
  Upload: I(['M12 13v8', 'M4 17.5A4.5 4.5 0 0 1 5.5 9 6 6 0 0 1 17 7a4.5 4.5 0 0 1 2 8.5', 'M16 16l-4-4-4 4']),
  X: I(['M18 6 6 18', 'M6 6l12 12']),
  Trash: I(['M3 6h18', 'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2', 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6'])
};
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/tooldex/icons.jsx", error: String((e && e.message) || e) }); }

__ds_ns.Badge = __ds_scope.Badge;

__ds_ns.Button = __ds_scope.Button;

__ds_ns.Card = __ds_scope.Card;

__ds_ns.Chip = __ds_scope.Chip;

__ds_ns.IconButton = __ds_scope.IconButton;

__ds_ns.SegmentedToggle = __ds_scope.SegmentedToggle;

__ds_ns.DataBadge = __ds_scope.DataBadge;

__ds_ns.ToolCard = __ds_scope.ToolCard;

__ds_ns.ToolTypeIcon = __ds_scope.ToolTypeIcon;

__ds_ns.Banner = __ds_scope.Banner;

__ds_ns.Spinner = __ds_scope.Spinner;

__ds_ns.Toast = __ds_scope.Toast;

__ds_ns.ToastStack = __ds_scope.ToastStack;

__ds_ns.Input = __ds_scope.Input;

__ds_ns.SearchBar = __ds_scope.SearchBar;

__ds_ns.Select = __ds_scope.Select;

})();
