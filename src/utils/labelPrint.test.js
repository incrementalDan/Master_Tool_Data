import { describe, it, expect, vi, afterEach } from 'vitest';
import { printToolTags, openTagWindow } from './labelPrint.js';

// A stand-in for the popup: enough of the window/document surface for
// printToolTags to write into, so the pre-opened-window path can be exercised
// without a real browser.
function fakeWin() {
  const doc = {
    readyState: 'complete',
    open: vi.fn(), close: vi.fn(), write: vi.fn(),
    querySelectorAll: () => [],
  };
  return {
    document: doc,
    focus: vi.fn(),
    print: vi.fn(),
    close: vi.fn(),
    addEventListener: vi.fn(),
    // Never actually run the callback — the fit/print step needs real layout.
    requestAnimationFrame: vi.fn(),
  };
}

const label = { t: 'T38', toolId: 'B-261' };

afterEach(() => { delete globalThis.window; });

describe('⚠️ the print window can be opened BEFORE the labels are ready', () => {
  it('writes into a window it was handed, without opening another', () => {
    // This is what makes the stale-label guard possible at all: the guard has
    // to await Drive first, and a popup opened after an await has lost the user
    // gesture and is blocked. So the click opens the window and this fills it.
    const open = vi.fn();
    globalThis.window = { open };
    const win = fakeWin();

    expect(printToolTags([label], { win })).toBe(true);
    expect(open).not.toHaveBeenCalled();
    expect(win.document.write).toHaveBeenCalledOnce();
    expect(win.document.write.mock.calls[0][0]).toContain('Tool Tags');
  });

  it('closes a handed-in window when there is nothing to print', () => {
    // Otherwise a blank tab is left open every time a print finds no rows —
    // which looks exactly like a broken print.
    globalThis.window = { open: vi.fn() };
    const win = fakeWin();
    expect(printToolTags([], { win })).toBe(false);
    expect(win.close).toHaveBeenCalledOnce();
  });

  it('still opens its own window when none is handed in', () => {
    const win = fakeWin();
    const open = vi.fn(() => win);
    globalThis.window = { open };
    expect(printToolTags([label])).toBe(true);
    expect(open).toHaveBeenCalledWith('', '_blank');
  });

  it('reports a blocked popup rather than throwing', () => {
    globalThis.window = { open: vi.fn(() => null) };
    expect(printToolTags([label])).toBe(false);
  });

  it('opens nothing at all for an empty list with no window handed in', () => {
    const open = vi.fn();
    globalThis.window = { open };
    expect(printToolTags([])).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });

  it('openTagWindow just opens a blank tab for later use', () => {
    const win = fakeWin();
    globalThis.window = { open: vi.fn(() => win) };
    expect(openTagWindow()).toBe(win);
    expect(globalThis.window.open).toHaveBeenCalledWith('', '_blank');
  });
});
