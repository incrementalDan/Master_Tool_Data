// ToolDex brand lockup — the single source of the app's identity in code.
// The mark is the white end-mill on the brand-blue rounded tile; the wordmark
// is "ToolDex" in the display face (Space Grotesk), "Tool" in the text color
// and "Dex" in --blue. Mirrors the ToolDex Design System
// (assets/tooldex-mark.svg + guidelines/brand-logo). The app is named ToolDex.

export function ToolDexMark({ size = 28, className }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 96 96"
      role="img"
      aria-label="ToolDex"
      className={className}
    >
      <rect width="96" height="96" rx="22" fill="#4a8fff" />
      <rect x="0.5" y="0.5" width="95" height="95" rx="21.5" fill="none" stroke="#ffffff" strokeOpacity="0.18" />
      <g
        transform="translate(13.2 14.2) scale(2.9)"
        fill="none"
        stroke="#ffffff"
        strokeWidth="0.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M9 3 H15 V20.3 H9 Z" />
        <path d="M9 18.6 C10.6 18.7 12.2 17.4 13 16.2 C13.6 15.3 14.5 14.9 15 14.9" />
        <path d="M9 15.6 C10.6 15.7 12.2 14.4 13 13.2 C13.6 12.3 14.5 11.9 15 11.9" />
        <path d="M9 12.6 C10.6 12.7 12.2 11.4 13 10.2" />
      </g>
    </svg>
  );
}

// The "ToolDex" wordmark. Colors come from the .tooldex-wordmark class.
export function ToolDexWordmark({ className }) {
  return (
    <span className={`tooldex-wordmark${className ? ` ${className}` : ''}`}>
      Tool<b>Dex</b>
    </span>
  );
}

// Mark + wordmark lockup. `wordmark={false}` renders the mark alone.
export default function BrandLogo({ markSize = 24, wordmark = true }) {
  return (
    <>
      <ToolDexMark size={markSize} />
      {wordmark && <ToolDexWordmark />}
    </>
  );
}
