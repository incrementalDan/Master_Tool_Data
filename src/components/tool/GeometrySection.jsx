// The tool page's Geometry section — the drawing IS the geometry.
//
// ⚠️ EVERY FIELD APPEARS EXACTLY ONCE. The drawing carries the dimensions
// (profileDimensions: lengths, diameters, and the Cutter extras beside it), so
// those are subtracted from the grid below it via ToolFields' `hideFields`.
// Nothing is shown in two places, and there is no separate Geometry read-out.
//
// ⚠️ IT IS THE SAME COMPONENT THE POP-UP RENDERS (ToolProfileFields), not a
// second drawing. That is the whole reason the drawing was pulled out of the
// modal: two drawings of one tool would drift, and the print conventions in it
// — the ordinate leaders, the interrupted view, the lane stack — are not the
// sort of thing that survives being reimplemented.
//
// ⚠️ NO DRAFT AND NO SAVE OF ITS OWN. It reads and writes the PAGE's draft.
// The page has one Edit button and one Save bar (owner's call: "a mode that
// lets you edit intentionally, not a separate page"), so a section holding its
// own buffer would be a second, competing answer to "is this saved yet?".
import { useMemo } from 'react';
import { Ruler, AlertTriangle } from 'lucide-react';
import Section from './ToolSection.jsx';
import ToolFields from '../ToolFields.jsx';
import ToolProfileFields from '../ToolProfileFields.jsx';
import { canDrawProfile, profileDimensions } from '../../utils/toolProfile.js';
import { validateGeometry } from '../../schema/toolSchema.js';

export default function GeometrySection({
  data, setData, setField, editing, title = 'Geometry',
  geoIssueFields, listOptions, proposals, onResolveProposal,
}) {
  const drawable = canDrawProfile(data.tool_type);
  const owned = useMemo(() => {
    if (!drawable) return null;
    const d = profileDimensions(data.tool_type);
    return new Set([...d.lengths, ...d.diameters, ...d.extras, 'shaft_segments', 'has_undercut']);
  }, [drawable, data.tool_type]);

  // Only worth showing while editing — a warning about a tool nobody is
  // changing is a standing complaint, not an action.
  const geoIssues = useMemo(
    () => (editing ? validateGeometry(data) : []),
    [editing, data],
  );

  return (
    <Section title={title} icon={Ruler} forceOpen={(proposals?.size ?? 0) > 0}>
      {/* ⚠️ Only the two types the drawing cannot handle (boring head, turning
          general) fall through to the plain grid, with nothing hidden — so no
          field disappears for them. */}
      {drawable && <ToolProfileFields draft={data} setDraft={setData} readOnly={!editing} />}

      <ToolFields
        tool={data}
        mode={editing ? 'edit' : 'view'}
        setField={setField}
        geoIssueFields={geoIssueFields}
        listOptions={listOptions}
        proposals={proposals}
        onResolveProposal={onResolveProposal}
        hideFields={owned}
      />

      {geoIssues.length > 0 && (
        <div className="warn-banner" style={{ marginTop: 12 }}>
          {geoIssues.map((issue, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <AlertTriangle size={12} style={{ flexShrink: 0 }} />
              {issue.message}
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}
