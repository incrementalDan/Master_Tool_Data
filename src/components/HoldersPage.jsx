// ─── Holders page — the app-owned holder library ────────────────────────────
// List → detail, ported from docs/HolderManager.tsx onto the app's tokens.

import { useState, useMemo, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Download, Wand2, X, ArrowLeft, Boxes, Copy, Upload, Link2, Info, ChevronDown, ChevronRight } from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import HolderPill from './HolderPill.jsx';
import HolderDetail from './HolderDetail.jsx';
import {
  holderOptions, holderOption, holderOptionLabel, newHolderOption, holderConfigOf,
} from '../schema/holderOptions.js';
import { newHolderRecord, holderRecordToFusion } from '../schema/holderRecord.js';
import { deriveGaugeLength, deriveExtensionOoh, formatHolderLen, holderLenIn, nominalLengthCheck } from '../utils/holderGeometry.js';
import { healHolderDescription, applyHealToRecord } from '../utils/holderDescription.js';
import { recordsWithBodyDivergence } from '../utils/holderBody.js';
import { proposeHolderParts, applyPartProposals, holdersWithPartDrift, holderPartsOf } from '../utils/holderParts.js';
import { findHolderDuplicates, holdersInDuplicates, applyHolderMerge, compareHolders, holderGuidsOf, toolsFollowingMerge } from '../utils/holderDuplicates.js';
import { auditFusionHolders, holdersOutOfSync } from '../schema/holderIdentity.js';
import { assemblyCountUsingHolder, assemblyUsesHolder, staleHolderTools } from '../schema/holderResolve.js';
import HolderMergeModal from './HolderMergeModal.jsx';
import RestampModal from './RestampModal.jsx';
import PushHoldersModal from './PushHoldersModal.jsx';
import LinkToolsModal from './LinkToolsModal.jsx';
import { buildHolderLinkPlan } from '../utils/holderLink.js';
import HolderWorkflowBanner, { holderWorkflowDismissed, dismissHolderWorkflow } from './HolderWorkflowBanner.jsx';
import { unitAbbr } from '../utils/units.js';

const CONF_ORDER = ['high', 'medium', 'low'];

// The length check is a per-holder ONE-TIME confirmation, so the list needs to
// show what's still outstanding — otherwise the sweep after an import has no
// worklist. Returns the check when it applies and hasn't been confirmed for the
// CURRENT values (a confirmation expires by itself when they change).
function pendingLengthCheck(h, config) {
  const family = holderOptionLabel(config, 'collet_families', h.collet_family_id);
  const n = nominalLengthCheck(h, family);
  return n && n.needsConfirmation ? n : null;
}

