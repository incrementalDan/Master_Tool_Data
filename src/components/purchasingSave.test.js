import { describe, it, expect, vi } from 'vitest';
import { commitPurchasing } from './PurchasingSection.jsx';

// The panel renders `tool.purchasing` — the PROP — in view mode, and the prop is
// still the PRE-save tool for the whole duration of the write. So leaving edit
// mode before the save resolves makes the rows the user just typed disappear off
// the screen while the save is in flight (a Fusion round-trip re-uploads the
// whole library — seconds, not a frame), and takes the "Saving…" button with it.
// The ordering is the whole fix and is invisible in a rendered snapshot.
const tool = { id: 'FTL-1', purchasing: { manufacturers: [], vendors: [] } };
const typed = {
  manufacturers: [{ id: 'm1', name: 'Helical Solutions', edp: '12334', order: 0 }],
  vendors: [{ id: 'v1', manufacturer_id: 'm1', name: 'MSC Industrial', vendor_num: '99377473', price: 34.76, order: 0 }],
};

function spies() {
  return { setData: vi.fn(), setEditing: vi.fn(), setSaving: vi.fn() };
}

describe('committing purchasing from the tool page', () => {
  it('stays in edit mode until the save resolves', async () => {
    const s = spies();
    let release;
    const onSave = vi.fn(() => new Promise(r => { release = r; }));
    const p = commitPurchasing({ data: typed, tool, onSave, ...s });

    // Mid-flight: the save has been issued and the editor is still up.
    await Promise.resolve();
    expect(onSave).toHaveBeenCalledOnce();
    expect(s.setSaving).toHaveBeenCalledWith(true);
    expect(s.setEditing).not.toHaveBeenCalled();

    release();
    await p;
    expect(s.setEditing).toHaveBeenCalledWith(false);
    expect(s.setSaving).toHaveBeenLastCalledWith(false);
  });

  it('sends the tool with the normalized purchasing attached', async () => {
    const s = spies();
    const onSave = vi.fn(async () => {});
    await commitPurchasing({ data: typed, tool, onSave, ...s });
    const sent = onSave.mock.calls[0][0];
    expect(sent.id).toBe('FTL-1');
    expect(sent.purchasing.manufacturers.map(m => m.name)).toEqual(['Helical Solutions']);
    expect(sent.purchasing.vendors.map(v => v.name)).toEqual(['MSC Industrial']);
    // The buffer holds the same normalized object the save was given, so
    // dropping to view mode afterwards shows exactly what was written.
    expect(s.setData).toHaveBeenCalledWith(sent.purchasing);
  });

  // ⚠️ A failed save used to close the editor anyway — the panel was already
  // showing the old value and the draft was gone with it.
  it('keeps the editor open, with the data intact, when the save fails', async () => {
    const s = spies();
    const onSave = vi.fn(async () => { throw new Error('Fusion upload failed'); });
    const ok = await commitPurchasing({ data: typed, tool, onSave, ...s });
    expect(ok).toBe(false);
    expect(s.setEditing).not.toHaveBeenCalled();
    expect(s.setSaving).toHaveBeenLastCalledWith(false);   // and the button recovers
  });

  it('reports success so a caller can tell the two apart', async () => {
    const s = spies();
    expect(await commitPurchasing({ data: typed, tool, onSave: async () => {}, ...s })).toBe(true);
  });
});
