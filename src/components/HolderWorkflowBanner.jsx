// ─── The holder workflow, stated once on the page ───────────────────────────
//
// WHY THIS EXISTS. The holder system has an ORDER, and getting it wrong is
// quietly expensive: refine a holder in Fusion first and the app can no longer
// tell which record it is (the segments moved but our ID is still on it — a
// `ref-only` half-match), so instead of following the change everywhere it
// stops and asks. Doing the same edit here first costs nothing and lands
// everywhere. That's not obvious from the buttons, so it's said out loud.
//
// Deliberately NOT a progress tracker: the steps aren't all one-time, several
// are optional, and a checklist that can't be completed becomes a nag. This is
// a reference card — shown by default, dismissed for good, brought back from
// the ⓘ button.

import { X, Info, ArrowRight } from 'lucide-react';

export const HOLDER_WORKFLOW_KEY = 'holder_workflow_dismissed';

export const holderWorkflowDismissed = () => {
  try { return localStorage.getItem(HOLDER_WORKFLOW_KEY) === '1'; } catch { return false; }
};
export const dismissHolderWorkflow = (yes = true) => {
  try {
    if (yes) localStorage.setItem(HOLDER_WORKFLOW_KEY, '1');
    else localStorage.removeItem(HOLDER_WORKFLOW_KEY);
  } catch { /* private mode — the banner just reappears next load */ }
};

const SETUP = [
  ['Import from Fusion', 'Brings the existing Fusion holders in as app records — and stamps each new record’s ID straight back into Fusion, so the link is live immediately. Nothing else about those holders changes.'],
  ['Normalize names', 'Reads taper, collet, length and extension out of each description.'],
  ['Duplicates', 'Merge holders that are the same physical thing entered twice.'],
  ['Link tools to holders', 'Works out which record each tool’s frozen holder copy is, and corrects the ones Fusion has wrong.'],
];

const ONGOING = [
  ['Edit the holder here', 'Change geometry, name, vendor — anything.'],
  ['Re-stamp', 'Pushes the correction into every tool that uses it. Shows what moves before it writes.'],
  ['Push to Fusion', 'Updates the holder library itself.'],
  ['Retire', 'Moves a holder to the archive and deletes Fusion’s copy on the next push. Its geometry is kept — restore it later as a new holder.'],
];

export default function HolderWorkflowBanner({ onDismiss }) {
  return (
    <div className="holder-workflow">
      <div className="holder-workflow-head">
        <Info size={14} />
        <b>How the holder library works</b>
        <button className="icon-btn" onClick={onDismiss} title="Hide this — the ⓘ button brings it back">
          <X size={14} />
        </button>
      </div>

      {/* The one thing that actually costs you if you get it wrong. */}
      <div className="holder-workflow-rule">
        <b>Change a holder here, not in Fusion.</b> Edits made here follow through to every tool
        that uses the holder. Redraw it in Fusion first and the app can’t tell it’s still the same
        holder — the shape moved while our ID stayed put — so it stops and asks instead of
        following the change. If you did build it in Fusion first: <b>Import</b> it, then
        use <b>Duplicates</b> to merge it onto the existing record.
      </div>

      <div className="holder-workflow-cols">
        <div>
          <div className="holder-workflow-label">Setting up (once)</div>
          {/* Says where this sits in the shop's overall onboarding, so it isn't
              a separate workflow you have to know to come and find. */}
          <div className="text-sub" style={{ fontSize: 11, marginBottom: 6 }}>
            This is the <b>Set up the holder library</b> step of Settings → Setup &amp; Import.
            Do it after the tool library is normalized; before or after ProShop is fine.
          </div>
          <ol className="holder-workflow-steps">
            {SETUP.map(([name, why]) => (
              <li key={name}><b>{name}</b> — {why}</li>
            ))}
          </ol>
        </div>
        <div>
          <div className="holder-workflow-label">Changing a holder (any time)</div>
          <ol className="holder-workflow-steps">
            {ONGOING.map(([name, why]) => (
              <li key={name}><b>{name}</b> — {why}</li>
            ))}
          </ol>
          <div className="holder-workflow-foot">
            <ArrowRight size={12} />
            A tool also picks up its holder’s current geometry whenever you save that tool —
            Re-stamp is just “do it now, for all of them”.
          </div>
        </div>
      </div>
    </div>
  );
}
