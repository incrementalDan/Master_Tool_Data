import React from 'react';
import { ToolTypeIcon } from './ToolTypeIcon.jsx';
import { DataBadge } from './DataBadge.jsx';

// ToolDex — ToolCard
// The core library object. Grid (default) and list variants. Composes
// ToolTypeIcon + DataBadge + meta badges. Quick-actions slot reveals on hover.

function fmt(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = parseFloat(v);
  return isNaN(n) ? v : n.toFixed(4).replace(/\.?0+$/, '');
}

export function ToolCard({ tool = {}, variant = 'grid', onOpen, actions }) {
  const {
    tool_type, type, description, location, proshop_id,
    machine_tool_number, diameter, number_of_flutes, flute_length,
    vendor, coating, preferred_machine, unit = 'in',
  } = tool;
  const ttype = tool_type || type || 'flat end mill';
  const label = (ttype || '').replace(/\b\w/g, c => c.toUpperCase());
  const hasMachine = machine_tool_number !== null && machine_tool_number !== undefined && machine_tool_number !== '';

  const typeRow = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0, flexWrap: 'wrap' }}>
      <span className="tool-card-type">{label}</span>
      {location && <DataBadge kind="location" title="Location" style={{ fontSize: 10, padding: '1px 6px' }}>{location}</DataBadge>}
      {proshop_id && <DataBadge kind="proshop" title="ProShop ID" style={{ fontSize: 10, padding: '1px 7px' }}>{proshop_id}</DataBadge>}
    </div>
  );

  const badges = (
    <div className="tool-card-meta">
      {hasMachine && <DataBadge kind="machine" title="Machine Tool #">{String(machine_tool_number)}</DataBadge>}
      {fmt(diameter) && <span className="meta-badge"><span className="dia">⌀</span> {fmt(diameter)} {unit}</span>}
      {number_of_flutes && <span className="meta-badge">{number_of_flutes}FL</span>}
      {fmt(flute_length) && <span className="meta-badge">{fmt(flute_length)}LOC</span>}
      {vendor && <span className="meta-badge truncate" style={{ maxWidth: 120 }}>{vendor}</span>}
      {coating && <span className="meta-badge">{coating}</span>}
      {preferred_machine && <span className="meta-badge meta-badge-blue">{preferred_machine}</span>}
    </div>
  );

  if (variant === 'list') {
    return (
      <div className="tool-row" onClick={onOpen}>
        <span className="tool-row-icon"><ToolTypeIcon type={ttype} size={24} /></span>
        <div className="tool-row-main">
          <span className="tool-row-title description-badge truncate" style={{ display: 'inline-block', fontSize: 13 }}>{description || '—'}</span>
          {typeRow}
        </div>
        {badges}
        {actions}
      </div>
    );
  }

  return (
    <div className="tool-card" onClick={onOpen}>
      <div className="tool-card-header">
        <span className="tool-card-icon"><ToolTypeIcon type={ttype} size={28} /></span>
        {typeRow}
        {actions}
      </div>
      <div className="tool-card-desc description-badge">{description || '—'}</div>
      {badges}
    </div>
  );
}
