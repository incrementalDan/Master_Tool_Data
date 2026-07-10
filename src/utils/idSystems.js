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

export function idSystemLabel(key) {
  return ID_SYSTEMS.find(s => s.key === key)?.label || key;
}

// A fresh, all-included exclusion map (the default for every tool).
export function emptyExclusions() {
  return { tool_id: false, machine_number: false, location: false };
}

// Is this tool explicitly excluded from the given system? Default (no flag) =
// included, so a tool is only skipped when a bulk action / the user set it.
export function isExcludedFrom(tool, systemKey) {
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
