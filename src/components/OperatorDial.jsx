import { useRef, useState } from 'react';

// Drum order is a period-3 loop: ≤ → = → ≥ → ≤ … (defaults to '=').
const SEQUENCE = ['<=', '=', '>='];
export const OP_SYMBOLS = { '<=': '≤', '=': '=', '>=': '≥' };

const SLOT = 18; // px — each neighbor's center sits exactly on a dial edge, half-clipped by overflow:hidden
const SETTLED = 'transform 120ms ease-out';

function indexOf(value) {
  const i = SEQUENCE.indexOf(value);
  return i === -1 ? SEQUENCE.indexOf('=') : i;
}

// Small horizontal "drum" that loops through the three comparison operators.
// Single click anywhere on the dial advances forward: = → ≥ → ≤ → = …
export default function OperatorDial({ value, onChange }) {
  const idx = indexOf(value);
  const [roll, setRoll] = useState(null); // { idx, offset, settle } while a roll is animating
  const busyRef = useRef(false);

  const advance = (dir) => {
    if (busyRef.current) return;
    busyRef.current = true;
    const nextIdx = (idx + (dir === 'right' ? 1 : SEQUENCE.length - 1)) % SEQUENCE.length;
    const offset = dir === 'right' ? SLOT : -SLOT;
    onChange(SEQUENCE[nextIdx]);
    // Render the new arrangement pre-shifted by one slot (so it overlaps the old
    // one with no transition), then settle it back to 0 on the next frame — the
    // browser animates that settle, producing a seamless continuous drum roll.
    setRoll({ idx: nextIdx, offset, settle: false });
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setRoll(r => (r ? { ...r, settle: true } : r)));
    });
  };

  const finishRoll = () => {
    busyRef.current = false;
    setRoll(null);
  };

  const shownIdx = roll ? roll.idx : idx;
  const offset = roll ? (roll.settle ? 0 : roll.offset) : 0;
  const transition = roll && !roll.settle ? 'none' : SETTLED;
  const n = SEQUENCE.length;

  const slots = [
    { i: (shownIdx + n - 1) % n, kind: 'faded' },
    { i: shownIdx, kind: 'active' },
    { i: (shownIdx + 1) % n, kind: 'faded' },
  ];

  return (
    <div className="operator-dial" style={{ borderRadius: 'var(--radius-sm) 0 0 var(--radius-sm)' }}>
      <div className="operator-dial-track" onTransitionEnd={finishRoll}>
        {slots.map((slot, pos) => (
          <span
            key={pos}
            className={`operator-dial-symbol operator-dial-${slot.kind}`}
            style={{ left: pos * SLOT - SLOT / 2, transform: `translateX(${offset}px)`, transition }}
          >
            {OP_SYMBOLS[SEQUENCE[slot.i]]}
          </span>
        ))}
      </div>
      <button
        type="button"
        className="operator-dial-zone"
        onClick={() => advance('right')}
        aria-label="Cycle comparison operator"
      />
    </div>
  );
}
