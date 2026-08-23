// Thread designations & tap tolerance option lists — inch/metric thread-size
// lists, the ProShop Thread-column resolver, and tap limit-tolerance /
// class-of-fit constants.

// Inch / metric thread-size option lists shown in the Tap / Thread Mill thread-size
// combobox, selected by `tap_thread_unit` (independent of the tool's overall unit).
export const INCH_THREAD_SIZES = [
  // Number sizes
  '#0-80 UNF', '#1-64 UNC', '#1-72 UNF', '#2-56 UNC', '#2-64 UNF',
  '#3-48 UNC', '#3-56 UNF', '#4-40 UNC', '#4-48 UNF', '#5-40 UNC', '#5-44 UNF',
  '#6-32 UNC', '#6-40 UNF', '#8-32 UNC', '#8-36 UNF', '#10-24 UNC', '#10-32 UNF',
  '#12-24 UNC', '#12-28 UNF',
  // Fractional
  '1/4-20 UNC', '1/4-28 UNF', '5/16-18 UNC', '5/16-24 UNF', '3/8-16 UNC', '3/8-24 UNF',
  '7/16-14 UNC', '7/16-20 UNF', '1/2-13 UNC', '1/2-20 UNF', '9/16-12 UNC', '9/16-18 UNF',
  '5/8-11 UNC', '5/8-18 UNF', '3/4-10 UNC', '3/4-16 UNF', '7/8-9 UNC', '7/8-14 UNF',
  '1-8 UNC', '1-12 UNF', '1-1/8-7 UNC', '1-1/8-12 UNF', '1-1/4-7 UNC', '1-1/4-12 UNF',
  '1-3/8-6 UNC', '1-3/8-12 UNF', '1-1/2-6 UNC', '1-1/2-12 UNF', '1-3/4-5 UNC', '2-4.5 UNC',
  // Pipe
  '1/8-27 NPT', '1/4-18 NPT', '3/8-18 NPT', '1/2-14 NPT', '3/4-14 NPT', '1-11.5 NPT',
  '1-1/4-11.5 NPT', '1-1/2-11.5 NPT', '2-11.5 NPT',
  '1/8-27 NPTF', '1/4-18 NPTF', '3/8-18 NPTF', '1/2-14 NPTF', '3/4-14 NPTF', '1-11.5 NPTF',
  // Custom
  'Custom...',
];

export const METRIC_THREAD_SIZES = [
  'M1 x 0.25', 'M1.2 x 0.25', 'M1.4 x 0.3', 'M1.6 x 0.35', 'M2 x 0.4', 'M2.5 x 0.45',
  'M3 x 0.5', 'M3.5 x 0.6', 'M4 x 0.7', 'M5 x 0.8', 'M6 x 1.0', 'M6 x 0.75',
  'M8 x 1.25', 'M8 x 1.0', 'M10 x 1.5', 'M10 x 1.25', 'M10 x 1.0', 'M12 x 1.75', 'M12 x 1.25',
  'M14 x 2.0', 'M14 x 1.5', 'M16 x 2.0', 'M16 x 1.5', 'M18 x 2.5', 'M18 x 1.5',
  'M20 x 2.5', 'M20 x 1.5', 'M22 x 2.5', 'M22 x 1.5', 'M24 x 3.0', 'M24 x 2.0',
  'M27 x 3.0', 'M27 x 2.0', 'M30 x 3.5', 'M30 x 2.0', 'M33 x 3.5', 'M33 x 2.0',
  'M36 x 4.0', 'M36 x 3.0', 'M39 x 4.0', 'M39 x 3.0', 'M42 x 4.5', 'M42 x 3.0',
  'M45 x 4.5', 'M45 x 3.0', 'M48 x 5.0', 'M48 x 3.0',
  'M52 x 5.0', 'M56 x 5.5', 'M60 x 5.5', 'M64 x 6.0',
  // Custom
  'Custom...',
];

