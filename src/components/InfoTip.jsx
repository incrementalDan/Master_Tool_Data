import { HelpCircle } from 'lucide-react';

// Small "ⓘ" hover affordance for explaining non-obvious UI — workflow quirks,
// external-system behavior (Drive, Fusion, ProShop), terminology, etc. Reveals
// `text` on hover via the `.info-tip` CSS (HelpCircle icon + absolute tooltip).
// Pass `alignRight` when the tip sits near the right edge of its container.
export default function InfoTip({ text, alignRight = false }) {
  return (
    <span className={`info-tip${alignRight ? ' tip-right' : ''}`} data-tip={text}>
      <HelpCircle size={11} />
    </span>
  );
}
