// What the user actually changed while the page was in edit mode.
//
// ⚠️ THE PAGE SAVES THE EDIT, NOT THE DRAFT. The draft is a snapshot taken when
// Edit was pressed, and every other panel on the tool page (presets,
// assemblies, purchasing, location, photos) still saves on its own while edit
// mode is open. Writing the whole draft would therefore push a stale copy of
// THOSE over whatever they wrote in the meantime — a preset saved at 10:01
// silently reverted by a geometry save at 10:02.
//
// So: diff the draft against the snapshot to get the user's own changes, and
// apply that patch to the CURRENT record. A three-way merge, the same shape the
// Fusion merge uses, and the reason the independent panels can stay live.
export function editedPatch(base, draft) {
  const patch = {};
  for (const key of Object.keys(draft || {})) {
    // Runtime-only flags (_drift, _instancesRaw, …) are never persisted.
    if (key.startsWith('_')) continue;
    const a = JSON.stringify(base?.[key] ?? null);
    const b = JSON.stringify(draft[key] ?? null);
    if (a !== b) patch[key] = draft[key];
  }
  return patch;
}
