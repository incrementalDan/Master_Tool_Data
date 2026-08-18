// ID-system membership — pure helpers (no React).
//
// Each tool is a MEMBER of the three shop identification systems (Tool ID,
// Machine Number, Location) by default. A bulk action (Assign IDs / Re-number /
// Renumber machine #s / normalize a Location system) processes every member,
// including no-Fusion (metadata-only) tools — a tool is skipped ONLY when it's
// been EXPLICITLY excluded from that specific system. Exclusion is per-tool,
// per-system, reversible, and stored in metadata (`id_system_exclusions`), so a
// tool never silently falls out of a system just because it isn't in Fusion.
//
// This module is the single source of truth for the system list + the
// membership checks; the bulk ops and the Settings review UI both read it.

export const ID_SYSTEMS = [
  { key: 'tool_id', label: 'Tool ID' },
  { key: 'machine_number', label: 'Machine Number' },
  { key: 'location', label: 'Location' },
];

export const ID_SYSTEM_KEYS = ID_SYSTEMS.map(s => s.key);

// Tool types whose MACHINE tool number is locked and must never be
// auto-assigned or reassigned by any bulk op. A probe (CMM stylus) is pinned to
// its number (T99 by default) — the machine calls the probe at a fixed T#, so
// renumber / fix-duplicates / import-assign must all leave it alone and no other
// tool may be handed that number (99 stays in the reserved `skip` list, which
// holds it free for the probe). This is a TYPE lock on top of the per-tool
// explicit exclusion flag; a future Settings control can make the probe's number
// configurable, at which point this stays the "don't touch it" guarantee.
export const MACHINE_NUMBER_LOCKED_TYPES = new Set(['probe']);

export function idSystemLabel(key) {
  return ID_SYSTEMS.find(s => s.key === key)?.label || key;
}

// A fresh, all-included exclusion map (the default for every tool).
export function emptyExclusions() {
  return { tool_id: false, machine_number: false, location: false };
}

// Is this tool excluded from the given system? Default (no flag) = included, so
// a tool is only skipped when a bulk action / the user set it — EXCEPT that a
// machine-number-locked type (a probe) is always excluded from the Machine
// Number system by type, regardless of the flag, so its T# can never be
// renumbered/reassigned. Tool ID and Location are NOT auto-excluded — a probe
// has a real Tool ID and a real location.
export function isExcludedFrom(tool, systemKey) {
  if (systemKey === 'machine_number' && MACHINE_NUMBER_LOCKED_TYPES.has(tool?.tool_type)) return true;
  return !!tool?.id_system_exclusions?.[systemKey];
}

// The tools currently excluded from a given system — used by the Settings review
// panel and by the pre-op confirmation to show exactly what will be skipped.
export function excludedTools(tools, systemKey) {
  return (tools || []).filter(t => isExcludedFrom(t, systemKey));
}

// Return a NEW exclusion map for a tool with one system flipped. Callers persist
// it on the tool (`{ ...tool, id_system_exclusions: setToolExclusion(...) }`).
export function setToolExclusion(tool, systemKey, excluded) {
  return { ...emptyExclusions(), ...(tool?.id_system_exclusions || {}), [systemKey]: !!excluded };
}
