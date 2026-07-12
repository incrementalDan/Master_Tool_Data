import { describe, it, expect } from 'vitest';
import {
  MACHINE_COLOR_PALETTE, machineColor, machineColorFor, nextMachineColor,
} from './machineColors.js';

const two = [
  { id: 'm1', model: 'M300X3' },
  { id: 'm2', model: 'R650' },
];

describe('machineColor', () => {
  it('uses the picked color when set', () => {
    expect(machineColor({ id: 'x', color: '#abcdef' }, two)).toBe('#abcdef');
  });
  it('falls back to list position — blue then green', () => {
    expect(machineColor(two[0], two)).toBe(MACHINE_COLOR_PALETTE[0]); // blue
    expect(machineColor(two[1], two)).toBe(MACHINE_COLOR_PALETTE[1]); // green
  });
  it('handles a machine not in the list and null input', () => {
    expect(machineColor({ id: 'zzz' }, two)).toBe(MACHINE_COLOR_PALETTE[0]);
    expect(machineColor(null, two)).toBeNull();
  });
});

describe('machineColorFor', () => {
  const opts = [
    { id: 'm1', label: 'M300X3', color: '#111111' },
    { id: null, label: 'R650', color: '#222222' },
  ];
  it('matches by id first, then by label', () => {
    expect(machineColorFor('m1', 'wrong label', opts)).toBe('#111111');
    expect(machineColorFor(null, 'R650', opts)).toBe('#222222');
  });
  it('returns null for a machine no longer configured', () => {
    expect(machineColorFor('gone', 'Old Machine', opts)).toBeNull();
  });
});

describe('nextMachineColor', () => {
  it('suggests the first unused palette color', () => {
    expect(nextMachineColor([])).toBe(MACHINE_COLOR_PALETTE[0]);
    expect(nextMachineColor(two)).toBe(MACHINE_COLOR_PALETTE[2]); // blue+green taken
  });
  it('cycles once the palette is exhausted', () => {
    const many = MACHINE_COLOR_PALETTE.map((c, i) => ({ id: `m${i}`, color: c }));
    expect(MACHINE_COLOR_PALETTE).toContain(nextMachineColor(many));
  });
});
