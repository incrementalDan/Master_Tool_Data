// The geometry chain is `flute ≤ shoulder ≤ min_ooh ≤ OAL` — every link is ≤,
// so EQUAL is legal at each step. These lock the tolerance, because a bare `>`
// on floats turns "the same" into a violation whose own message rounds the two
// numbers to the same string.
import { describe, it, expect } from 'vitest';
import { validateGeometry } from './toolFactory.js';

const chainWarning = (t) =>
  validateGeometry(t).filter(w => w.fields.includes('flute_length'));

describe('validateGeometry — flute vs shoulder', () => {
  // A slot/key cutter's unbroken shoulder IS its kerf, so `normalizeLibrary`
  // sets shoulder = flute length for this type. The two being identical is the
  // normal, correct state for the whole type — it must never warn.
  it('accepts flute length equal to shoulder length', () => {
    expect(chainWarning({
      tool_type: 'slot/key cutter', unit: 'inches',
      flute_length: 0.125, shoulder_length: 0.125,
    })).toHaveLength(0);
  });

  // The case that made this fire in practice: a Fusion float round-trip leaves
  // one of two "equal" values a hair larger. The warning text rounds to 4
  // decimals, so it read "Flute Length (0.125) must be less than or equal to
  // Shoulder Length (0.125)".
  it('accepts float noise between two equal lengths', () => {
    expect(chainWarning({
      tool_type: 'slot/key cutter', unit: 'inches',
      flute_length: 0.12500000000000003, shoulder_length: 0.125,
    })).toHaveLength(0);
  });

  it('still warns when the flute length is genuinely bigger', () => {
    expect(chainWarning({
      tool_type: 'slot/key cutter', unit: 'inches',
      flute_length: 0.25, shoulder_length: 0.125,
    })).toHaveLength(1);
  });

  // The tolerance is unit-aware — an inch-sized epsilon would be 25× too loose
  // on a millimetre tool.
  it('warns on a real millimetre difference', () => {
    expect(chainWarning({
      tool_type: 'slot/key cutter', unit: 'millimeters',
      flute_length: 3.2, shoulder_length: 3.0,
    })).toHaveLength(1);
  });
});
