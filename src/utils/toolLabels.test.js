import { describe, it, expect } from 'vitest';
import { jobLabelRows, labelFieldsOf, labelKey } from './toolLabels.js';
import { tagMarkup } from './labelPrint.js';

const part = { part_number: 'HINGE-COVER-LEFT', rev: 'B' };

const row = (over = {}) => ({
  t: 'T03', t_num: 3, tool_id: 'A-35', description: '3/16 EM 7FL .57 LOC',
  holder: 'NBT30-SK13C-60', ooh: '0.61', lc: 'LC-52', rta: 'RTA-9', ...over,
});

describe('label fields', () => {
  it('carries the T# only — H and D belong on the setup sheet, not the tag', () => {
    const f = labelFieldsOf(row(), part);
    expect(f.TCode).toBe('T03');
    expect(f).not.toHaveProperty('HOffset');
    expect(f).not.toHaveProperty('DOffset');
  });

  it('keeps the RTA field but drops the value', () => {
    // The field stays on the label; a stale RTA is worse than a blank one.
    const f = labelFieldsOf(row(), part);
    expect(f.RTA).toBe('');
    expect(tagMarkup(f)).toContain('>RTA<');
  });

  it('prints the CSV values, never a library correction', () => {
    const f = labelFieldsOf(row(), part);
    expect(f).toMatchObject({
      PartNumber: 'HINGE-COVER-LEFT', ToolNo: 'A-35',
      Holder: 'NBT30-SK13C-60', OOH: '0.61', Location: 'LC-52',
    });
  });
});

describe('dedupe — never print two identical labels', () => {
  it('collapses the same pocket running the same assembly in two OPs', () => {
    const rows = [
      { ...row(), program_id: 'p1' },
      { ...row(), program_id: 'p2' },   // OP60 — nothing about the setup differs
    ];
    expect(jobLabelRows(rows, part)).toHaveLength(1);
  });

  it('prints TWO labels for the same tool in two pockets', () => {
    // T03 and T04 both A-35 is two physical setups, so it is two tags.
    const rows = [row({ t: 'T03' }), row({ t: 'T04' })];
    const labels = jobLabelRows(rows, part);
    expect(labels).toHaveLength(2);
    expect(labels.map(l => l.TCode)).toEqual(['T03', 'T04']);
  });

  it('treats ANY difference as a separate label', () => {
    // A 0.1" OOH difference is a different assembly, not a data error.
    const variants = [
      row(),
      row({ ooh: '0.71' }),
      row({ holder: 'NBT30-SK13C-90' }),
      row({ description: '3/16 EM 7FL .60 LOC' }),
      row({ lc: 'LC-53' }),
    ];
    expect(jobLabelRows(variants, part)).toHaveLength(5);
  });

  it('ignores fields that never reach the label', () => {
    // The RTA value is dropped, so two rows differing only by it are one label.
    expect(jobLabelRows([row({ rta: 'RTA-1' }), row({ rta: 'RTA-2' })], part)).toHaveLength(1);
  });

  it('keeps the first occurrence order', () => {
    const rows = [row({ t: 'T10' }), row({ t: 'T03' }), row({ t: 'T10' })];
    expect(jobLabelRows(rows, part).map(l => l.TCode)).toEqual(['T10', 'T03']);
  });
});

describe('tagMarkup', () => {
  it('renders the tag fields the shop already reads', () => {
    const html = tagMarkup(labelFieldsOf(row(), part));
    expect(html).toContain('HINGE-COVER-LEFT');
    expect(html).toContain('A-35');
    expect(html).toContain('NBT30-SK13C-60');
    expect(html).toContain('0.61');
    expect(html).toContain('LC-52');
    expect(html).toContain('T03');
    expect(html).toContain('pocket-p');   // the hand-written pocket box
  });

  it('escapes a value rather than letting it break the label', () => {
    const html = tagMarkup(labelFieldsOf(row({ description: 'A & B <x>' }), part));
    expect(html).toContain('A &amp; B &lt;x&gt;');
  });

  it('renders an empty field without collapsing the layout', () => {
    const html = tagMarkup(labelFieldsOf(row({ lc: '', holder: '' }), part));
    expect(html).toContain('lc-pill');
    expect(labelKey(labelFieldsOf(row({ lc: '' }), part))).not.toBe(labelKey(labelFieldsOf(row(), part)));
  });
});
