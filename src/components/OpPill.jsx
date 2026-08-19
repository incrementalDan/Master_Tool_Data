import { formatOperation } from '../utils/parts.js';
import { opColor } from '../utils/opColors.js';

// THE op badge. Every place an operation number appears standalone renders this,
// so OP50 is the same colour on the parts list, the part page, a tool list and
// the Where-Used panel — which is the whole point: telling the ops apart at a
// glance only works if the colour means the same thing everywhere.
//
// Colour comes from the op number alone (utils/opColors.js), never from list
// position, so nothing about where it is rendered can change it.
//
// Renders NOTHING for a step with no op number. A blank pill would read as an
// operation whose number failed to load, when the truth is that some steps
// legitimately have none.
export default function OpPill({ op, title }) {
  const label = formatOperation(op);
  if (!label) return null;
  const color = opColor(op);
  return (
    <span className="op-pill" style={{ '--badge-color': color }} title={title}>
      {label}
    </span>
  );
}
