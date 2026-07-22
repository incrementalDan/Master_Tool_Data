import { describe, it, expect } from 'vitest';
import {
  machineById,
  preferredMachineIdForName,
  syncPreferredMachine,
  preferredMachineName,
  backfillPreferredMachineIds,
} from './machines.js';

const MACHINES = [
  { id: 'mc_m300', model: 'Brother Speedio M300X3' },
  { id: 'mc_haas', model: 'Haas VF-2' },
];
const RENAMED = [{ id: 'mc_m300', model: 'Brother M300 (cell 2)' }, MACHINES[1]];

describe('preferred-machine foreign key (store the id, render the name)', () => {
  it('machineById returns the live record (null when dangling/absent)', () => {
    expect(machineById('mc_haas', MACHINES).model).toBe('Haas VF-2');
    expect(machineById('gone', MACHINES)).toBe(null);
    expect(machineById(null, MACHINES)).toBe(null);
  });

  it('preferredMachineIdForName matches exact model, then a loose contains, else null', () => {
    expect(preferredMachineIdForName('Brother Speedio M300X3', MACHINES)).toBe('mc_m300'); // exact
    expect(preferredMachineIdForName('M300', MACHINES)).toBe('mc_m300');                    // legacy short → contains
    expect(preferredMachineIdForName('haas vf-2', MACHINES)).toBe('mc_haas');               // case-insensitive
    expect(preferredMachineIdForName('Okuma', MACHINES)).toBe(null);                        // free text
    expect(preferredMachineIdForName('', MACHINES)).toBe(null);
  });

  it('syncPreferredMachine renders the CURRENT model name from the id after a rename', () => {
    const tool = { id: 't1', preferred_machine_id: 'mc_m300', preferred_machine: 'Brother Speedio M300X3' };
    const out = syncPreferredMachine(tool, RENAMED);
    expect(out.preferred_machine).toBe('Brother M300 (cell 2)'); // follows the rename
    expect(out.preferred_machine_id).toBe('mc_m300');            // id is stable
  });

  it('adopts the id from a legacy free-text string (becomes rename-proof)', () => {
    const tool = { id: 't1', preferred_machine: 'M300' }; // no id, legacy short name
    const out = syncPreferredMachine(tool, MACHINES);
    expect(out.preferred_machine_id).toBe('mc_m300');
    expect(out.preferred_machine).toBe('Brother Speedio M300X3'); // canonicalized to model
  });

  it('leaves a genuinely free-text machine untouched (no id)', () => {
    const tool = { id: 't1', preferred_machine: 'Manual lathe in back' };
    const out = syncPreferredMachine(tool, MACHINES);
    expect(out).toBe(tool);
    expect('preferred_machine_id' in out).toBe(false);
  });

  it('tolerates a dangling id — keeps the stored string', () => {
    const tool = { id: 't1', preferred_machine_id: 'deleted', preferred_machine: 'Old Mill' };
    const out = syncPreferredMachine(tool, MACHINES);
    expect(out).toBe(tool);
    expect(out.preferred_machine).toBe('Old Mill');
  });

  it('preferredMachineName resolves live from id, falls back to the free-text string', () => {
    expect(preferredMachineName({ preferred_machine_id: 'mc_haas' }, RENAMED)).toBe('Haas VF-2');
    expect(preferredMachineName({ preferred_machine: 'Manual lathe' }, MACHINES)).toBe('Manual lathe');
    expect(preferredMachineName({}, MACHINES)).toBe('');
  });

  it('backfillPreferredMachineIds walks the tool list; no-op with no machines', () => {
    const tools = [{ id: 't1', preferred_machine: 'M300' }, { id: 't2' }];
    const out = backfillPreferredMachineIds(tools, MACHINES);
    expect(out[0].preferred_machine_id).toBe('mc_m300');
    expect(out[1]).toBe(tools[1]);
    expect(backfillPreferredMachineIds(tools, [])).toBe(tools); // no machines → unchanged
  });
});
