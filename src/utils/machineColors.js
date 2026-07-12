// Machine colors — pure helpers (no React).
//
// Every configured machine renders in its own color, as a `.machine-pill`
// badge (the same --badge-color mechanism as holder pills / preset tags /
// customer badges). The color lives on the machine record in
// shop_settings.machines[] as `color` (a hex string, picked by the user in
// Settings). Machines saved before the field existed fall back to their
// position in the configured list — first machine blue, second green — so
// existing shops get stable, distinct colors with no migration.

export const MACHINE_COLOR_PALETTE = [
  '#4a8fff', // blue   — first machine (matches --blue)
  '#4ade80', // green  — second machine
  '#f59e0b', // amber
  '#a78bfa', // violet
  '#2dd4bf', // teal
  '#fb7185', // rose
  '#fb923c', // orange
  '#22d3ee', // cyan
  '#e879f9', // fuchsia
  '#818cf8', // indigo
];

// Color for a machine record from shop_settings.machines[]: its own picked
// color, else its index in the list mapped onto the palette.
export function machineColor(machine, machines = []) {
  if (!machine) return null;
  if (machine.color) return machine.color;
  const idx = machines.findIndex(m => m === machine || (m.id != null && m.id === machine.id));
  return MACHINE_COLOR_PALETTE[(idx >= 0 ? idx : 0) % MACHINE_COLOR_PALETTE.length];
}

// Resolve a color from what a program row stores (machine_id + a
// machine_label cache) against the machineOptions() list ({ id, label,
// color }): id match first, then label. Null when the machine is no longer
// configured — the pill then renders in its default color.
export function machineColorFor(machineId, machineLabel, machineOpts = []) {
  const m = (machineId && machineOpts.find(x => x.id === machineId))
    || (machineLabel && machineOpts.find(x => x.label === machineLabel))
    || null;
  return m?.color || null;
}

// Suggested color for a newly added machine: the first palette color no
// existing machine is using, cycling once the palette is exhausted.
export function nextMachineColor(machines = []) {
  const used = new Set(machines.map(m => machineColor(m, machines)));
  return MACHINE_COLOR_PALETTE.find(c => !used.has(c))
    || MACHINE_COLOR_PALETTE[machines.length % MACHINE_COLOR_PALETTE.length];
}
