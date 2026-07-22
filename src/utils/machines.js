// Preferred-machine foreign key (store the id, render the name).
//
// A tool's "preferred machine" links to shop_settings.machines[] by its STABLE
// id (`preferred_machine_id`), not by the mutable model name — so renaming a
// machine in Settings doesn't orphan the tools pointing at it. The display
// string (`preferred_machine`, shown on the card + searched) is DERIVED from the
// id against the live machine list. Mirrors the CAM-preset / vendor-registry
// foreign keys and how programs cache a machine_label from machine_id. Legacy
// free-text values ("M300", "Haas") with no matching machine keep resolving by
// name (id null), exactly like the other FK fallbacks.

// Find a machine by its stable id (null when absent/dangling).
export function machineById(id, machines) {
  if (!id) return null;
  return (machines || []).find(m => m.id === id) || null;
}

// The machine id a free-text preferred-machine string refers to: an exact model
// match first (case-insensitive), then a loose contains match either way
// ("M300" ~ "Brother Speedio M300X3"). Null when nothing matches — genuinely
// free text. Mirrors camPresetIdForQuery / registryIdForName.
export function preferredMachineIdForName(name, machines) {
  const n = String(name || '').trim().toLowerCase();
  if (!n || !machines?.length) return null;
  const exact = machines.find(m => String(m.model || '').trim().toLowerCase() === n);
  if (exact) return exact.id;
  const partial = machines.find(m => {
    const model = String(m.model || '').trim().toLowerCase();
    return model && (model.includes(n) || n.includes(model));
  });
  return partial ? partial.id : null;
}

// Refresh a tool's `preferred_machine` display string from its
// `preferred_machine_id` — the id is the source of truth, the name is derived.
// Also adopts the id from a name-matched string (so existing name-only values
// become rename-proof) and tolerates a dangling id (keeps the stored string).
// Returns the tool unchanged when it has no id AND no name match.
export function syncPreferredMachine(tool, machines) {
  if (!tool) return tool;
  const id = tool.preferred_machine_id || preferredMachineIdForName(tool.preferred_machine, machines);
  if (!id) return tool;
  const m = machineById(id, machines);
  if (!m) return tool;                        // dangling id — keep the stored string
  if (tool.preferred_machine_id === id && tool.preferred_machine === m.model) return tool;
  return { ...tool, preferred_machine_id: id, preferred_machine: m.model };
}

// The display name for a tool's preferred machine, resolved live from the id
// (falls back to the stored free-text string). Use this at render for an
// immediate rename without a reload.
export function preferredMachineName(tool, machines) {
  const m = machineById(tool?.preferred_machine_id, machines);
  return m ? m.model : (tool?.preferred_machine || '');
}

// Walk a tool list and sync every preferred_machine name from its FK id — the
// load-time backfill (mirrors backfillMaterialPresetIds / backfillAsmNumbers;
// persisted lazily on each tool's next save).
export function backfillPreferredMachineIds(tools, machines) {
  if (!machines?.length) return tools;
  return (tools || []).map(t => syncPreferredMachine(t, machines));
}