// Normalize a thread designation to a comparison key so ProShop's bare strings
// match our canonical list. Lowercases, drops the UN-series suffix (UNC/UNF/UNEF/
// UNS/UN — implied for inch threads, which is why ProShop omits it), and strips
// '#' and spaces. NPT/NPTF are intentionally NOT stripped (pipe threads change
// the form and are always spelled out). E.g. "5/16-24 UNF", "5/16-24", and
// "#10-32 UNF" vs "10-32" all collapse to a stable key.
export function threadKey(s) {
  return (s || '')
    .toLowerCase()
    .trim()
    .replace(/\bun[cfse]*\b/g, '')   // unc / unf / unef / uns / un
    .replace(/[#\s]/g, '');
}

// Canonical comparison key for a METRIC designation. The same thread is spelled
// a dozen ways — "M6x1", "M6 x 1.0", "M6-1.0", "M6X1.00", "M6 x 1 mm" — and
// threadKey (built for inch) can't collapse them: it keeps the separator and the
// trailing decimal zeros, so "M6x1" never matched the list's "M6 x 1.0" and the
// tap fell through to a hand-typed "custom" thread with the INCH list showing.
// Reduces to "m6x1": diameter, 'x', pitch, each with trailing decimal zeros
// trimmed. Returns null for anything that isn't a metric designation.
export function metricThreadKey(s) {
  const m = String(s || '').trim().match(/^m\s*(\d+(?:\.\d+)?)\s*(?:[x×*-]\s*(\d*\.?\d+))?/i);
  if (!m) return null;
  const trim = (n) => String(parseFloat(n));
  return m[2] ? `m${trim(m[1])}x${trim(m[2])}` : `m${trim(m[1])}`;
}

// Match a metric designation to its entry in METRIC_THREAD_SIZES.
// ⚠️ A designation with NO pitch ("M6 Tap" on a spec sheet) means ISO metric
// COARSE — that is what the omission conveys, not "unknown". METRIC_THREAD_SIZES
// is ordered coarse-first per diameter, so the first entry with that diameter is
// the coarse one. The trailing 'x' in the prefix is what keeps M1 from matching
// M12.
function findMetricThread(cleaned, list) {
  const key = metricThreadKey(cleaned);
  if (!key) return null;
  const exact = list.find(x => metricThreadKey(x) === key);
  if (exact) return exact;
  if (key.includes('x')) return null;
  return list.find(x => (metricThreadKey(x) || '').startsWith(`${key}x`)) || null;
}

// Resolve a raw ProShop "Thread" value to our internal thread fields. ProShop
// stores the bare designation ("5/16-24") with no UN-series suffix, and encodes
// STI/Helicoil taps by appending "STI" to the same field ("5/16-24 STI"). This
// maps that to our canonical "5/16-24 UNF", flags STI, and detects inch vs metric.
//   → { pitch, is_sti, thread_unit }   (thread_unit: 'inch' | 'metric' | '')
export function resolveThreadSize(raw) {
  const s0 = (raw || '').trim();
  if (!s0) return { pitch: '', is_sti: false, thread_unit: '' };

  // STI / Helicoil is carried as a token in the same field — pull it out and
  // resolve against the PARENT thread (the oversized tap size is not stored).
  const is_sti = /\bsti\b/i.test(s0) || /\bhelicoil\b/i.test(s0);
  const cleaned = s0.replace(/\bsti\b/ig, '').replace(/\bhelicoil\b/ig, '').replace(/\s+/g, ' ').trim();

  const metric = /^m\s*\d/i.test(cleaned);
  const thread_unit = metric ? 'metric' : 'inch';
  const list = (metric ? METRIC_THREAD_SIZES : INCH_THREAD_SIZES).filter(x => x !== 'Custom...');

  const canonical = metric
    ? findMetricThread(cleaned, list)
    : list.find(x => threadKey(x) === threadKey(cleaned));
  return { pitch: canonical || cleaned, is_sti, thread_unit };
}

// Which thread list a tool uses. The stored `tap_thread_unit` wins; when it was
// never set, DERIVE it from the designation rather than defaulting to inch.
// ⚠️ A record can legitimately carry a metric `pitch` with no unit — a ProShop
// import that only filled the pitch, an extraction before the unit was wired, a
// hand-entered tool. Defaulting those to inch showed the INCH size list, so a
// perfectly good "M6 x 1.0" wasn't in it and read as a hand-typed custom thread.
// Read-time derivation, not a migration: nothing is written, and an explicit
// stored value always wins.
export function threadUnitOf(tool) {
  const stored = tool?.tap_thread_unit;
  if (stored === 'metric' || stored === 'inch') return stored;
  return /^m\s*\d/i.test(String(tool?.pitch || '').trim()) ? 'metric' : 'inch';
}

// Tap LIMIT TOLERANCE ("tap_class") option lists — H1-H6 / 4H-7G are pitch-diameter
// limit tolerances (how loose/tight the thread is cut), set by the tap manufacturer.
// H3 / 6H are the standard/most-common defaults for inch and metric machine taps.
// This is DISTINCT from "class of fit" (1B/2B/3B below) — that's an assembly-level
// spec for how the tapped hole mates with its mating part, not a tap-grinding spec.
export const TAP_LIMIT_TOLERANCE_OPTIONS_INCH = ['H1', 'H2', 'H3', 'H4', 'H5', 'H6'];
export const TAP_LIMIT_TOLERANCE_DEFAULT_INCH = 'H3'; // most common — standard machine tap
export const TAP_LIMIT_TOLERANCE_OPTIONS_METRIC = ['4H', '5H', '6H', '7H', '6G', '7G'];
export const TAP_LIMIT_TOLERANCE_DEFAULT_METRIC = '6H'; // standard

// Class of fit ("class_of_fit") — internal-thread fit grade (1B loosest … 3B tightest).
// Distinct from tap limit tolerance above; tracked nowhere else (not ProShop, not
// Fusion) — purely a manually-entered reference field. 2B is the general-purpose default.
// TODO: no auto-derivation — per spec, the 2B/3B selection formula isn't understood yet.
export const CLASS_OF_FIT_OPTIONS = ['1B', '2B', '3B'];
export const CLASS_OF_FIT_DEFAULT = '2B';
