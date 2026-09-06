// One button in the tool page's frozen left action sidebar: a large icon over a
// wrapped label, with the explanation in the tooltip.
export default function SidebarBtn({ icon: Icon, label, tip, onClick, style, className = '' }) {
  return (
    <button
      className={`tool-sidebar-btn ${className}`}
      title={tip}
      onClick={onClick}
      style={style}
    >
      <Icon size={22} />
      <span>{label}</span>
    </button>
  );
}