// ─── Healer preview → commit ────────────────────────────────────────────────
// Parses legacy free-text descriptions into structured fields. Preview only —
// nothing is written until Commit, and the DESCRIPTION IS NEVER REWRITTEN (see
// utils/holderDescription.js for why that matters).
function HealerModal({ holders, config, onCommit, onClose }) {
  const rows = useMemo(
    () => holders.map(h => ({ h, heal: healHolderDescription(h.description, config) })),
    [holders, config],
  );
  const counts = rows.reduce((a, r) => { a[r.heal.confidence] = (a[r.heal.confidence] || 0) + 1; return a; }, {});
  const highRows = rows.filter(r => r.heal.confidence === 'high');

  return (
    <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal holder-healer">
        <div className="modal-header">
          <div>
            <h3>Normalize holder names</h3>
            <p className="modal-sub">
              Parses legacy descriptions into structured fields. Preview only — nothing is written until you commit.
            </p>
          </div>
          {CONF_ORDER.map(c => counts[c] ? (
            <span key={c} className={`holder-conf ${c}`}>{counts[c]} {c}</span>
          ) : null)}
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="modal-body">
          {rows.map(({ h, heal }) => (
            <div key={h.id} className={`holder-heal-row ${heal.confidence}`}>
              <div className="holder-heal-head">
                <span className={`holder-conf ${heal.confidence}`}>{heal.confidence.toUpperCase()}</span>
                <span className="holder-heal-desc">{h.description}</span>
              </div>
              <div className="holder-heal-chips">
                {heal.matched.type_id && <span className="chip active">{holderOptionLabel(config, 'types', heal.matched.type_id)}</span>}
                {heal.matched.taper_id && <span className="chip active">{holderOptionLabel(config, 'tapers', heal.matched.taper_id)}</span>}
                {heal.matched.collet_size_id && <span className="chip active">{holderOptionLabel(config, 'collet_sizes', heal.matched.collet_size_id)}</span>}
                {heal.matched.length != null && <span className="chip active">L {heal.matched.length}</span>}
                {heal.matched.is_tap_collet && <span className="chip active">Tap collet</span>}
                {heal.matched.has_extension && (
                  <span className="chip active holder-ext-chip">
                    Ext {heal.matched.ext_collet_size_id ? holderOptionLabel(config, 'collet_sizes', heal.matched.ext_collet_size_id) : ''}
                    {heal.matched.ext_ooh_in ? ` ${heal.matched.ext_ooh_in}"` : ''}
                  </span>
                )}
              </div>
              {heal.flags.length > 0 && (
                <div className="holder-heal-flags">
                  {heal.flags.map((f, i) => <div key={i} className={`flag ${heal.confidence}`}>⚠ {f}</div>)}
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="modal-footer">
          <span className="modal-footer-note">
            ⚠ Commit fills structured fields only. Descriptions are never rewritten automatically.
          </span>
          <button className="btn btn-secondary btn-sm" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary btn-sm"
            disabled={!highRows.length}
            onClick={() => onCommit(highRows)}
          >Commit {highRows.length} high-confidence</button>
        </div>
      </div>
    </div>
  );
}

// ─── Link parts: preview → commit ───────────────────────────────────────────
// Proposes one BODY part per physical base holder and one EXTENSION part per
// distinct extension, then links every holder to them.
//
// ⚠️ It LINKS; it does not decide which geometry is right. Where a group's
// records disagree, one part is seeded from the majority (preferring a bare
// holder on a tie) and the odd ones out are listed here BEFORE you commit —
// they become a drift flag on a named holder instead of invisible duplication.
// No holder's segments are changed.
function PartsModal({ holders, config, existingParts, onCommit, onClose }) {
  const { bodies, extensions } = useMemo(() => proposeHolderParts(holders, config), [holders, config]);
  const all = [...bodies, ...extensions];
  const driftTotal = bodies.reduce((a, b) => a + b.willDrift.length, 0);

  return (
    <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal holder-healer">
        <div className="modal-header">
          <div>
            <h3>Link holders to their parts</h3>
            <p className="modal-sub">
              A taper holder and an extension are separate parts. This creates one record per part
              and links the holders to it — nothing’s geometry is changed.
            </p>
          </div>
          <span className="holder-conf high">{bodies.length} bodies</span>
          <span className="holder-conf high">{extensions.length} extensions</span>
          {driftTotal > 0 && <span className="holder-conf medium">{driftTotal} will drift</span>}
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="modal-body">
          {existingParts > 0 && (
            <div className="holder-warn" style={{ marginBottom: 10 }}>
              {existingParts} part{existingParts === 1 ? '' : 's'} already exist. Committing again would
              create duplicates — unlink or delete those first.
            </div>
          )}
          {all.map(p => (
            <div key={p.key} className={`holder-heal-row ${p.willDrift.length ? 'medium' : 'high'}`}>
              <div className="holder-heal-head">
                <span className={`holder-conf ${p.willDrift.length ? 'medium' : 'high'}`}>
                  {p.role === 'body' ? 'BODY' : 'EXTENSION'}
                </span>
                <span className="holder-heal-desc">{p.label}</span>
                <span className="holder-part-used">{p.holders.length} holder{p.holders.length === 1 ? '' : 's'}</span>
              </div>
              <div className="holder-heal-chips">
                {p.holders.map(h => (
                  <span
                    key={h.id}
                    className={`chip${p.willDrift.some(d => d.id === h.id) ? ' holder-clash-chip active' : ''}`}
                  >{h.description || h.holder_ref}</span>
                ))}
              </div>
              {p.willDrift.length > 0 && (
                <div className="holder-heal-flags">
                  <div className="flag medium">
                    ⚠ {p.willDrift.length} of these disagree about this part’s geometry — they’ll be
                    flagged as drift so you can decide which is right.
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="modal-footer">
          <span className="modal-footer-note">
            ⚠ Creates part records and links. No holder’s segments are changed.
          </span>
          <button className="btn btn-secondary btn-sm" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary btn-sm"
            disabled={!all.length || existingParts > 0}
            onClick={() => onCommit(all)}
          >Create {all.length} part{all.length === 1 ? '' : 's'}</button>
        </div>
      </div>
    </div>
  );
}

// ─── Duplicate holders ──────────────────────────────────────────────────────
// Matched on description + specs + gauge length, never segment-by-segment (the
// same priority the audit uses — two records of one physical assembly agree
// about what they are and how long they are). Nothing merges from here without
// choosing a survivor in the merge screen.
function DuplicatesModal({ holders, config, tools, onMerge, onClose }) {
  const matches = useMemo(() => findHolderDuplicates(holders, config), [holders, config]);
  return (
    <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal holder-healer">
        <div className="modal-header">
          <div>
            <h3>Possible duplicate holders</h3>
            <p className="modal-sub">
              Same specs and same gauge length — usually one holder entered twice, or a corrected
              rebuild sitting beside the original.
            </p>
          </div>
          <span className="holder-conf high">{matches.filter(m => m.verdict === 'duplicate').length} likely</span>
          {matches.some(m => m.verdict === 'possible') && (
            <span className="holder-conf medium">{matches.filter(m => m.verdict === 'possible').length} possible</span>
          )}
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body">
          {!matches.length && (
            <div className="holder-empty">
              No duplicates found. Holders that share specs but differ in gauge length are
              different stickouts of the same parts, not duplicates.
            </div>
          )}
          {matches.map((m, i) => (
            <div key={i} className={`holder-heal-row ${m.verdict === 'duplicate' ? 'high' : 'medium'}`}>
              <div className="holder-heal-head">
                <span className={`holder-conf ${m.verdict === 'duplicate' ? 'high' : 'medium'}`}>
                  {m.verdict === 'duplicate' ? 'LIKELY' : 'POSSIBLE'}
                </span>
                <HolderPill holder={m.a} config={config} compact />
                <span className="holder-dup-vs">vs</span>
                <HolderPill holder={m.b} config={config} compact />
                <span style={{ flex: 1 }} />
                <button className="btn btn-primary btn-sm" onClick={() => onMerge(m)}>Merge…</button>
              </div>
              <div className="holder-heal-flags">
                {m.reasons.map((r, k) => (
                  <div key={k} className={`flag ${r.startsWith('⚠') ? 'medium' : 'high'}`}>{r}</div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="modal-footer">
          <span className="modal-footer-note">Nothing is merged until you choose which record to keep.</span>
          <button className="btn btn-secondary btn-sm" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

function HolderList({
  holders, config, usageOf, onOpen, onNew, onHeal, onImport, onLinkParts, onDuplicates, onPush, unlinked, canPush,
  onLinkTools, unlinkedTools, showWorkflow, onShowWorkflow, onDismissWorkflow,
  importable, googleAuthenticated, driftIds, partCount, duplicateIds,
  archived, onRestore, staleTools,
}) {
  // Archived holders are hidden by default and live below the list — they are a
  // reference, not part of the library.
  const [showArchive, setShowArchive] = useState(false);
  const [q, setQ] = useState('');
  const [fType, setFType] = useState(null);
  const [fTaper, setFTaper] = useState(null);
  const [fCollet, setFCollet] = useState(null);
  const [fExt, setFExt] = useState(false);
  const [fTap, setFTap] = useState(false);
  const [fCheck, setFCheck] = useState(false);
  const [fClash, setFClash] = useState(false);
  const [fDrift, setFDrift] = useState(false);
  const [fDupe, setFDupe] = useState(false);
  // Grouping is ON by default — with 20+ holders across several tapers a flat
  // alphabetical list stops being useful fast. Sorting by a column is the
  // escape hatch, so picking a sort AUTO-UNGROUPS: grouped-and-sorted at the
  // same time answers neither question clearly.
  const [grouped, setGrouped] = useState(true);
  const [sortCol, setSortCol] = useState(null);
  const [sortDir, setSortDir] = useState('asc');

  const toggleSort = (col) => {
    if (sortCol === col) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortCol(col); setSortDir('asc'); setGrouped(false); }
  };
  const enableGrouping = (on) => { setGrouped(on); if (on) setSortCol(null); };

  const pendingCount = useMemo(() => holders.filter(h => pendingLengthCheck(h, config)).length, [holders, config]);
  // Records whose base body disagrees with another record of the same holder.
  // Declared BEFORE `visible` — the filter reads it.
  const clashIds = useMemo(() => recordsWithBodyDivergence(holders, config), [holders, config]);

  const visible = useMemo(() => holders.filter(h => {
    if (fType && h.type_id !== fType) return false;
    if (fTaper && h.taper_id !== fTaper) return false;
    if (fCollet && h.collet_size_id !== fCollet) return false;
    if (fExt && !h.has_extension) return false;
    if (fTap && !h.is_tap_collet) return false;
    if (fCheck && !pendingLengthCheck(h, config)) return false;
    if (fClash && !clashIds.has(h.id)) return false;
    if (fDrift && !driftIds.has(h.id)) return false;
    if (fDupe && !duplicateIds.has(h.id)) return false;
    if (q) {
      const hay = [h.description, h.vendor, h.manufacturer, h.part_number, h.notes, h.location, ...(h.legacy_ids || [])]
        .join(' ').toLowerCase();
      if (!hay.includes(q.toLowerCase())) return false;
    }
    return true;
  }), [holders, q, fType, fTaper, fCollet, fExt, fTap, fCheck, fClash, fDrift, fDupe, clashIds, driftIds, duplicateIds, config]);

  const usedIds = (key) => [...new Set(holders.map(h => h[key]).filter(Boolean))];

  // Gauge and Ext OOH compare as NUMBERS in one common unit, not as the
  // formatted strings in the cells — an mm-native and an inch-native holder in
  // the same list would otherwise sort nonsensically against each other.
  // Nulls always sink, in both directions, so "no value" never reads as
  // smallest.
  const sortValue = (h, col) => {
    switch (col) {
      case 'description': return (h.description || '').toLowerCase();
      case 'type': return (holderOptionLabel(config, 'types', h.type_id) || '').toLowerCase();
      case 'taper': return (holderOptionLabel(config, 'tapers', h.taper_id) || '').toLowerCase();
      case 'collet': return (holderOptionLabel(config, 'collet_sizes', h.collet_size_id) || '').toLowerCase();
      case 'extOoh': { const v = deriveExtensionOoh(h.segments); return v == null ? null : holderLenIn(v, h.unit); }
      case 'gauge': return holderLenIn(deriveGaugeLength(h.segments), h.unit);
      case 'location': return (h.location || '').toLowerCase();
      case 'tools': return usageOf(h);
      default: return '';
    }
  };
  const compare = (a, b, col, dir) => {
    const av = sortValue(a, col); const bv = sortValue(b, col);
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    const r = typeof av === 'number' ? av - bv : String(av).localeCompare(String(bv));
    return dir === 'asc' ? r : -r;
  };

  // Group key: taper → collet size → extension collet. That's how the shop
  // reaches for a holder: which spindle, then which collet, then which
  // extension.
  const groupKeyOf = (h) => [
    h.taper_id || '~none', h.collet_size_id || '~none',
    h.has_extension ? (h.extension?.collet_size_id || '~ext') : '',
  ].join('|');
  const groupLabelOf = (h) => {
    const parts = [
      holderOptionLabel(config, 'tapers', h.taper_id) || 'No taper',
      holderOptionLabel(config, 'collet_sizes', h.collet_size_id) || 'No collet',
    ];
    if (h.has_extension) parts.push(`+ ${holderOptionLabel(config, 'collet_sizes', h.extension?.collet_size_id) || 'extension'}`);
    return parts.join(' · ');
  };

  const rows = useMemo(() => {
    if (!grouped) {
      const list = [...visible];
      if (sortCol) list.sort((a, b) => compare(a, b, sortCol, sortDir));
      return list.map(h => ({ kind: 'row', h }));
    }
    const groups = new Map();
    visible.forEach(h => {
      const k = groupKeyOf(h);
      if (!groups.has(k)) groups.set(k, { label: groupLabelOf(h), items: [] });
      groups.get(k).items.push(h);
    });
    const out = [];
    [...groups.entries()]
      .sort((a, b) => a[1].label.localeCompare(b[1].label))
      .forEach(([k, g]) => {
        // Within a group, always smallest gauge first regardless of sortDir.
        g.items.sort((a, b) => holderLenIn(deriveGaugeLength(a.segments), a.unit) - holderLenIn(deriveGaugeLength(b.segments), b.unit));
        out.push({ kind: 'group', key: k, label: g.label, count: g.items.length });
        g.items.forEach(h => out.push({ kind: 'row', h }));
      });
    return out;
  }, [visible, grouped, sortCol, sortDir, config]);

  const COLS = [
    { key: 'description', label: 'Description' },
    { key: 'type', label: 'Type' },
    { key: 'taper', label: 'Taper' },
    { key: 'collet', label: 'Collet' },
    { key: 'extOoh', label: 'Ext OOH' },
    { key: 'gauge', label: 'Gauge' },
    { key: 'location', label: 'Location' },
    { key: 'tools', label: 'Tools', right: true },
  ];

  return (
    <div>
      <div className="holder-page-head">
        <div>
          <h2>Holders</h2>
          <div className="holder-page-sub">
            {holders.length} holder{holders.length === 1 ? '' : 's'} · app-owned
          </div>
        </div>
        <div className="holder-page-actions">
          {!showWorkflow && (
            <button className="icon-btn" onClick={onShowWorkflow}
              title="Show how the holder library works">
              <Info size={16} />
            </button>
          )}
          {importable > 0 && (
            <button className="btn btn-secondary btn-sm" onClick={onImport} title="Create app records from the linked Fusion holder library">
              <Download size={14} /> Import {importable} from Fusion
            </button>
          )}
          {/* The two-way link isn't real until our IDs are in Fusion — until
              then a holder matches on shape alone, which isn't enough to act
              on. Badged with how many are still one signal short. */}
          <button className="btn btn-secondary btn-sm" onClick={onPush}
            disabled={!holders.length || !googleAuthenticated || !canPush}
            title={canPush
              ? (unlinked
                ? `${unlinked} holder record${unlinked === 1 ? '' : 's'} Fusion doesn't have yet — until you push, that work only exists in this app`
                : "Fusion already has every holder record's ID and geometry")
              : 'Link a Fusion holder library in Settings first — there is nowhere to push to'}>
            <Upload size={14} /> {unlinked ? `Push to Fusion (${unlinked})` : 'Push to Fusion'}
          </button>
          {/* The migration pass: work out which record each tool's baked
              holder copy is. Badged with how many assemblies still have no
              link — the whole point is to get that to zero. */}
          {unlinkedTools > 0 && (
            <button className="btn btn-secondary btn-sm" onClick={onLinkTools} disabled={!googleAuthenticated}
              title="Match every tool's frozen holder copy to a holder record and store the link">
              <Link2 size={14} /> Link {unlinkedTools} tool{unlinkedTools === 1 ? '' : 's'}
            </button>
          )}
          <button className="btn btn-secondary btn-sm" onClick={onDuplicates} disabled={holders.length < 2}
            title="Find holders that look like the same physical holder entered twice">
            <Copy size={14} /> {duplicateIds.size ? `Duplicates (${duplicateIds.size})` : 'Duplicates'}
          </button>
          <button className="btn btn-secondary btn-sm" onClick={onLinkParts} disabled={!holders.length}
            title="Create body / extension part records and link the holders to them">
            <Boxes size={14} /> {partCount ? `Parts (${partCount})` : 'Link parts…'}
          </button>
          <button className="btn btn-secondary btn-sm" onClick={onHeal} disabled={!holders.length}>
            <Wand2 size={14} /> Normalize names…
          </button>
          <button className="btn btn-primary btn-sm" onClick={onNew} disabled={!googleAuthenticated}>
            <Plus size={14} /> New holder
          </button>
        </div>
      </div>

      {showWorkflow && <HolderWorkflowBanner onDismiss={onDismissWorkflow} />}

      {/* ⚠️ NOT dismissible, and not a mere badge on a button. Until this is
          done the app is the ONLY place the holder work exists — which is the
          one state this whole system is built to avoid (CLAUDE.md → "If Fusion
          has a place for it, Fusion must have it"). It has to be legible
          without opening anything. */}
      {canPush && unlinked > 0 && (
        <div className="holder-sync-banner">
          <Upload size={15} />
          <div>
            {/* ⚠️ NOT "N of your M records" — this count also includes holders
                being REMOVED from Fusion, which aren't in the library count at
                all, so the ratio read "20 of your 19". */}
            <b>Fusion is out of step on {unlinked} holder{unlinked === 1 ? '' : 's'}.</b>
            <div>
              Until you push, those records live only in this app — if it went away, the work
              would go with it. The first push mostly just writes each holder’s ID into Fusion’s
              product-id field; the geometry Fusion already has stays as it is. Open it to see
              exactly what changes, holder by holder, before anything is written.
            </div>
          </div>
          <button className="btn btn-primary btn-sm" onClick={onPush}>
            <Upload size={13} /> Review &amp; push
          </button>
        </div>
      )}

      {/* The other half of the same rule, pointed at the TOOLS. A corrected
          holder doesn't reach an existing tool until that tool is written, so
          without this the library quietly holds two versions of the same
          holder and nothing says which tools are on the old one. */}
      {staleTools.length > 0 && (
        <div className="holder-sync-banner holder-stale-banner">
          <Link2 size={15} />
          <div>
            <b>{staleTools.length} tool{staleTools.length === 1 ? '' : 's'} still carry an older copy of their holder.</b>
            <div>
              Fusion freezes a holder into each tool, so a correction here only reaches a tool
              when that tool is written. Open the holder and <b>Re-stamp</b> to push the current
              geometry into its tools — you’ll see each tool’s gauge-length change first.
            </div>
          </div>
        </div>
      )}

      <div className="holder-filters">
        <input
          className="field-input" value={q} onChange={e => setQ(e.target.value)}
          placeholder="Search description, vendor, part number, notes…"
        />
        <div className="holder-filter-row">
          <span className="holder-filter-label">TYPE</span>
          {usedIds('type_id').map(t => (
            <button key={t} className={`chip${fType === t ? ' active' : ''}`} onClick={() => setFType(fType === t ? null : t)}>
              {holderOptionLabel(config, 'types', t)}
            </button>
          ))}
          <span className="holder-filter-divider" />
          <span className="holder-filter-label">TAPER</span>
          {usedIds('taper_id').map(t => (
            <button key={t} className={`chip${fTaper === t ? ' active' : ''}`} onClick={() => setFTaper(fTaper === t ? null : t)}>
              {holderOptionLabel(config, 'tapers', t)}
            </button>
          ))}
        </div>
        <div className="holder-filter-row">
          <span className="holder-filter-label">COLLET</span>
          {usedIds('collet_size_id').map(c => {
            const color = holderOption(config, 'collet_sizes', c)?.color;
            return (
              <button
                key={c} className={`chip${fCollet === c ? ' active' : ''}`}
                style={color ? { '--badge-color': color } : undefined}
                onClick={() => setFCollet(fCollet === c ? null : c)}
              >{holderOptionLabel(config, 'collet_sizes', c)}</button>
            );
          })}
          <span className="holder-filter-divider" />
          <button className={`chip holder-ext-chip${fExt ? ' active' : ''}`} onClick={() => setFExt(!fExt)}>Has extension</button>
          <button className={`chip${fTap ? ' active' : ''}`} onClick={() => setFTap(!fTap)}>Tap collet</button>
          {pendingCount > 0 && (
            <button
              className={`chip holder-check-chip${fCheck ? ' active' : ''}`}
              title="Holders whose engraved length hasn't been confirmed against the modelled geometry yet"
              onClick={() => setFCheck(!fCheck)}
            >Needs length check ({pendingCount})</button>
          )}
          {clashIds.size > 0 && (
            <button
              className={`chip holder-clash-chip${fClash ? ' active' : ''}`}
              title="Records of the same physical holder whose base body geometry disagrees"
              onClick={() => setFClash(!fClash)}
            >Body mismatch ({clashIds.size})</button>
          )}
          {driftIds.size > 0 && (
            <button
              className={`chip holder-clash-chip${fDrift ? ' active' : ''}`}
              title="Holders whose geometry has drifted from the part record they point at"
              onClick={() => setFDrift(!fDrift)}
            >Part drift ({driftIds.size})</button>
          )}
          {duplicateIds.size > 0 && (
            <button
              className={`chip holder-clash-chip${fDupe ? ' active' : ''}`}
              title="Holders that look like the same physical holder entered twice"
              onClick={() => setFDupe(!fDupe)}
            >Duplicates ({duplicateIds.size})</button>
          )}
        </div>
      </div>

      {/* The toolbar sits OUTSIDE the scroll box so it stays put, and the box
          gets an explicit max-height. That height limit is what makes the
          sticky header work at all: overflow-x alone creates a scroll context
          with no vertical bound, so sticky would anchor to something that never
          scrolls vertically and appear to do nothing. */}
      <div className="holder-table-card">
        <div className="holder-table-toolbar">
          <label className={`holder-group-toggle${grouped ? ' on' : ''}`}>
            <input type="checkbox" checked={grouped} onChange={e => enableGrouping(e.target.checked)} />
            Group by taper · collet · extension
          </label>
          {grouped && <span className="holder-table-note">within each group: smallest gauge first</span>}
          {sortCol && (
            <>
              <span className="holder-table-note">sorted by {sortCol} {sortDir === 'asc' ? '↑' : '↓'}</span>
              <button className="btn btn-ghost btn-sm" onClick={() => { setSortCol(null); enableGrouping(true); }}>Clear sort</button>
            </>
          )}
        </div>
        <div className="holder-table-scroll">
          {/* border-collapse MUST be `separate` (set in CSS): in `collapse` mode
              browsers don't reliably paint backgrounds on sticky cells, so the
              header goes see-through and rows show under it. */}
          <table className="holder-table">
            <thead>
              <tr>
                {COLS.map(c => (
                  <th
                    key={c.key} onClick={() => toggleSort(c.key)}
                    title="Click to sort — this ungroups the list"
                    className={`${sortCol === c.key ? 'active' : ''}${c.right ? ' right' : ''}`}
                  >
                    {c.label}
                    <span className="sort-arrow">{sortCol === c.key ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                if (r.kind === 'group') {
                  return (
                    // Deliberately NOT sticky: every group header would pin to
                    // the same offset and stack on top of each other. Only the
                    // column header sticks.
                    <tr key={`g-${r.key}`} className="holder-group-row">
                      <td colSpan={COLS.length}>
                        <span className="label">{r.label}</span>
                        <span className="count">{r.count}</span>
                      </td>
                    </tr>
                  );
                }
                const h = r.h;
                const ext = deriveExtensionOoh(h.segments);
                const gauge = deriveGaugeLength(h.segments);
                const used = usageOf(h);
                const pending = pendingLengthCheck(h, config);
                return (
                  <tr key={h.id} className="holder-row" onClick={() => onOpen(h)}>
                    <td>
                      <div className="holder-row-desc">
                        <HolderPill holder={h} config={config} compact />
                        {h.is_tap_collet && <span className="holder-tap-tag">TAP</span>}
                        {clashIds.has(h.id) && (
                          <span className="holder-clash-tag" title="This holder body disagrees with another record of the same holder">≠</span>
                        )}
                        {pending && (
                          <span
                            className={`holder-check-tag ${pending.status}`}
                            title={pending.status === 'flag'
                              ? `Δ ${pending.deltaMm.toFixed(2)}mm is outside the usual range — open to review and confirm`
                              : 'Engraved length not confirmed against the geometry yet'}
                          >{pending.status === 'flag' ? '⚠' : '?'}</span>
                        )}
                      </div>
                    </td>
                    <td className="muted">{holderOptionLabel(config, 'types', h.type_id) || '—'}</td>
                    <td className="muted">{holderOptionLabel(config, 'tapers', h.taper_id) || '—'}</td>
                    <td className="muted">{holderOptionLabel(config, 'collet_sizes', h.collet_size_id) || '—'}</td>
                    <td className={`mono${ext != null ? ' is-ext' : ' faint'}`}>
                      {ext != null ? `${formatHolderLen(holderLenIn(ext, h.unit), 'inches')}"` : '—'}
                    </td>
                    <td className="mono muted">
                      {formatHolderLen(gauge, h.unit)} <span className="faint">{unitAbbr(h.unit)}</span>
                    </td>
                    <td className="faint">{h.location || '—'}</td>
                    <td className="mono right">{used || 0}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {visible.length === 0 && (
          <div className="holder-empty">
            {holders.length === 0
              ? 'No holder records yet — import the linked Fusion holder library to get started.'
              : 'No holders match.'}
          </div>
        )}
      </div>

      {/* ─── The archive ───────────────────────────────────────────────────
          Merged-away and removed holders. Kept because their geometry is the
          only surviving record of what the shop used to be running — but they
          are not part of the library: nothing matches to them, and Fusion's
          copy is deleted on the next push. Off by default, out of the way. */}
      {archived.length > 0 && (
        <div className="holder-archive">
          <button className="holder-archive-toggle" onClick={() => setShowArchive(s => !s)}>
            {showArchive ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <b>Archive</b>
            <span className="holder-archive-count">{archived.length}</span>
            <span className="holder-archive-note">
              Merged away or removed. Kept for reference — never matched to a tool.
            </span>
          </button>
          {showArchive && (
            <div className="holder-archive-list">
              {archived.map(h => (
                <div key={h.id} className="holder-archive-row">
                  <button className="holder-archive-name" onClick={() => onOpen(h)}>
                    {h.description || h.holder_ref}
                  </button>
                  <span className="holder-conf medium">Not in Fusion</span>
                  <span className="holder-archive-why">
                    {h.archived_reason === 'merged'
                      ? `Merged into ${holders.find(x => x.id === h.merged_into)?.description || 'another holder'}`
                      : 'Removed from the library'}
                    {h.archived_at ? ` · ${new Date(h.archived_at).toLocaleDateString()}` : ''}
                  </span>
                  {/* Restore makes a COPY — a new holder with a new ID. Bringing
                      the old identity back would re-attach every tool still
                      carrying its guid to the geometry this archive retired. */}
                  <button className="btn btn-secondary btn-xs" onClick={() => onRestore(h)}
                    disabled={!googleAuthenticated}
                    title="Create a new holder from this one — a new record with a new ID, which pushes to Fusion as a new holder. The archived copy stays here.">
                    <Copy size={12} /> Restore as new
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function HoldersPage() {
  const {
    holderLibrary, holders: fusionHolders, shopSettings, tools,
    saveHolderRecord, deleteHolderRecord, saveHolderLibrary, saveShopSettings, saveHolderPart,
    importHoldersFromFusion, pushHoldersToFusion, restampHolderTools, linkToolsToHolders,
    restoreHolderRecord, googleAuthenticated, googleUser, demoMode, notify,
  } = useApp();
  const navigate = useNavigate();
  const [openId, setOpenId] = useState(null);
  const [healing, setHealing] = useState(false);
  const [linkingParts, setLinkingParts] = useState(false);
  const [dupesOpen, setDupesOpen] = useState(false);
  const [merging, setMerging] = useState(null);   // { a, b, match }
  const [restampOpen, setRestampOpen] = useState(false);

  // Falls back to the seeded lookups for a shop whose settings file predates
  // holder_config — see holderConfigOf.
  const config = holderConfigOf(shopSettings);
  // ⚠️ `records` is the LIVE library everywhere on this page. Archived holders
  // are retired — merged away or removed — and are deliberately absent from the
  // list, the counts, the duplicate scan and every matcher. They are reachable
  // only through the archive toggle at the bottom.
  const allRecords = holderLibrary?.holders || [];
  const records = useMemo(() => allRecords.filter(h => h.archived !== true), [allRecords]);
  const archived = useMemo(() => allRecords.filter(h => h.archived === true), [allRecords]);
  const parts = holderLibrary?.parts || [];
  // Holders whose geometry no longer matches the part record they point at.
  const driftIds = useMemo(() => holdersWithPartDrift(records, holderLibrary), [records, holderLibrary]);
  const duplicateIds = useMemo(() => holdersInDuplicates(records, config), [records, config]);
  // Opened from the archive too — the point of keeping one is being able to
  // look at its geometry.
  const open = allRecords.find(h => h.id === openId) || null;
  const allLocations = [...new Set(records.map(h => h.location).filter(Boolean))];

  // How many linked Fusion holders have no app record yet. Counted with the
  // strict identity check (app ID + segments), NOT the guid — Fusion's guid
  // churns, so a guid-based count reads settled holders as importable.
  const importable = useMemo(
    () => auditFusionHolders(fusionHolders || [], records).unknown.length,
    [records, fusionHolders]);

  // "Used by N tools" — through assemblyUsesHolder, so a tool linked by the app
  // FK counts even when Fusion has since re-issued the guid it carries.
  const usageOf = useMemo(
    () => (h) => assemblyCountUsingHolder(tools, h),
    [tools]);

  const canEdit = googleAuthenticated || demoMode;

  const addOption = async (list, label) => {
    const next = {
      ...(shopSettings || {}),
      holder_config: {
        ...(config || {}),
        [list]: [...holderOptions(config, list), newHolderOption(label, {}, holderOptions(config, list).length)],
      },
    };
    try { await saveShopSettings(next); } catch { /* saveSharedFile already toasts */ }
  };

  // No toast: this now runs on autosave, so a toast per pause in typing would
  // be constant noise. The detail header carries the state (Unsaved… / Saving…
  // / Saved), which is where you're already looking, and a failure surfaces
  // there too.
  const onSave = (record) => saveHolderRecord(record);

  const onDelete = async (record) => {
    // Say how many tools resolve through this record. Deleting it isn't
    // cosmetic for them: their next save falls back to the Fusion library's
    // version of the holder, quietly undoing any correction made here.
    const inUse = toolsFollowingMerge(record, tools, assemblyUsesHolder);
    const warn = inUse
      ? `\n\n⚠ ${inUse} tool assembl${inUse === 1 ? 'y uses' : 'ies use'} this holder. They will fall back to the Fusion holder library the next time each tool is saved — any correction made here is lost for them.`
      : '';
    if (!window.confirm(
      `Retire the holder "${record.description}"?\n\n`
      + 'It moves to the archive: it leaves the library, nothing is matched to it again, and '
      + 'Fusion\'s copy is deleted on the next push. Its geometry is kept — you can restore it '
      + `later as a new holder.${warn}`)) return;
    await deleteHolderRecord(record.id);
    setOpenId(null);
    notify('Holder record deleted', 'success');
  };

  // Which tools would be re-stamped — a read-only count, refreshed as the open
  // holder changes. `dryRun` writes nothing.
  const [restampPreview, setRestampPreview] = useState(null);
  useEffect(() => {
    let live = true;
    if (!open || !restampHolderTools) { setRestampPreview(null); return undefined; }
    Promise.resolve(restampHolderTools(open, { dryRun: true }))
      .then(r => { if (live) setRestampPreview(r); })
      .catch(() => { if (live) setRestampPreview(null); });
    return () => { live = false; };
  }, [open, restampHolderTools, tools]);

  // Opening the preview is all this does — every decision (tolerance, which
  // tools) is made in the modal against real before/after numbers.
  const onRestamp = () => setRestampOpen(true);

  // Re-grade the preview against a tolerance the user is trying out. Pure
  // computation; writes nothing.
  const previewAtTolerance = useCallback((toleranceIn) => {
    if (!open || !restampHolderTools) return;
    Promise.resolve(restampHolderTools(open, { dryRun: true, toleranceIn }))
      .then(setRestampPreview)
      .catch(() => {});
  }, [open, restampHolderTools]);

  // The tolerance is NOT remembered. It described this one correction; once the
  // tools are re-stamped they match the holder and move by nothing on their own.
  // Anything still on the old geometry afterwards — one deselected here, or one
  // arriving later from Fusion — should keep flagging.
  const commitRestamp = async (toolIds, toleranceIn) => {
    if (!open) return;
    try {
      await restampHolderTools(open, { toolIds, toleranceIn });
      setRestampOpen(false);
    } catch { /* toasted */ }
  };

  const onNew = async () => {
    const record = newHolderRecord({ unit: shopSettings?.default_units || 'inches' });
    try {
      await saveHolderRecord(record);
      setOpenId(record.id);
    } catch { /* toasted */ }
  };

  // ─── Link tools to holders (the migration pass) ──────────────────────────
  // Proposed live off the current tools + records, so the badge is always the
  // real remaining count and the modal never works from a stale plan.
  const linkPlan = useMemo(
    () => buildHolderLinkPlan(tools, records, config),
    [tools, records, config]);
  const [linkOpen, setLinkOpen] = useState(false);
  const onLinkTools = () => setLinkOpen(true);
  // Preview of what the CURRENT selection would do to Fusion — re-run as rows
  // are ticked, because the interesting number is how many tools get their
  // holder geometry corrected, not how many pointers get stored.
  const previewLinks = useCallback(
    (links) => linkToolsToHolders(links, { dryRun: true }),
    [linkToolsToHolders]);
  const commitLinks = async (links) => {
    // Errors are already toasted by the action; swallow the rejection here so a
    // failed write doesn't surface as an unhandled promise.
    const r = await linkToolsToHolders(links).catch(() => null);
    if (!r) return null;
    notify(r.rewritten
      ? `Linked ${r.linked} assembl${r.linked === 1 ? 'y' : 'ies'} · corrected ${r.rewritten} tool${r.rewritten === 1 ? '' : 's'} in Fusion`
      : `Linked ${r.linked} assembl${r.linked === 1 ? 'y' : 'ies'} — Fusion already had the right geometry`,
      'success');
    return r;
  };

  // ─── Push to Fusion ──────────────────────────────────────────────────────
  // Preview first, always: this is the one holder action that writes to
  // Autodesk, and the preview is also where the entries it REFUSES to touch
  // are named.
  // Shown until dismissed for good; the ⓘ button in the header brings it back.
  // No progress tracking on purpose — several steps are optional or repeatable,
  // so a checklist that can't be completed would just nag.
  const [showWorkflow, setShowWorkflow] = useState(() => !holderWorkflowDismissed());
  const hideWorkflow = () => { dismissHolderWorkflow(true); setShowWorkflow(false); };
  const revealWorkflow = () => { dismissHolderWorkflow(false); setShowWorkflow(true); };

  // Restore opens the copy straight away — you restored it to work on it, and
  // the first thing worth knowing is that it's a NEW holder, not the old one.
  const onRestore = async (h) => {
    try {
      const copy = await restoreHolderRecord(h.id);
      setOpenId(copy.id);
      notify(`Restored as a new holder (${copy.holder_ref}) — push to add it to Fusion`, 'success');
    } catch (e) { notify(e.message, 'error'); }
  };

  const [pushOpen, setPushOpen] = useState(false);
  const [pushPreview, setPushPreview] = useState(null);
  const onPush = async () => {
    setPushPreview(null);
    setPushOpen(true);
    try { setPushPreview(await pushHoldersToFusion({ dryRun: true })); }
    catch (e) { notify(e.message, 'error'); setPushOpen(false); }
  };
  const commitPush = async () => {
    await pushHoldersToFusion();
    setPushPreview(await pushHoldersToFusion({ dryRun: true }).catch(() => null));
  };

  // How many records Fusion doesn't confidently know yet — the badge on the
  // button, and the reason to press it.
  // ⚠️ Counts records Fusion doesn't agree with — never pushed OR pushed and
  // since edited here. Not just "unmatched": editing a description doesn't move
  // the segments, so an identity match alone would call it settled while Fusion
  // still showed the old name. This number is how you can see, at a glance,
  // what would be lost if this app went away (CLAUDE.md → "If Fusion has a
  // place for it, Fusion must have it").
  // ⚠️ allRecords, not records: a merged-away holder Fusion is still carrying
  // is exactly a thing Fusion doesn't yet agree with, and the archived record
  // is what identifies it for removal.
  const unlinked = useMemo(
    () => holdersOutOfSync(fusionHolders || [], allRecords, holderRecordToFusion),
    [fusionHolders, allRecords]);

  // ─── Tools carrying older holder geometry ────────────────────────────────
  // Fusion bakes a holder into every tool, so correcting one here leaves every
  // existing tool on the old copy until it is written. That's by design — but
  // it must not be silent, and it was: the link list skips already-linked
  // assemblies, and a tool arriving on a merged-away guid is auto-linked to the
  // survivor, so it sat there correctly pointed and wrongly shaped with nothing
  // anywhere saying so.
  const staleTools = useMemo(
    () => staleHolderTools(tools, { records, fusionHolders: fusionHolders || [] }),
    [tools, records, fusionHolders]);
  // The same question scoped to the holder that's open, so its Re-stamp banner
  // can say how many of its tools actually need it rather than how many use it.
  const openStaleCount = useMemo(
    () => (open
      ? staleHolderTools(tools, { records, fusionHolders: fusionHolders || [], record: open }).length
      : 0),
    [tools, records, fusionHolders, open]);
  // Nowhere to push to unless a Fusion holder library is actually linked (demo
  // has holders but no registry entry) — better a disabled button that says why
  // than one that opens and immediately errors.
  const canPush = (shopSettings?.holder_libraries || []).length > 0;

  // Anything the strict identity check couldn't confirm is NOT imported and NOT
  // linked — it's a half-match (our ID on a re-shaped holder, or a known shape
  // with our ID missing), which is a person's call, not the importer's.
  const [importFlags, setImportFlags] = useState([]);
  const onImport = async () => {
    try {
      const res = await importHoldersFromFusion();
      setImportFlags(res.flagged || []);
      const parts = [];
      if (res.added) parts.push(`Imported ${res.added} holder${res.added === 1 ? '' : 's'}`);
      if (res.skipped) parts.push(`${res.skipped} already matched`);
      if (res.flagged?.length) parts.push(`${res.flagged.length} need a look`);
      notify(parts.length ? parts.join(' · ') : 'Nothing to import',
        res.flagged?.length ? 'warning' : 'success');
    } catch (e) {
      notify(`Import failed: ${e.message}`, 'error');
    }
  };

  // Merge: the survivor absorbs the loser's Fusion guid, so every tool that
  // referenced the loser resolves to it — no tool is written.
  const commitMerge = async (survivorId, loserId) => {
    try {
      await saveHolderLibrary(applyHolderMerge(holderLibrary, survivorId, loserId));
      notify('Holders merged — anything that used the old one now resolves to the kept record', 'success');
      setMerging(null);
      if (openId === loserId) setOpenId(survivorId);
    } catch { /* toasted */ }
  };

  const commitParts = async (proposals) => {
    try {
      await saveHolderLibrary(applyPartProposals(holderLibrary, proposals, config));
      notify(`Created ${proposals.length} part record${proposals.length === 1 ? '' : 's'} and linked the holders`, 'success');
      setLinkingParts(false);
    } catch { /* toasted */ }
  };

  const commitHeal = async (rows) => {
    const byId = new Map(rows.map(r => [r.h.id, applyHealToRecord(r.h, r.heal)]));
    const next = {
      ...(holderLibrary || { version: 1 }),
      holders: records.map(h => byId.get(h.id) || h),
    };
    try {
      await saveHolderLibrary(next);
      notify(`Filled structured fields on ${rows.length} holder${rows.length === 1 ? '' : 's'}`, 'success');
      setHealing(false);
    } catch { /* toasted */ }
  };

  return (
    <div className="holders-page">
      {open ? (
        <HolderDetail
          key={open.id}
          holder={open} config={config} usage={usageOf(open)}
          holderFile={holderLibrary} onSavePart={saveHolderPart}
          onMergeWith={(other) => setMerging({ a: open, b: other, match: compareHolders(open, other, config) })}
          restampPreview={restampPreview}
          staleCount={openStaleCount}
          onRestamp={onRestamp}
          allLocations={allLocations} readOnly={!canEdit}
          onBack={() => setOpenId(null)}
          updatedBy={googleUser?.email || ''}
          siblings={records}
          onSave={onSave}
          onDelete={onDelete}
          onAddOption={addOption}
          onViewTools={() => navigate('/')}
        />
      ) : (
        <>
        {importFlags.length > 0 && (
          <div className="holder-warn holder-import-flags">
            <div className="holder-import-flags-head">
              <b>{importFlags.length} Fusion holder{importFlags.length === 1 ? '' : 's'} need a look</b>
              <button className="icon-btn" onClick={() => setImportFlags([])}><X size={14} /></button>
            </div>
            {/* Half-matches only: our ID and the segments disagree, so linking
                either way would be a guess. Nothing was imported for these. */}
            {importFlags.map((f, i) => (
              <div key={i} className="holder-import-flag">
                <span className="holder-conf medium">{f.status.replace('-', ' ')}</span>
                <span className="holder-import-flag-desc">{f.entry.description || '(no description)'}</span>
                <span className="holder-import-flag-why">{f.reason}</span>
              </div>
            ))}
          </div>
        )}
        <HolderList
          holders={records} config={config} usageOf={usageOf}
          importable={importable} googleAuthenticated={canEdit}
          onOpen={h => setOpenId(h.id)}
          onNew={onNew} onHeal={() => setHealing(true)} onImport={onImport}
          onPush={onPush} unlinked={unlinked} canPush={canPush}
          onLinkTools={onLinkTools} unlinkedTools={linkPlan.rows.length}
          showWorkflow={showWorkflow} onShowWorkflow={revealWorkflow} onDismissWorkflow={hideWorkflow}
          onLinkParts={() => setLinkingParts(true)}
          onDuplicates={() => setDupesOpen(true)}
          driftIds={driftIds} partCount={parts.length} duplicateIds={duplicateIds}
          archived={archived} onRestore={onRestore} staleTools={staleTools}
        />
        </>
      )}
      {linkOpen && (
        <LinkToolsModal
          plan={linkPlan} holders={records}
          onPreview={previewLinks} onCommit={commitLinks}
          onClose={() => setLinkOpen(false)}
        />
      )}
      {pushOpen && (
        <PushHoldersModal
          preview={pushPreview}
          onCommit={commitPush}
          onClose={() => setPushOpen(false)}
        />
      )}
      {restampOpen && open && (
        <RestampModal
          preview={restampPreview}
          onPreview={previewAtTolerance}
          onCommit={commitRestamp}
          onClose={() => setRestampOpen(false)}
        />
      )}
      {dupesOpen && (
        <DuplicatesModal
          holders={records} config={config} tools={tools}
          onMerge={(m) => { setDupesOpen(false); setMerging({ a: m.a, b: m.b, match: m }); }}
          onClose={() => setDupesOpen(false)}
        />
      )}
      {merging && (
        <HolderMergeModal
          a={merging.a} b={merging.b} match={merging.match} config={config} tools={tools}
          onCommit={commitMerge} onClose={() => setMerging(null)}
        />
      )}
      {linkingParts && (
        <PartsModal
          holders={records} config={config} existingParts={parts.length}
          onCommit={commitParts} onClose={() => setLinkingParts(false)}
        />
      )}
      {healing && (
        <HealerModal
          holders={records} config={config}
          onCommit={commitHeal} onClose={() => setHealing(false)}
        />
      )}
    </div>
  );
}

export { HolderList, HealerModal, ArrowLeft };
