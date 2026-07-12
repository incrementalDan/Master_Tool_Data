// The one way a machine name renders as a standalone badge — a pill colored
// per machine via the shared --badge-color pattern (same mechanism as holder
// pills). Color comes from machineColor / machineColorFor (utils/machineColors)
// resolved by the host; pass undefined to use the CSS default (blue).
export default function MachinePill({ label, color }) {
  if (!label) return null;
  return (
    <span className="machine-pill" style={color ? { '--badge-color': color } : undefined}>
      {label}
    </span>
  );
}
