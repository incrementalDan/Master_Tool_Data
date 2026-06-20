import React from 'react';

// ToolDex — SearchBar
// The library's primary search affordance. A recessed bar with a leading
// magnifier and a clear button that appears once there's a query.
// Icons are inline SVG (lucide silhouettes) so the component is dependency-free.

const SearchIcon = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
    <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
  </svg>
);
const XIcon = ({ size = 15 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);

export function SearchBar({ value = '', onChange, onClear, placeholder = 'Search…', autoFocus = false, className = '', style }) {
  return (
    <div className={['search-bar', className].filter(Boolean).join(' ')} style={style}>
      <span style={{ color: 'var(--text-sub)', display: 'inline-flex' }}><SearchIcon /></span>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        onChange={e => onChange && onChange(e.target.value)}
      />
      {value && (
        <button
          type="button"
          className="icon-btn"
          style={{ width: 22, height: 22 }}
          aria-label="Clear search"
          onClick={() => { onChange && onChange(''); onClear && onClear(); }}
        >
          <XIcon />
        </button>
      )}
    </div>
  );
}
