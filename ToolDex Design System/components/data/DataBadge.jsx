import React from 'react';

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
  'no-fusion': 'no-fusion-pill',
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
  'DRILL CHUCK': 'var(--holder-drill-chuck)',
};

// Normalize a Fusion holder description ("NBT30-SK13C-60") to its short name
// ("30-SK13-60"): strip leading NBT, drop the C after an SK collet token.
function holderShortName(desc) {
  if (!desc) return '';
  return String(desc).trim().toUpperCase()
    .replace(/^NBT/, '')
    .replace(/(SK\d+)C(?=[^A-Z]|$)/g, '$1')
    .trim();
}

function holderColor(name) {
  const short = holderShortName(name);
  return HOLDER_COLORS[short] || 'var(--holder-default)';
}

// ── Material → ISO group → color ─────────────────────────────────────────────
const ISO_COLORS = { P: 'var(--iso-p)', M: 'var(--iso-m)', K: 'var(--iso-k)', N: 'var(--iso-n)', S: 'var(--iso-s)', H: 'var(--iso-h)' };

// Best-effort material string → ISO 513 group (matches the app's matchMaterial).
function materialIsoGroup(str) {
  if (!str) return null;
  const s = String(str).toUpperCase();
  if (s.includes('STAINLESS') || /\bSS\b|^SS\d/.test(s)) return 'M';
  if (s.includes('ALUM') || /\bAL\b|^AL\d/.test(s)) return 'N';
  if (s.includes('BRASS') || s.includes('BRONZE') || s.includes('COPPER')) return 'N';
  if (s.includes('TITAN') || /\bTI\b/.test(s)) return 'S';
  if (s.includes('CAST') || (s.includes('IRON') && !s.includes('STEEL')) || /\bCI\b/.test(s)) return 'K';
  if (s.includes('HARDEN') || /\bHRC\b/.test(s)) return 'H';
  if (/STEEL|MILD|LOW CARBON|ALLOY|\bP\d/.test(s)) return 'P';
  return null;
}

export function DataBadge({ kind = 'description', children, href, title, onClick, color, material, isoGroup, style }) {
  const className = CLASS[kind] || 'meta-badge';
  let resolved = { ...(style || {}) };

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
    content = (<><span className="preset-dot" aria-hidden="true" />{children}</>);
  }

  if (href) {
    return (
      <a className={className} href={href} title={title} style={resolved}
         target="_blank" rel="noopener noreferrer" onClick={onClick}>
        {content}
      </a>
    );
  }
  return (
    <span className={className} title={title} style={resolved} onClick={onClick}>
      {content}
    </span>
  );
}
